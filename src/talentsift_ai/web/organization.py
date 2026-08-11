from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from talentsift_ai.agents import DebateGraph
from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.pipeline import HybridSearchService
from talentsift_ai.settings import get_settings
from talentsift_ai.web.security import create_signed_session, verify_signed_session

SESSION_COOKIE = "talentsift_org_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then try again."
)

router = APIRouter(prefix="/api/org", tags=["organization"])


class OrgLoginRequest(BaseModel):
    username: str
    password: str


class CandidateSearchRequest(BaseModel):
    job_description: str = Field(min_length=1)
    min_gpa: float | None = None
    class_year: int | None = None
    min_experience_years: int | None = None
    limit: int = Field(default=50, ge=1, le=200)


class DebateRequest(BaseModel):
    candidate_id: int
    job_description: str = Field(min_length=1)


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


def _create_mistral_client() -> MistralClient:
    settings = get_settings()
    return MistralClient(
        api_keys=settings.mistral_api_keys,
        base_url=settings.mistral_base_url,
        timeout_seconds=settings.request_timeout_seconds,
        max_concurrency=settings.max_concurrency,
    )


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
        raise HTTPException(status_code=401, detail="Invalid organization credentials.")

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


@router.get("/candidates")
async def list_candidates(
    min_gpa: float | None = None,
    class_year: int | None = None,
    min_experience_years: int | None = None,
    limit: int = 50,
    offset: int = 0,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            rows = await repository.list_candidates(
                organization_id=session["organization_id"],
                min_gpa=min_gpa,
                class_year=class_year,
                min_experience_years=min_experience_years,
                limit=limit,
                offset=offset,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidates": rows}


@router.get("/candidates/{candidate_id}")
async def get_candidate(
    candidate_id: int,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            candidate = await repository.get_candidate(candidate_id, session["organization_id"])
            if candidate is None:
                raise HTTPException(status_code=404, detail="Candidate not found.")
            debate = await repository.latest_debate_result(
                candidate_id, session["organization_id"]
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidate": candidate.model_dump(exclude={"cv_embedding"}), "debate": debate}


@router.post("/candidates/search")
async def search_candidates(
    payload: CandidateSearchRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with _create_mistral_client() as mistral:
            async with CandidateRepository(settings.database_url) as repository:
                service = HybridSearchService(mistral_client=mistral, repository=repository)
                results = await service.rank(
                    organization_id=session["organization_id"],
                    job_description=payload.job_description,
                    min_gpa=payload.min_gpa,
                    class_year=payload.class_year,
                    min_experience_years=payload.min_experience_years,
                    limit=payload.limit,
                )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"candidates": results}


@router.get("/rankings/top")
async def top_rankings(
    limit: int = 5,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(settings.database_url) as repository:
            rows = await repository.top_results(session["organization_id"], limit=limit)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"results": rows}


@router.post("/debate")
async def run_debate(
    payload: DebateRequest,
    session: dict[str, Any] = ORG_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    organization_id = session["organization_id"]
    try:
        async with _create_mistral_client() as mistral:
            async with CandidateRepository(settings.database_url) as repository:
                candidate = await repository.get_candidate(payload.candidate_id, organization_id)
                if candidate is None:
                    raise HTTPException(status_code=404, detail="Candidate not found.")

                graph = DebateGraph(mistral)
                result = await graph.evaluate(
                    organization_id=organization_id,
                    candidate_id=candidate.id,
                    cv_text=candidate.raw_cv_text,
                    job_description=payload.job_description,
                )
                result_id = await repository.save_debate_result(result)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"id": result_id, **result.model_dump()}
