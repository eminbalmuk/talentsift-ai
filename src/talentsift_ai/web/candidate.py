import tempfile
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel, EmailStr, Field

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient, MistralClientError
from talentsift_ai.pipeline import ResumeIngestionPipeline
from talentsift_ai.settings import get_settings
from talentsift_ai.web.db import get_pool
from talentsift_ai.web.security import create_signed_session, verify_signed_session

CANDIDATE_SESSION_COOKIE = "talentsift_candidate_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then try again."
)

router = APIRouter(prefix="/api/candidate", tags=["candidate"])
CANDIDATE_FILE_DEPENDENCY = File(...)
SUPPORTED_CV_EXTENSIONS = (".pdf", ".docx")


class CandidateRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str = Field(min_length=1, max_length=255)


class CandidateLoginRequest(BaseModel):
    email: EmailStr
    password: str


async def get_candidate_session(
    session_cookie: str | None = Cookie(default=None, alias=CANDIDATE_SESSION_COOKIE),
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")
    session = verify_signed_session(session_cookie or "", secret)
    if session is None:
        raise HTTPException(status_code=401, detail="Candidate login required.")
    return session


CANDIDATE_SESSION_DEPENDENCY = Depends(get_candidate_session)


def _create_mistral_client() -> MistralClient:
    settings = get_settings()
    return MistralClient(
        api_keys=settings.mistral_api_keys,
        base_url=settings.mistral_base_url,
        timeout_seconds=settings.request_timeout_seconds,
        max_concurrency=settings.max_concurrency,
    )


@router.post("/register")
async def register_candidate(
    payload: CandidateRegisterRequest, response: Response
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            candidate = await repository.create_candidate_user(
                email=payload.email,
                password=payload.password,
                full_name=payload.full_name,
                credential_pepper=settings.product_key_pepper,
            )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(status_code=409, detail="Email is already registered.") from exc
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    cookie_value = create_signed_session(
        {"candidate_id": candidate["id"], "email": candidate["email"]}, secret
    )
    response.set_cookie(
        key=CANDIDATE_SESSION_COOKIE,
        value=cookie_value,
        httponly=True,
        samesite="lax",
    )
    return {"status": "ok", "candidate": candidate}


@router.post("/login")
async def login_candidate(
    payload: CandidateLoginRequest, response: Response
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Session secret is not configured.")

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            candidate = await repository.authenticate_candidate_user(
                email=payload.email,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc

    if candidate is None:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    cookie_value = create_signed_session(
        {"candidate_id": candidate["id"], "email": candidate["email"]}, secret
    )
    response.set_cookie(
        key=CANDIDATE_SESSION_COOKIE,
        value=cookie_value,
        httponly=True,
        samesite="lax",
    )
    return {"status": "ok", "candidate": candidate}


@router.post("/logout")
async def logout_candidate(response: Response) -> dict[str, str]:
    response.delete_cookie(CANDIDATE_SESSION_COOKIE)
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
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/cv/upload")
async def upload_cv(
    file: UploadFile = CANDIDATE_FILE_DEPENDENCY,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Parses uploaded PDF/Word CV once via Mistral OCR & Ministral-3B, generates embedding ONCE,
    and updates the candidate's master profile.
    """
    candidate_id = session["candidate_id"]

    suffix = Path(file.filename).suffix.lower() if file.filename else ""
    if suffix not in SUPPORTED_CV_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF or Word (.docx) files are supported.")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        async with _create_mistral_client() as mistral:
            async with CandidateRepository(pool=get_pool()) as repository:
                pipeline = ResumeIngestionPipeline(mistral_client=mistral, repository=repository)
                extracted = await pipeline.process_document(tmp_path)

                profile = await repository.save_candidate_profile(
                    candidate_id=candidate_id,
                    university=extracted.structured_data.university,
                    gpa=extracted.structured_data.gpa,
                    current_class=extracted.structured_data.current_class,
                    experience_years=extracted.structured_data.experience_years,
                    skills=extracted.structured_data.skills,
                    raw_cv_text=extracted.raw_cv_text,
                    cv_embedding=extracted.embedding,
                    source_path=file.filename,
                )
                return {
                    "status": "ok",
                    "message": "CV uploaded and embedded successfully.",
                    "profile": profile,
                }
    except MistralClientError as exc:
        raise HTTPException(status_code=502, detail=f"Mistral API error: {exc}") from exc
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


@router.get("/jobs")
async def list_jobs(session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            jobs = await repository.list_open_job_postings()
            return {"jobs": jobs}
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/jobs/{job_posting_id}/apply")
async def apply_for_job(
    job_posting_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Instantly applies to a job posting without re-embedding the candidate's CV ($O(1)$ action).
    """
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            profile = await repository.get_candidate_profile(candidate_id)
            if not profile or not profile.get("has_embedding"):
                raise HTTPException(
                    status_code=400,
                    detail="You must upload your CV profile before applying to job postings."
                )

            jobs = await repository.list_open_job_postings()
            job_item = next((j for j in jobs if j["id"] == job_posting_id), None)
            if job_item is None:
                raise HTTPException(status_code=404, detail="Job posting not found or inactive.")

            application = await repository.create_job_application(
                job_posting_id=job_posting_id,
                candidate_id=candidate_id,
                organization_id=job_item["organization_id"],
            )
            return {
                "status": "ok",
                "message": "Application submitted successfully.",
                "application": application,
            }
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.post("/jobs/{job_posting_id}/withdraw")
async def withdraw_application(
    job_posting_id: int,
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Withdraws a submitted job application.
    """
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            success = await repository.withdraw_job_application(
                job_posting_id=job_posting_id, candidate_id=candidate_id
            )
            if not success:
                raise HTTPException(status_code=404, detail="Active application not found.")
            return {"status": "ok", "message": "Application withdrawn successfully."}
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc


@router.delete("/cv")
async def delete_cv(
    session: dict[str, Any] = CANDIDATE_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    """
    Deletes candidate's uploaded CV profile.
    """
    candidate_id = session["candidate_id"]

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            await repository.delete_candidate_profile(candidate_id)
            return {"status": "ok", "message": "CV profile deleted successfully."}
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
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
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
