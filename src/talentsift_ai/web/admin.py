from typing import Any

import asyncpg
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.settings import get_settings
from talentsift_ai.web.db import get_pool
from talentsift_ai.web.security import create_signed_session, verify_signed_session

SESSION_COOKIE = "talentsift_admin_session"
DATABASE_ERROR_MESSAGE = (
    "Database is not reachable. Start local Postgres, run migrations, then provision admin."
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class OrganizationCreateRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=2000)


class OrganizationLicenseUpdateRequest(BaseModel):
    license_status: str = Field(pattern="^(active|trial|suspended|expired|pending)$")
    is_active: bool
    license_expires_at: str | None = None
    notes: str | None = Field(default=None, max_length=2000)


async def get_admin_session(
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Admin session secret is not configured.")
    session = verify_signed_session(session_cookie or "", secret)
    if session is None:
        raise HTTPException(status_code=401, detail="Admin login required.")
    return session


ADMIN_SESSION_DEPENDENCY = Depends(get_admin_session)


@router.post("/login")
async def login(payload: AdminLoginRequest, response: Response) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.admin_session_secret or settings.product_key_pepper
    if not secret:
        raise HTTPException(status_code=500, detail="Admin session secret is not configured.")

    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            identity = await repository.authenticate_admin(
                username=payload.username,
                password=payload.password,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if identity is None:
        raise HTTPException(status_code=401, detail="Invalid admin credentials.")

    token = create_signed_session(
        {"admin_id": identity["admin_id"], "username": identity["username"]},
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
    return {"ok": True, "username": identity["username"]}


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
async def me(session: dict[str, Any] = ADMIN_SESSION_DEPENDENCY) -> dict[str, Any]:
    return {"username": session["username"]}


@router.get("/organizations")
async def organizations(_: dict[str, Any] = ADMIN_SESSION_DEPENDENCY) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            rows = await repository.list_organizations()
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {"organizations": rows}


@router.post("/organizations")
async def create_organization(
    payload: OrganizationCreateRequest,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            credential = await repository.provision_organization_user(
                display_name=payload.display_name,
                notes=payload.notes,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return {
        "organization_id": credential.organization_id,
        "display_name": credential.display_name,
        "username": credential.username,
        "password": credential.password,
        "license_key": credential.license_key,
    }


@router.patch("/organizations/{organization_id}/license")
async def update_organization_license(
    organization_id: int,
    payload: OrganizationLicenseUpdateRequest,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            updated = await repository.update_organization_license(
                organization_id=organization_id,
                license_status=payload.license_status,
                is_active=payload.is_active,
                license_expires_at=payload.license_expires_at,
                notes=payload.notes,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {"organization": updated}


@router.post("/organizations/{organization_id}/approve")
async def approve_organization(
    organization_id: int,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            updated = await repository.update_organization_license(
                organization_id=organization_id,
                license_status="active",
                is_active=True,
            )
            rotated = await repository.rotate_organization_license_key(
                organization_id=organization_id,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if updated is None or rotated is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {
        "status": "ok",
        "message": "Organizasyon başarıyla onaylandı ve hesabı aktifleştirildi.",
        "organization": updated,
        "license_key": rotated.get("license_key"),
    }


@router.delete("/organizations/{organization_id}")
async def delete_organization(
    organization_id: int,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            deleted = await repository.delete_organization(organization_id)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return {"status": "ok", "message": "Organizasyon ve tüm verileri kalıcı olarak silindi."}


@router.post("/organizations/{organization_id}/license/rotate")
async def rotate_organization_license(
    organization_id: int,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    settings = get_settings()
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            rotated = await repository.rotate_organization_license_key(
                organization_id=organization_id,
                credential_pepper=settings.product_key_pepper,
            )
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    if rotated is None:
        raise HTTPException(status_code=404, detail="Organization not found.")
    return rotated


@router.get("/mistral-usage")
async def get_mistral_usage(
    hours: int = 24,
    _: dict[str, Any] = ADMIN_SESSION_DEPENDENCY,
) -> dict[str, Any]:
    try:
        async with CandidateRepository(pool=get_pool()) as repository:
            summary = await repository.get_mistral_usage_summary(since_hours=hours)
    except (OSError, TimeoutError, ValueError, asyncpg.PostgresError) as exc:
        raise HTTPException(status_code=503, detail=DATABASE_ERROR_MESSAGE) from exc
    return summary
