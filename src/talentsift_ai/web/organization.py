import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field, field_validator

from talentsift_ai.agents import DebateGraph
from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClientError
from talentsift_ai.pipeline import (
    HybridSearchService,
    ResumeIngestionPipeline,
    extract_skill_matches,
    get_embedder,
    lexical_overlap_score,
)
from talentsift_ai.pipeline.ingest import SUPPORTED_RESUME_EXTENSIONS
from talentsift_ai.pipeline.reranker import (
    calculate_competency_breakdown,
)
from talentsift_ai.schemas import JobPostingCreate
from talentsift_ai.settings import get_settings
from talentsift_ai.web.db import get_pool
from talentsift_ai.web.mistral_usage import get_shared_mistral_client, usage_organization_scope
from talentsift_ai.web.security import (
    create_signed_session,
    enforce_auth_rate_limit,
    validate_resume_magic_bytes,
    validate_safe_filename,
    validate_safe_location_or_link,
    verify_signed_session,
)

logger = logging.getLogger(__name__)

SESSION_COOKIE = "talentsift_org_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then try again."
)
MAX_UPLOAD_FILES = 20
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MiB per resume file
SHORTLIST_FUNNEL_MULTIPLIER = 3
SHORTLIST_RELEVANCE_CUTOFF_RATIO = 0.5
SHORTLIST_CONCURRENCY = 3

# Tracks active/recent background shortlist debate runs per posting_id so the UI can show
# deterministic progress & per-candidate failures instead of guessing when background tasks end.
_SHORTLIST_RUNS: dict[int, dict[str, Any]] = {}

router = APIRouter(prefix="/api/org", tags=["organization"])


def _parse_iso_datetime(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Geçerli bir ISO-8601 tarih/saat değeri girin.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat()


class OrgLoginRequest(BaseModel):
    username: str
    password: str


class JobPostingRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    deadline_at: str | None = None

    @field_validator("deadline_at")
    @classmethod
    def _validate_deadline(cls, value: str | None) -> str | None:
        return _parse_iso_datetime(value)


class CandidateSearchRequest(BaseModel):
    job_description: str | None = None
    min_gpa: float | None = Field(default=None, ge=0.0, le=4.0)
    class_year: int | None = Field(default=None, ge=1, le=6)
    min_experience_years: int | None = Field(default=None, ge=0, le=60)
    limit: int = Field(default=50, ge=1, le=200)


class DebateRequest(BaseModel):
    candidate_id: int
    job_description: str | None = None
    language: str = Field(default="tr", pattern="^(tr|en)$")


class ShortlistRequest(BaseModel):
    candidate_count: int = Field(ge=1, le=500)
    job_description: str | None = None
    min_gpa: float | None = Field(default=None, ge=0.0, le=4.0)
    class_year: int | None = Field(default=None, ge=1, le=6)
    min_experience_years: int | None = Field(default=None, ge=0, le=60)
    language: str = Field(default="tr", pattern="^(tr|en)$")


def _get_session_secret() -> str:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")
    return secret


async def get_org_session(
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    secret = _get_session_secret()
    session = verify_signed_session(session_cookie or "", secret, expected_role="org")
    if session is None or not isinstance(session.get("organization_id"), int):
        raise HTTPException(status_code=401, detail="Organization login required.")

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            status = await repository.get_organization_access_status(session["organization_id"])
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    if status is None:
        raise HTTPException(status_code=401, detail="Organization login required.")
    expires_at = status.get("license_expires_at")
    is_expired = False
    if expires_at is not None:
        if isinstance(expires_at, str):
            parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        else:
            parsed = expires_at
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        is_expired = parsed < datetime.now(UTC)

    if not status.get("is_active") or status.get("license_status") != "active" or is_expired:
        raise HTTPException(
            status_code=403,
            detail="Organizasyon hesabınız aktif değil veya lisans süresi sona ermiştir.",
        )
    return session


ORG_SESSION_DEPENDENCY = Depends(get_org_session)
UPLOAD_FILES_DEPENDENCY = File(...)


async def _get_posting_or_404(
    repository: CandidateRepository, posting_id: int, organization_id: int
) -> dict[str, Any]:
    posting = await repository.get_job_posting(posting_id, organization_id)
    if posting is None:
        raise HTTPException(status_code=404, detail="Job posting not found.")
    return posting


async def _rank_candidates(
    *,
    repository: CandidateRepository,
    organization_id: int,
    posting_id: int,
    job_description: str,
    min_gpa: float | None,
    class_year: int | None,
    min_experience_years: int | None,
    limit: int,
) -> list[dict[str, Any]]:
    settings = get_settings()
    mistral = (
        get_shared_mistral_client()
        if settings.embedding_provider.lower() == "mistral"
        else None
    )
    with usage_organization_scope(organization_id):
        service = HybridSearchService(mistral_client=mistral, repository=repository)
        return await service.rank(
            organization_id=organization_id,
            job_posting_id=posting_id,
            job_description=job_description,
            min_gpa=min_gpa,
            class_year=class_year,
            min_experience_years=min_experience_years,
            limit=limit,
        )


class OrgRegisterRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=255)
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=6)
    notes: str | None = None


