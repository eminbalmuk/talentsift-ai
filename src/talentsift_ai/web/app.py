from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from talentsift_ai.settings import get_settings
from talentsift_ai.web import db
from talentsift_ai.web.admin import router as admin_router
from talentsift_ai.web.candidate import router as candidate_router
from talentsift_ai.web.organization import router as organization_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await db.init_pool(get_settings().database_url)
    yield
    await db.close_pool()


app = FastAPI(title="TalentSift AI API", lifespan=lifespan)
app.include_router(admin_router)
app.include_router(organization_router)
app.include_router(candidate_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
