"""Builds the usage_callback MistralClient reports every call to, so the admin usage
panel can show real call/token counts against the account's rate limits.
"""

import logging
from typing import Any

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import UsageCallback
from talentsift_ai.web.db import get_pool

logger = logging.getLogger(__name__)


def make_usage_callback(organization_id: int | None = None) -> UsageCallback:
    async def _callback(event: dict[str, Any]) -> None:
        try:
            repository = CandidateRepository(pool=get_pool())
            await repository.record_mistral_usage(
                model=event.get("model") or "unknown",
                endpoint=event.get("endpoint") or "unknown",
                organization_id=organization_id,
                prompt_tokens=event.get("prompt_tokens"),
                completion_tokens=event.get("completion_tokens"),
                total_tokens=event.get("total_tokens"),
                success=bool(event.get("success")),
            )
        except Exception:
            logger.warning("Failed to record Mistral usage", exc_info=True)

    return _callback
