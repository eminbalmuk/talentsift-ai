import logging
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, EmailStr, Field

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClientError
from talentsift_ai.pipeline import (
    ResumeIngestionPipeline,
    extract_skill_matches,
    get_embedder,
    lexical_overlap_score,
)
from talentsift_ai.pipeline.ingest import SUPPORTED_RESUME_EXTENSIONS
from talentsift_ai.pipeline.reranker import calculate_competency_score
from talentsift_ai.settings import get_settings
from talentsift_ai.web.db import get_pool
from talentsift_ai.web.mistral_usage import get_shared_mistral_client, usage_organization_scope
from talentsift_ai.web.security import (
    create_signed_session,
    enforce_auth_rate_limit,
    validate_resume_magic_bytes,
    validate_safe_filename,
    verify_signed_session,
)

logger = logging.getLogger(__name__)

CANDIDATE_SESSION_COOKIE = "talentsift_candidate_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then try again."
)

router = APIRouter(prefix="/api/candidate", tags=["candidate"])
CANDIDATE_FILE_DEPENDENCY = File(...)
SUPPORTED_CV_EXTENSIONS = SUPPORTED_RESUME_EXTENSIONS
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MiB


class CandidateRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1, max_length=255)


class CandidateLoginRequest(BaseModel):
    email: EmailStr
    password: str


def _get_session_secret() -> str:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")
    return secret


def _set_candidate_cookie(response: Response, candidate: dict[str, Any]) -> None:
    settings = get_settings()
    secret = _get_session_secret()
    cookie_value = create_signed_session(
        {
            "role": "candidate",
            "candidate_id": candidate["id"],
            "email": candidate["email"],
        },
        secret,
    )
    response.set_cookie(
        key=CANDIDATE_SESSION_COOKIE,
        value=cookie_value,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=28_800,
        path="/",
    )


async def get_candidate_session(
    session_cookie: str | None = Cookie(default=None, alias=CANDIDATE_SESSION_COOKIE),
) -> dict[str, Any]:
    secret = _get_session_secret()
    session = verify_signed_session(session_cookie or "", secret, expected_role="candidate")
    if session is None or not isinstance(session.get("candidate_id"), int):
        raise HTTPException(status_code=401, detail="Candidate login required.")
    return session


CANDIDATE_SESSION_DEPENDENCY = Depends(get_candidate_session)


@router.post("/register")
async def register_candidate(
    request: Request, payload: CandidateRegisterRequest, response: Response
) -> dict[str, Any]:
    enforce_auth_rate_limit(request, scope="candidate_register")
    settings = get_settings()
    _get_session_secret()

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            candidate = await repository.create_candidate_user(
                email=payload.email,
                password=payload.password,
                full_name=payload.full_name,
                credential_pepper=settings.product_key_pepper,
            )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(status_code=409, detail="Bu e-posta adresi zaten kayıtlı.") from exc
    except asyncpg.DataError as exc:
        raise HTTPException(status_code=422, detail=f"Geçersiz kayıt verisi: {exc}") from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    _set_candidate_cookie(response, candidate)
    return {"status": "ok", "candidate": candidate}


