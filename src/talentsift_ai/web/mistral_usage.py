"""Builds a shared MistralClient + context-scoped usage_callback for web endpoints,
so key rotation, cooldowns, concurrency limits, and token accounting work globally.
"""

import contextvars
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient, UsageCallback
from talentsift_ai.settings import get_settings
from talentsift_ai.web.db import get_pool

logger = logging.getLogger(__name__)

_ORGANIZATION_ID_CTX: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "mistral_usage_organization_id", default=None
)
_SHARED_MISTRAL_CLIENT: MistralClient | None = None


@contextmanager
def usage_organization_scope(organization_id: int | None) -> Iterator[None]:
    token = _ORGANIZATION_ID_CTX.set(organization_id)
    try:
        yield
    finally:
        _ORGANIZATION_ID_CTX.reset(token)


def make_usage_callback(organization_id: int | None = None) -> UsageCallback:
    async def _callback(event: dict[str, Any]) -> None:
        scoped_org_id = _ORGANIZATION_ID_CTX.get()
        effective_org_id = scoped_org_id if scoped_org_id is not None else organization_id
        try:
            repository = CandidateRepository(pool=get_pool())
            await repository.record_mistral_usage(
                model=event.get("model") or "unknown",
                endpoint=event.get("endpoint") or "unknown",
                organization_id=effective_org_id,
                prompt_tokens=event.get("prompt_tokens"),
                completion_tokens=event.get("completion_tokens"),
                total_tokens=event.get("total_tokens"),
                success=bool(event.get("success")),
            )
        except Exception:
            logger.warning("Failed to record Mistral usage", exc_info=True)

    return _callback


def get_shared_mistral_client() -> MistralClient:
    global _SHARED_MISTRAL_CLIENT
    if _SHARED_MISTRAL_CLIENT is None:
        settings = get_settings()
        _SHARED_MISTRAL_CLIENT = MistralClient(
            api_keys=settings.mistral_api_keys,
            base_url=settings.mistral_base_url,
            timeout_seconds=settings.request_timeout_seconds,
            max_concurrency=settings.max_concurrency,
            usage_callback=make_usage_callback(),
        )
    return _SHARED_MISTRAL_CLIENT


async def close_shared_mistral_client() -> None:
    global _SHARED_MISTRAL_CLIENT
    if _SHARED_MISTRAL_CLIENT is not None:
        await _SHARED_MISTRAL_CLIENT.close()
        _SHARED_MISTRAL_CLIENT = None
