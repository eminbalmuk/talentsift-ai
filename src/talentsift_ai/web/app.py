import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from talentsift_ai.observability import configure_phoenix
from talentsift_ai.pipeline.embeddings import (
    UltraBERTEmbedder,
    close_cached_embedders,
    get_embedder,
)
from talentsift_ai.settings import get_settings
from talentsift_ai.web import db
from talentsift_ai.web.admin import router as admin_router
from talentsift_ai.web.candidate import router as candidate_router
from talentsift_ai.web.mistral_usage import close_shared_mistral_client
from talentsift_ai.web.organization import router as organization_router

logger = logging.getLogger(__name__)

_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_phoenix(settings.phoenix_project_name, settings.phoenix_collector_endpoint)
    await db.init_pool(settings.database_url)

    if (
        settings.warmup_embeddings_on_startup
        and settings.embedding_provider.lower() == "ultrabert"
    ):
        try:
            embedder = get_embedder(settings)
            if isinstance(embedder, UltraBERTEmbedder):
                await asyncio.to_thread(embedder._ensure_model_loaded)
        except Exception:
            logger.warning(
                "UltraBERT startup warm-up skipped; will lazy-load on demand.", exc_info=True
            )

    yield
    await close_cached_embedders()
    await close_shared_mistral_client()
    await db.close_pool()


app = FastAPI(title="TalentSift AI API", lifespan=lifespan)


def _is_same_origin(origin: str, request: Request) -> bool:
    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    req_host = (
        request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    ).lower()
    origin_host = parsed.netloc.lower()
    if req_host and origin_host == req_host:
        return True
    # Allow localhost <-> 127.0.0.1 pairing in local Next.js proxy setups
    local_aliases = {"localhost", "127.0.0.1"}
    if (
        parsed.hostname in local_aliases
        and req_host.split(":")[0] in local_aliases
    ):
        return True
    return False


@app.middleware("http")
async def security_and_csrf_middleware(request: Request, call_next) -> Response:
    if request.method in _UNSAFE_METHODS and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin")
        if origin and not _is_same_origin(origin, request):
            return JSONResponse(
                status_code=403,
                content={"detail": "Cross-site origin is not permitted."},
            )

    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault(
        "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
    )
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store, private")
        response.headers.setdefault("Pragma", "no-cache")
    return response


app.include_router(admin_router)
app.include_router(organization_router)
app.include_router(candidate_router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