@router.post("/login")
async def login_candidate(
    request: Request, payload: CandidateLoginRequest, response: Response
) -> dict[str, Any]:
    enforce_auth_rate_limit(request, scope="candidate_login")
    settings = get_settings()
    _get_session_secret()

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            candidate = await repository.authenticate_candidate_user(
                email=payload.email,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    if candidate is None:
        raise HTTPException(status_code=401, detail="E-posta veya şifre hatalı.")

    _set_candidate_cookie(response, candidate)
    return {"status": "ok", "candidate": candidate}


@router.post("/logout")
async def logout_candidate(response: Response) -> dict[str, str]:
    settings = get_settings()
    response.delete_cookie(
        CANDIDATE_SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )
    return {"status": "ok"}


@router.get("/profile")
async def get_profile(session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY) -> dict[str, Any]:
    candidate_id = session["candidate_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            profile = await repository.get_candidate_profile(candidate_id)
            if profile is None:
                raise HTTPException(status_code=404, detail="Candidate profile not found.")
            return profile
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/cv/upload")
async def upload_cv(
    file: UploadFile = CANDIDATE_FILE_DEPENDENCY,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Parses uploaded PDF/Word/Markdown/Text CV once, generates its embedding via UltraBERT
    (or configured provider), updates the candidate's master profile, and refreshes pre-LLM
    scores for all existing applications.
    """
    candidate_id = session["candidate_id"]

    filename = validate_safe_filename(file.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_CV_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Yalnızca PDF, Word (.docx), .txt veya .md dosyaları desteklenir.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Yüklenen dosya boş olamaz.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Dosya boyutu 10 MB sınırını aşıyor.",
        )
    try:
        validate_resume_magic_bytes(content, suffix)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        mistral = get_shared_mistral_client()
        async with CandidateRepository(pool=get_pool()) as repository:
            with usage_organization_scope(None):
                pipeline = ResumeIngestionPipeline(
                    mistral_client=mistral, repository=repository
                )
                extracted = await pipeline.process_bytes(content, filename=filename)

            profile = await repository.save_candidate_profile(
                candidate_id=candidate_id,
                university=extracted.structured_data.university,
                gpa=extracted.structured_data.gpa,
                current_class=extracted.structured_data.current_class,
                experience_years=extracted.structured_data.experience_years,
                skills=extracted.structured_data.skills,
                raw_cv_text=extracted.raw_cv_text,
                cv_embedding=extracted.embedding,
                source_path=filename,
            )

            scoring_profile = {**profile, "raw_cv_text": extracted.raw_cv_text}
            existing_apps = await repository.list_candidate_applications_for_rescore(candidate_id)
            for app_row in existing_apps:
                await _score_application_against_posting(
                    repository=repository,
                    candidate_id=candidate_id,
                    organization_id=app_row["organization_id"],
                    job_posting_id=app_row["job_posting_id"],
                    posting_description=app_row["description"],
                    candidate_profile=scoring_profile,
                )

            return {
                "status": "ok",
                "message": "CV başarıyla yüklendi ve vektörleştirildi.",
                "profile": profile,
            }
    except MistralClientError as exc:
        raise HTTPException(status_code=502, detail=f"Mistral API hatası: {exc}") from exc
    except (ValueError, asyncpg.DataError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/jobs")
async def list_jobs(session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            jobs = await repository.list_open_job_postings()
            return {"jobs": jobs}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/jobs/{job_posting_id}")
async def get_job(
    job_posting_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            posting = await repository.get_open_job_posting(job_posting_id)
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if posting is None:
        raise HTTPException(status_code=404, detail="İlan bulunamadı veya artık aktif değil.")
    return {"job": posting}


async def _score_application_against_posting(
    *,
    repository: CandidateRepository,
    candidate_id: int,
    organization_id: int,
    job_posting_id: int,
    posting_description: str,
    candidate_profile: dict[str, Any],
) -> None:
    """
    Scores a single application against its posting immediately so the pre-LLM view
    and explainability breakdown stay up to date after applying or re-uploading a CV.
    """
    try:
        settings = get_settings()
        posting_embedding = await repository.get_posting_embedding(job_posting_id)
        if posting_embedding is None:
            mistral = (
                get_shared_mistral_client()
                if settings.embedding_provider.lower() == "mistral"
                else None
            )
            with usage_organization_scope(organization_id):
                embedder = get_embedder(settings, mistral_client=mistral)
                posting_embedding = await embedder.embed_query(posting_description)
            await repository.set_posting_embedding(job_posting_id, posting_embedding)

        dense_similarity = await repository.get_candidate_similarity(
            candidate_id=candidate_id,
            organization_id=organization_id,
            job_posting_id=job_posting_id,
            query_embedding=posting_embedding,
        )
        skill_matches = extract_skill_matches(posting_description, candidate_profile)
        sparse_similarity: float | None = None
        if dense_similarity is not None:
            sparse_similarity = lexical_overlap_score(posting_description, candidate_profile)
            relevance_score = round(
                settings.hybrid_dense_weight * max(0.0, dense_similarity)
                + settings.hybrid_sparse_weight * sparse_similarity,
                4,
            )
        else:
            relevance_score = None

        competency_score = calculate_competency_score(candidate_profile)
        pre_llm_score = (
            round(0.65 * relevance_score + 0.35 * competency_score, 4)
            if relevance_score is not None
            else None
        )
        await repository.upsert_application_score(
            job_posting_id=job_posting_id,
            candidate_id=candidate_id,
            relevance_score=relevance_score,
            competency_score=competency_score,
            pre_llm_score=pre_llm_score,
            dense_score=round(max(0.0, dense_similarity), 4)
            if dense_similarity is not None
            else None,
            sparse_score=round(sparse_similarity, 4)
            if sparse_similarity is not None
            else None,
            matched_skills=skill_matches["matched_skills"],
            missing_skills=skill_matches["missing_skills"],
        )
    except (MistralClientError, OSError, TimeoutError, ValueError, asyncpg.PostgresError):
        logger.exception(
            "Pre-LLM scoring failed for candidate %s on posting %s", candidate_id, job_posting_id
        )


@router.post("/jobs/{job_posting_id}/apply")
async def apply_for_job(
    job_posting_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Submits an instant application using the candidate's already-embedded master CV profile.
    """
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            profile = await repository.get_candidate_profile(candidate_id)
            if not profile or not profile.get("has_embedding"):
                raise HTTPException(
                    status_code=400,
                    detail="İlanlara başvurmadan önce CV profilinizi yüklemeniz gerekir.",
                )

            job_item = await repository.get_open_job_posting(job_posting_id)
            if job_item is None:
                raise HTTPException(
                    status_code=404,
                    detail="İlan bulunamadı, son başvuru tarihi geçmiş veya artık aktif değil.",
                )

            application = await repository.create_job_application(
                job_posting_id=job_posting_id,
                candidate_id=candidate_id,
                organization_id=job_item["organization_id"],
            )
            await _score_application_against_posting(
                repository=repository,
                candidate_id=candidate_id,
                organization_id=job_item["organization_id"],
                job_posting_id=job_posting_id,
                posting_description=job_item["description"],
                candidate_profile=profile,
            )
            return {
                "status": "ok",
                "message": "Başvurunuz başarıyla alındı.",
                "application": application,
            }
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/jobs/{job_posting_id}/withdraw")
async def withdraw_application(
    job_posting_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """Withdraws a pending ('applied') job application."""
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            success = await repository.withdraw_job_application(
                job_posting_id=job_posting_id, candidate_id=candidate_id
            )
            if not success:
                existing_apps = await repository.list_candidate_applications(candidate_id)
                if any(app["job_posting_id"] == job_posting_id for app in existing_apps):
                    raise HTTPException(
                        status_code=409,
                        detail="Sonuçlandırılmış bir başvuru geri çekilemez.",
                    )
                raise HTTPException(status_code=404, detail="Aktif başvuru bulunamadı.")
            return {"status": "ok", "message": "Başvurunuz geri çekildi."}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.delete("/cv")
async def delete_cv(
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Deletes candidate's uploaded CV profile unless an active job application exists.
    """
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            if await repository.has_active_application(candidate_id):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Aktif bir ilan başvurunuz olduğu için CV'nizi silemezsiniz. "
                        "Güncellemek için yeni bir CV yükleyebilirsiniz."
                    ),
                )
            await repository.delete_candidate_profile(candidate_id)
            return {"status": "ok", "message": "CV profiliniz silindi."}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/applications")
async def list_my_applications(
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    candidate_id = session["candidate_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            apps = await repository.list_candidate_applications(candidate_id)
            return {"applications": apps}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.get("/notifications")
async def list_notifications(
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    candidate_id = session["candidate_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            notifications = await repository.list_candidate_notifications(candidate_id)
            return {"notifications": notifications}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    candidate_id = session["candidate_id"]
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            ok = await repository.mark_notification_read(notification_id, candidate_id)
            if not ok:
                raise HTTPException(status_code=404, detail="Notification not found.")
            return {"status": "ok"}
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


class InterviewResponseRequest(BaseModel):
    action: str = Field(pattern="^(confirm|decline)$")


@router.post("/interviews/{interview_id}/respond")
async def respond_to_interview(
    interview_id: int,
    payload: InterviewResponseRequest,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    candidate_id = session["candidate_id"]
    new_status = "confirmed" if payload.action == "confirm" else "declined"
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            interview = await repository.respond_to_interview(
                interview_id, candidate_id, new_status
            )
            if interview is None:
                raise HTTPException(status_code=404, detail="Mülakat teklifi bulunamadı.")
            return {"status": "ok", "interview": interview}
    except asyncpg.DataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