@router.post("/register")
async def register(request: Request, payload: OrgRegisterRequest) -> dict[str, Any]:
    enforce_auth_rate_limit(request, scope="org_register")
    settings = get_settings()
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            res = await repository.create_organization_registration(
                display_name=payload.display_name,
                username=payload.username,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
                notes=payload.notes,
            )
            return {
                "ok": True,
                "message": (
                    "Organizasyon kayıt talebiniz başarıyla alındı. "
                    "Hesabınız yönetici onayından geçtikten sonra giriş yapabilirsiniz."
                ),
                "organization_id": res["organization_id"],
            }
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status_code=409,
            detail="Bu kullanıcı adı veya organizasyon zaten kayıtlı.",
        ) from exc
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/login")
async def login(
    request: Request, payload: OrgLoginRequest, response: Response
) -> dict[str, Any]:
    enforce_auth_rate_limit(request, scope="org_login")
    settings = get_settings()
    secret = _get_session_secret()

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            identity = await repository.authenticate_organization_user(
                username=payload.username,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if identity is None:
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı.")

    if identity.get("is_pending"):
        reason = identity.get("blocked_reason")
        if reason == "suspended":
            detail = "Organizasyon hesabınız askıya alınmıştır. Yönetici ile iletişime geçin."
        elif reason == "expired":
            detail = "Organizasyon lisans süreniz dolmuştur. Yönetici ile iletişime geçin."
        else:
            detail = (
                "Hesabınız henüz yönetici onayından geçmemiştir. "
                "Onaylandığında giriş yapabilirsiniz."
            )
        raise HTTPException(status_code=403, detail=detail)

    token = create_signed_session(
        {
            "role": "org",
            "organization_id": identity["organization_id"],
            "display_name": identity["display_name"],
            "username": identity["username"],
        },
        secret,
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
        max_age=28_800,
        path="/",
    )
    return {
        "ok": True,
        "organization_id": identity["organization_id"],
        "display_name": identity["display_name"],
    }


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    settings = get_settings()
    response.delete_cookie(
        SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
    )
    return {"ok": True}


@router.get("/me")
async def me(session: dict[str, Any] = ORG_SESSION_DEPENDENCY) -> dict[str, Any]:
    return {
        "organization_id": session["organization_id"],
        "display_name": session["display_name"],
        "username": session["username"],
    }


@router.post("/postings")
async def create_posting(
    payload: JobPostingRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await repository.create_job_posting(
                JobPostingCreate(
                    organization_id=session["organization_id"],
                    title=payload.title,
                    description=payload.description,
                    deadline_at=payload.deadline_at,
                )
            )
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"posting": posting.model_dump()}


@router.get("/postings")
async def list_postings(session: dict[str, Any] = ORG_SESSION_DEPENDENCY) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            rows = await repository.list_job_postings(session["organization_id"])
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"postings": rows}


@router.get("/postings/{posting_id}")
async def get_posting(
    posting_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"posting": posting}


@router.patch("/postings/{posting_id}")
async def update_posting(
    posting_id: int,
    payload: JobPostingRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await repository.update_job_posting(
                job_posting_id=posting_id,
                organization_id=organization_id,
                title=payload.title.strip(),
                description=payload.description.strip(),
                deadline_at=payload.deadline_at,
            )
            if posting is None:
                raise HTTPException(status_code=404, detail="Job posting not found.")
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"posting": posting}


