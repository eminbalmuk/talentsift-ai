from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field

from talentsift_ai.agents import DebateGraph
from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient, MistralClientError
from talentsift_ai.pipeline import HybridSearchService, ResumeIngestionPipeline
from talentsift_ai.schemas import JobPostingCreate
from talentsift_ai.settings import get_settings
from talentsift_ai.web.security import create_signed_session, verify_signed_session

SESSION_COOKIE = "talentsift_org_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then try again."
)
MAX_UPLOAD_FILES = 20

router = APIRouter(prefix="/api/org", tags=["organization"])


class OrgLoginRequest(BaseModel):
    username: str
    password: str


class JobPostingRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    deadline_at: str | None = None


class CandidateSearchRequest(BaseModel):
    job_description: str | None = None
    min_gpa: float | None = None
    class_year: int | None = None
    min_experience_years: int | None = None
    limit: int = Field(default=50, ge=1, le=200)


class DebateRequest(BaseModel):
    candidate_id: int
    job_description: str | None = None


async def get_org_session(
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")
    session = verify_signed_session(session_cookie or "", secret)
    if session is None:
        raise HTTPException(status_code=401, detail="Organization login required.")
    return session


ORG_SESSION_DEPENDENCY = Depends(get_org_session)
UPLOAD_FILES_DEPENDENCY = File(...)


def _create_mistral_client() -> MistralClient:
    settings = get_settings()
    return MistralClient(
        api_keys=settings.mistral_api_keys,
        base_url=settings.mistral_base_url,
        timeout_seconds=settings.request_timeout_seconds,
        max_concurrency=settings.max_concurrency,
    )


async def _get_posting_or_404(
    repository: CandidateRepository, posting_id: int, organization_id: int
) -> dict[str, Any]:
    posting = await repository.get_job_posting(posting_id, organization_id)
    if posting is None:
        raise HTTPException(status_code=404, detail="Job posting not found.")
    return posting


class OrgRegisterRequest(BaseModel):
    display_name: str = Field(min_length=2, max_length=255)
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=6)
    notes: str | None = None


@router.post("/register")
async def register(payload: OrgRegisterRequest) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            res = await repository.create_organization_registration(
                display_name=payload.display_name,
                username=payload.username,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
                notes=payload.notes,
            )
            return {
                "ok": True,
                "message": "Organizasyon kayıt talebiniz başarıyla alındı. Hesabınız yönetici onayından geçtikten sonra giriş yapabilirsiniz.",
                "organization_id": res["organization_id"],
            }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/login")
