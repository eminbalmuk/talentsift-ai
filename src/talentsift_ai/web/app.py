from fastapi import FastAPI

from talentsift_ai.web.admin import router as admin_router
from talentsift_ai.web.candidate import router as candidate_router
from talentsift_ai.web.organization import router as organization_router

app = FastAPI(title="TalentSift AI API")
app.include_router(admin_router)
app.include_router(organization_router)
app.include_router(candidate_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