@router.delete("/postings/{posting_id}")
async def delete_posting(
    posting_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    if _SHORTLIST_RUNS.get(posting_id, {}).get("status") == "running":
        raise HTTPException(
            status_code=409,
            detail="Kısa liste değerlendirmesi devam ederken ilan silinemez.",
        )
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            await repository.delete_job_posting(posting_id, organization_id)
            _SHORTLIST_RUNS.pop(posting_id, None)
            return {"status": "ok", "message": "Job posting deleted successfully."}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


class TogglePostingStatusRequest(BaseModel):
    is_active: bool


@router.patch("/postings/{posting_id}/status")
async def toggle_posting_status(
    posting_id: int,
    payload: TogglePostingStatusRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            await repository.toggle_job_posting_status(
                posting_id, organization_id, payload.is_active
            )
            return {
                "status": "ok",
                "message": f"Job posting is now {'active' if payload.is_active else 'inactive'}.",
            }
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/postings/{posting_id}/candidates")
async def list_candidates(
    posting_id: int,
    min_gpa: float | None = None,
    class_year: int | None = None,
    min_experience_years: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            rows = await repository.list_candidates(
                organization_id=organization_id,
                job_posting_id=posting_id,
                min_gpa=min_gpa,
                class_year=class_year,
                min_experience_years=min_experience_years,
                limit=limit,
                offset=offset,
            )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidates": rows}


@router.get("/postings/{posting_id}/candidates/{candidate_id}")
async def get_candidate(
    posting_id: int,
    candidate_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            candidate = await repository.get_candidate(candidate_id, organization_id, posting_id)
            if candidate is None:
                raise HTTPException(status_code=404, detail="Candidate not found.")
            debate = await repository.latest_debate_result(
                candidate_id, organization_id, job_posting_id=posting_id
            )
            application_status = await repository.get_application_status(
                candidate_id, organization_id, posting_id
            )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    candidate_dict = candidate.model_dump(exclude={"cv_embedding"})
    competency_breakdown = calculate_competency_breakdown(candidate_dict)
    skill_matches = extract_skill_matches(posting["description"], candidate_dict)
    return {
        "candidate": candidate_dict,
        "debate": debate,
        "application_status": application_status,
        "competency_breakdown": competency_breakdown,
        "skill_matches": skill_matches,
    }


@router.post("/postings/{posting_id}/candidates/search")
async def search_candidates(
    posting_id: int,
    payload: CandidateSearchRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            job_description = payload.job_description or posting["description"]
            results = await _rank_candidates(
                repository=repository,
                organization_id=organization_id,
                posting_id=posting_id,
                job_description=job_description,
                min_gpa=payload.min_gpa,
                class_year=payload.class_year,
                min_experience_years=payload.min_experience_years,
                limit=payload.limit,
            )
            await repository.bulk_upsert_application_scores(
                job_posting_id=posting_id, scored_candidates=results
            )
    except MistralClientError as exc:
        raise HTTPException(status_code=502, detail=f"Mistral API hatası: {exc}") from exc
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    sanitized = [{k: v for k, v in row.items() if k != "raw_cv_text"} for row in results]
    return {"candidates": sanitized}


@router.post("/postings/{posting_id}/candidates/upload")
async def upload_candidates(
    posting_id: int,
    files: list[UploadFile] = UPLOAD_FILES_DEPENDENCY,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]

    if not files:
        raise HTTPException(status_code=400, detail="Hiç dosya yüklenmedi.")
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=400, detail=f"Tek seferde en fazla {MAX_UPLOAD_FILES} dosya yüklenebilir."
        )

    created: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            mistral = get_shared_mistral_client()
            pipeline = ResumeIngestionPipeline(
                mistral_client=mistral,
                repository=repository,
                organization_id=organization_id,
                job_posting_id=posting_id,
                max_concurrency=settings.max_concurrency,
            )

            async def _process_one(upload: UploadFile) -> None:
                filename = validate_safe_filename(upload.filename)
                suffix = Path(filename).suffix.lower()
                if suffix not in SUPPORTED_RESUME_EXTENSIONS:
                    errors.append(
                        {
                            "filename": filename,
                            "detail": (
                                "Desteklenmeyen dosya türü (.pdf, .docx, .txt, .md beklenir)."
                            ),
                        }
                    )
                    return

                document_bytes = await upload.read()
                if not document_bytes:
                    errors.append({"filename": filename, "detail": "Dosya boş."})
                    return
                if len(document_bytes) > MAX_UPLOAD_BYTES:
                    errors.append({"filename": filename, "detail": "Dosya 10 MB sınırını aşıyor."})
                    return
                try:
                    validate_resume_magic_bytes(document_bytes, suffix)
                except ValueError as exc:
                    errors.append({"filename": filename, "detail": str(exc)})
                    return

                try:
                    with usage_organization_scope(organization_id):
                        candidate = await pipeline.ingest_bytes(document_bytes, filename=filename)
                    created.append(
                        {
                            "id": candidate.id,
                            "full_name": candidate.full_name,
                            "filename": filename,
                        }
                    )
                except (MistralClientError, ValueError, asyncpg.DataError) as exc:
                    errors.append({"filename": filename, "detail": str(exc)})

            await asyncio.gather(*(_process_one(upload) for upload in files))
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"created": created, "errors": errors}


@router.get("/postings/{posting_id}/rankings/top")
async def top_rankings(
    posting_id: int,
    limit: int = Query(default=5, ge=1, le=200),
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            rows = await repository.top_results(organization_id, posting_id, limit=limit)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"results": rows}


@router.post("/postings/{posting_id}/debate")
async def run_debate(
    posting_id: int,
    payload: DebateRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    settings = get_settings()
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            candidate = await repository.get_candidate(
                payload.candidate_id, organization_id, posting_id
            )
            if candidate is None:
                raise HTTPException(status_code=404, detail="Candidate not found.")

            using_custom_query = bool(payload.job_description and payload.job_description.strip())
            job_description = (
                payload.job_description.strip()
                if using_custom_query and payload.job_description
                else posting["description"]
            )

            mistral = get_shared_mistral_client()
            with usage_organization_scope(organization_id):
                query_embedding = (
                    None
                    if using_custom_query
                    else await repository.get_posting_embedding(posting_id)
                )
                if query_embedding is None:
                    embedder = get_embedder(settings, mistral_client=mistral)
                    query_embedding = await embedder.embed_query(job_description)
                    if not using_custom_query:
                        await repository.set_posting_embedding(posting_id, query_embedding)

                dense_similarity = await repository.get_candidate_similarity(
                    candidate_id=candidate.id,
                    organization_id=organization_id,
                    job_posting_id=posting_id,
                    query_embedding=query_embedding,
                )

                candidate_dict = candidate.model_dump()
                skill_matches = extract_skill_matches(job_description, candidate_dict)
                sparse_similarity: float | None = None
                if dense_similarity is not None:
                    sparse_similarity = lexical_overlap_score(job_description, candidate_dict)
                    relevance_score = round(
                        settings.hybrid_dense_weight * max(0.0, dense_similarity)
                        + settings.hybrid_sparse_weight * sparse_similarity,
                        4,
                    )
                else:
                    relevance_score = None

                competency_breakdown = calculate_competency_breakdown(candidate_dict)
                competency_score = competency_breakdown["competency_score"]
                pre_llm_score = (
                    round(0.65 * relevance_score + 0.35 * competency_score, 4)
                    if relevance_score is not None
                    else None
                )
                dense_score = (
                    round(max(0.0, dense_similarity), 4)
                    if dense_similarity is not None
                    else None
                )
                sparse_score = (
                    round(sparse_similarity, 4) if sparse_similarity is not None else None
                )

                graph = DebateGraph(mistral)
                result = await graph.evaluate(
                    organization_id=organization_id,
                    candidate_id=candidate.id,
                    cv_text=candidate.raw_cv_text,
                    job_description=job_description,
                    language=payload.language,
                )
                result_id = await repository.save_debate_result(
                    result,
                    job_posting_id=posting_id,
                    pre_llm_score=pre_llm_score,
                    relevance_score=relevance_score,
                    competency_score=competency_score,
                    dense_score=dense_score,
                    sparse_score=sparse_score,
                    matched_skills=skill_matches["matched_skills"],
                    missing_skills=skill_matches["missing_skills"],
                )
                await repository.upsert_application_score(
                    job_posting_id=posting_id,
                    candidate_id=candidate.id,
                    relevance_score=relevance_score,
                    competency_score=competency_score,
                    pre_llm_score=pre_llm_score,
                    dense_score=dense_score,
                    sparse_score=sparse_score,
                    matched_skills=skill_matches["matched_skills"],
                    missing_skills=skill_matches["missing_skills"],
                )
    except MistralClientError as exc:
        raise HTTPException(status_code=502, detail=f"Mistral API hatası: {exc}") from exc
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    return {
        "id": result_id,
        **result.model_dump(),
        "pre_llm_score": pre_llm_score,
        "relevance_score": relevance_score,
        "competency_score": competency_score,
        "dense_score": dense_score,
        "sparse_score": sparse_score,
        "matched_skills": skill_matches["matched_skills"],
        "missing_skills": skill_matches["missing_skills"],
        "competency_breakdown": competency_breakdown,
    }


async def _run_shortlist_debate(
    *,
    organization_id: int,
    posting_id: int,
    job_description: str,
    candidates: list[dict[str, Any]],
    language: str = "tr",
) -> None:
    """Runs the Optimist/Pessimist/Arbitrator debate for a shortlist of candidates."""
    run_state = _SHORTLIST_RUNS.setdefault(
        posting_id,
        {
            "status": "running",
            "total": len(candidates),
            "completed": 0,
            "succeeded": 0,
            "failed": 0,
            "failed_candidates": [],
            "started_at": datetime.now(UTC).isoformat(),
            "finished_at": None,
            "message": None,
        },
    )
    semaphore = asyncio.Semaphore(SHORTLIST_CONCURRENCY)
    mistral = get_shared_mistral_client()

    async def _evaluate(
        ranked_candidate: dict[str, Any],
        repository: CandidateRepository,
    ) -> None:
        candidate_id = ranked_candidate["id"]
        async with semaphore:
            try:
                candidate = await repository.get_candidate(
                    candidate_id, organization_id, posting_id
                )
                if candidate is None:
                    run_state["failed"] += 1
                    run_state["failed_candidates"].append(
                        {
                            "id": candidate_id,
                            "full_name": ranked_candidate.get("full_name", f"#{candidate_id}"),
                            "error": "Candidate record not found.",
                        }
                    )
                    return

                with usage_organization_scope(organization_id):
                    graph = DebateGraph(mistral)
                    result = await graph.evaluate(
                        organization_id=organization_id,
                        candidate_id=candidate.id,
                        cv_text=candidate.raw_cv_text,
                        job_description=job_description,
                        language=language,
                    )
                await repository.save_debate_result(
                    result,
                    job_posting_id=posting_id,
                    pre_llm_score=ranked_candidate.get("pre_llm_score"),
                    relevance_score=ranked_candidate.get("relevance_score"),
                    competency_score=ranked_candidate.get("competency_score"),
                    dense_score=ranked_candidate.get("dense_score"),
                    sparse_score=ranked_candidate.get("sparse_score"),
                    matched_skills=ranked_candidate.get("matched_skills"),
                    missing_skills=ranked_candidate.get("missing_skills"),
                )
                run_state["succeeded"] += 1
            except Exception as exc:
                logger.exception("Shortlist debate failed for candidate %s", candidate_id)
                run_state["failed"] += 1
                run_state["failed_candidates"].append(
                    {
                        "id": candidate_id,
                        "full_name": ranked_candidate.get("full_name", f"#{candidate_id}"),
                        "error": str(exc)[:180],
                    }
                )
            finally:
                run_state["completed"] += 1

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await asyncio.gather(*(_evaluate(c, repository) for c in candidates))
    except Exception as exc:
        logger.exception("Shortlist debate batch failed for posting %s", posting_id)
        run_state["status"] = "failed"
        run_state["message"] = str(exc)[:200]
        run_state["finished_at"] = datetime.now(UTC).isoformat()
        return

    run_state["finished_at"] = datetime.now(UTC).isoformat()
    if run_state["failed"] > 0 and run_state["succeeded"] == 0:
        run_state["status"] = "failed"
        run_state["message"] = "Tüm aday değerlendirmeleri başarısız oldu."
    elif run_state["failed"] > 0:
        run_state["status"] = "completed_with_errors"
        run_state["message"] = (
            f"{run_state['succeeded']} aday tamamlandı, "
            f"{run_state['failed']} adayda hata oluştu."
        )
    else:
        run_state["status"] = "completed"
        run_state["message"] = "Tüm aday değerlendirmeleri tamamlandı."


@router.get("/postings/{posting_id}/shortlist/status")
async def get_shortlist_status(
    posting_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            evaluated_ids = await repository.evaluated_candidate_ids(organization_id, posting_id)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    run = _SHORTLIST_RUNS.get(posting_id)
    if run is None:
        return {
            "status": "idle",
            "total": len(evaluated_ids),
            "completed": len(evaluated_ids),
            "succeeded": len(evaluated_ids),
            "failed": 0,
            "failed_candidates": [],
            "evaluated_count": len(evaluated_ids),
            "started_at": None,
            "finished_at": None,
            "message": None,
        }
    return {**run, "evaluated_count": len(evaluated_ids)}


@router.post("/postings/{posting_id}/shortlist")
async def create_shortlist(
    posting_id: int,
    payload: ShortlistRequest,
    background_tasks: BackgroundTasks,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Ranks applicants with Pre-LLM hybrid search and queues up to candidate_count * 3
    for parallel blind Optimist/Pessimist + Arbitrator LLM debate.
    """
    organization_id = session["organization_id"]
    if _SHORTLIST_RUNS.get(posting_id, {}).get("status") == "running":
        raise HTTPException(
            status_code=409,
            detail="Bu ilan için kısa liste AI değerlendirmesi zaten çalışıyor.",
        )

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            job_description = payload.job_description or posting["description"]
            ranked = await _rank_candidates(
                repository=repository,
                organization_id=organization_id,
                posting_id=posting_id,
                job_description=job_description,
                min_gpa=payload.min_gpa,
                class_year=payload.class_year,
                min_experience_years=payload.min_experience_years,
                limit=payload.candidate_count * SHORTLIST_FUNNEL_MULTIPLIER,
            )
            await repository.bulk_upsert_application_scores(
                job_posting_id=posting_id, scored_candidates=ranked
            )

            if not ranked:
                _SHORTLIST_RUNS.pop(posting_id, None)
                return {
                    "status": "ok",
                    "shortlisted_count": 0,
                    "queued_count": 0,
                    "already_evaluated_count": 0,
                    "queued": [],
                    "already_evaluated": [],
                }

            def score(candidate: dict[str, Any]) -> float:
                return float(candidate.get("pre_llm_score") or candidate.get("similarity") or 0.0)

            cutoff = score(ranked[0]) * SHORTLIST_RELEVANCE_CUTOFF_RATIO
            shortlisted = [c for c in ranked if score(c) >= cutoff]

            already_evaluated_ids = await repository.evaluated_candidate_ids(
                organization_id, posting_id
            )
            to_queue = [c for c in shortlisted if c["id"] not in already_evaluated_ids]
            skipped = [c for c in shortlisted if c["id"] in already_evaluated_ids]
    except MistralClientError as exc:
        raise HTTPException(status_code=502, detail=f"Mistral API hatası: {exc}") from exc
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    if to_queue:
        _SHORTLIST_RUNS[posting_id] = {
            "status": "running",
            "total": len(to_queue),
            "completed": 0,
            "succeeded": 0,
            "failed": 0,
            "failed_candidates": [],
            "started_at": datetime.now(UTC).isoformat(),
            "finished_at": None,
            "message": None,
        }
        background_tasks.add_task(
            _run_shortlist_debate,
            organization_id=organization_id,
            posting_id=posting_id,
            job_description=job_description,
            candidates=to_queue,
            language=payload.language,
        )
    else:
        _SHORTLIST_RUNS[posting_id] = {
            "status": "completed",
            "total": 0,
            "completed": 0,
            "succeeded": 0,
            "failed": 0,
            "failed_candidates": [],
            "started_at": datetime.now(UTC).isoformat(),
            "finished_at": datetime.now(UTC).isoformat(),
            "message": "Seçilen tüm adaylar zaten değerlendirilmişti.",
        }

    return {
        "status": "ok",
        "shortlisted_count": len(shortlisted),
        "queued_count": len(to_queue),
        "already_evaluated_count": len(skipped),
        "queued": [{"id": c["id"], "full_name": c["full_name"]} for c in to_queue],
        "already_evaluated": [{"id": c["id"], "full_name": c["full_name"]} for c in skipped],
    }


class FinalizeRequest(BaseModel):
    interview_slots: int = Field(ge=1, le=500)


@router.post("/postings/{posting_id}/finalize")
async def finalize_shortlist(
    posting_id: int,
    payload: FinalizeRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Locks in the top `interview_slots` evaluated candidates as selected and notifies others.
    """
    organization_id = session["organization_id"]
    if _SHORTLIST_RUNS.get(posting_id, {}).get("status") == "running":
        raise HTTPException(
            status_code=409,
            detail="Arka plandaki AI değerlendirmesi bitmeden sonuçlandırma yapılamaz.",
        )

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            evaluated_count = len(
                await repository.evaluated_candidate_ids(organization_id, posting_id)
            )
            if evaluated_count == 0:
                raise HTTPException(
                    status_code=400,
                    detail="Sonuçlandırmadan önce en az bir aday için değerlendirme çalıştırın.",
                )
            summary = await repository.finalize_shortlist(
                organization_id=organization_id,
                job_posting_id=posting_id,
                interview_slots=payload.interview_slots,
            )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"status": "ok", **summary}


@router.post("/postings/{posting_id}/reset-evaluations")
async def reset_posting_evaluations(
    posting_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Deletes every LLM evaluation, interview schedule, notification, and decision for this posting.
    """
    organization_id = session["organization_id"]
    if _SHORTLIST_RUNS.get(posting_id, {}).get("status") == "running":
        raise HTTPException(
            status_code=409,
            detail="Arka plandaki AI değerlendirmesi devam ederken sıfırlama yapılamaz.",
        )

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            summary = await repository.reset_posting_evaluations(
                organization_id=organization_id, job_posting_id=posting_id
            )
            _SHORTLIST_RUNS.pop(posting_id, None)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"status": "ok", **summary}


class InterviewProposeRequest(BaseModel):
    proposed_at: str
    location_or_link: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("proposed_at")
    @classmethod
    def _validate_proposed_at(cls, value: str) -> str:
        parsed = _parse_iso_datetime(value)
        if parsed is None:
            raise ValueError("Mülakat tarihi boş bırakılamaz.")
        return parsed

    @field_validator("location_or_link")
    @classmethod
    def _validate_location_or_link(cls, value: str | None) -> str | None:
        return validate_safe_location_or_link(value)


@router.post("/postings/{posting_id}/candidates/{candidate_id}/interview")
async def propose_interview(
    posting_id: int,
    candidate_id: int,
    payload: InterviewProposeRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Proposes (or reschedules) an interview slot for a 'selected' candidate.
    """
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            status = await repository.get_application_status(
                candidate_id, organization_id, posting_id
            )
            if status != "selected":
                raise HTTPException(
                    status_code=400,
                    detail="Yalnızca mülakata seçilmiş adaylar için mülakat planlanabilir.",
                )
            interview = await repository.upsert_interview_schedule(
                job_posting_id=posting_id,
                candidate_id=candidate_id,
                organization_id=organization_id,
                proposed_at=payload.proposed_at,
                location_or_link=payload.location_or_link,
                notes=payload.notes,
            )
            await repository.create_candidate_notification(
                candidate_id=candidate_id,
                job_posting_id=posting_id,
                organization_id=organization_id,
                type="interview_proposed",
                title="Mülakat teklifi aldınız",
                message=(
                    f'"{posting["title"]}" ilanı için mülakata davet edildiniz. '
                    "Aşağıdaki tarihi onaylayın veya reddedin."
                ),
                interview_schedule_id=interview["id"],
            )
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"status": "ok", "interview": interview}


@router.get("/postings/{posting_id}/candidates/{candidate_id}/interview")
async def get_interview(
    posting_id: int,
    candidate_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            interview = await repository.get_interview_schedule(posting_id, candidate_id)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"interview": interview}