async def login(payload: OrgLoginRequest, response: Response) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")

    try:
        async with CandidateRepository(settings.database_url) as repository:
            identity = await repository.authenticate_organization_user(
                username=payload.username,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if identity is None:
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı.")

    if identity.get("is_pending"):
        raise HTTPException(
            status_code=403,
            detail="Hesabınız henüz yönetici onayından geçmemiştir. Onaylandığında giriş yapabilirsiniz.",
        )

    token = create_signed_session(
        {
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
    )
    return {
        "ok": True,
        "organization_id": identity["organization_id"],
        "display_name": identity["display_name"],
    }


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(SESSION_COOKIE)
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
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            posting = await repository.create_job_posting(
                JobPostingCreate(
                    organization_id=session["organization_id"],
                    title=payload.title,
                    description=payload.description,
                    deadline_at=payload.deadline_at,
                )
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"posting": posting.model_dump()}


@router.get("/postings")
async def list_postings(session: dict[str, Any] = ORG_SESSION_DEPENDENCY) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            rows = await repository.list_job_postings(session["organization_id"])
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"postings": rows}


@router.delete("/postings/{posting_id}")
async def delete_posting(
    posting_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            await repository.delete_job_posting(posting_id, organization_id)
            return {"status": "ok", "message": "Job posting deleted successfully."}
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


class TogglePostingStatusRequest(BaseModel):
    is_active: bool


@router.patch("/postings/{posting_id}/status")
async def toggle_posting_status(
    posting_id: int,
    payload: TogglePostingStatusRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            await repository.toggle_job_posting_status(
                posting_id, organization_id, payload.is_active
            )
            return {
                "status": "ok",
                "message": f"Job posting is now {'active' if payload.is_active else 'inactive'}.",
            }
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/postings/{posting_id}/candidates")
async def list_candidates(
    posting_id: int,
    min_gpa: float | None = None,
    class_year: int | None = None,
    min_experience_years: int | None = None,
    limit: int = 50,
    offset: int = 0,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
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
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidates": rows}


@router.get("/postings/{posting_id}/candidates/{candidate_id}")
async def get_candidate(
    posting_id: int,
    candidate_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            candidate = await repository.get_candidate(candidate_id, organization_id, posting_id)
            if candidate is None:
                raise HTTPException(status_code=404, detail="Candidate not found.")
            debate = await repository.latest_debate_result(candidate_id, organization_id)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidate": candidate.model_dump(exclude={"cv_embedding"}), "debate": debate}


@router.post("/postings/{posting_id}/candidates/search")
async def search_candidates(
    posting_id: int,
    payload: CandidateSearchRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            job_description = payload.job_description or posting["description"]
            async with _create_mistral_client() as mistral:
                service = HybridSearchService(mistral_client=mistral, repository=repository)
                results = await service.rank(
                    organization_id=organization_id,
                    job_posting_id=posting_id,
                    job_description=job_description,
                    min_gpa=payload.min_gpa,
                    class_year=payload.class_year,
                    min_experience_years=payload.min_experience_years,
                    limit=payload.limit,
                )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidates": results}


@router.post("/postings/{posting_id}/candidates/upload")
async def upload_candidates(
    posting_id: int,
    files: list[UploadFile] = UPLOAD_FILES_DEPENDENCY,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]

    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=400, detail=f"Upload at most {MAX_UPLOAD_FILES} files at a time."
        )

    created: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    try:
        async with CandidateRepository(settings.database_url) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            async with _create_mistral_client() as mistral:
                pipeline = ResumeIngestionPipeline(
                    mistral_client=mistral,
                    repository=repository,
                    organization_id=organization_id,
                    job_posting_id=posting_id,
                    max_concurrency=settings.max_concurrency,
                )
                for upload in files:
                    filename = upload.filename or "resume.pdf"
                    try:
                        document_bytes = await upload.read()
                        candidate = await pipeline.ingest_bytes(document_bytes, filename=filename)
                        created.append(
                            {
                                "id": candidate.id,
                                "full_name": candidate.full_name,
                                "filename": filename,
                            }
                        )
                    except MistralClientError as exc:
                        errors.append({"filename": filename, "detail": str(exc)})
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"created": created, "errors": errors}


@router.get("/postings/{posting_id}/rankings/top")
async def top_rankings(
    posting_id: int,
    limit: int = 5,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            await _get_posting_or_404(repository, posting_id, organization_id)
            rows = await repository.top_results(organization_id, posting_id, limit=limit)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"results": rows}


@router.post("/postings/{posting_id}/debate")
async def run_debate(
    posting_id: int,
    payload: DebateRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with CandidateRepository(settings.database_url) as repository:
            posting = await _get_posting_or_404(repository, posting_id, organization_id)
            candidate = await repository.get_candidate(
                payload.candidate_id, organization_id, posting_id
            )
            if candidate is None:
                raise HTTPException(status_code=404, detail="Candidate not found.")

            job_description = payload.job_description or posting["description"]
            async with _create_mistral_client() as mistral:
                graph = DebateGraph(mistral)
                result = await graph.evaluate(
                    organization_id=organization_id,
                    candidate_id=candidate.id,
                    cv_text=candidate.raw_cv_text,
                    job_description=job_description,
                )
                result_id = await repository.save_debate_result(result)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"id": result_id, **result.model_dump()}
