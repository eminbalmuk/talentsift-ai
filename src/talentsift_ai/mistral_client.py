import asyncio
import base64
import copy
import logging
import random
import re
import time
from collections.abc import Awaitable, Callable, Iterable
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from talentsift_ai.models import MistralModel

MAX_RATE_LIMIT_RETRIES = 4
RETRY_BASE_DELAY_SECONDS = 1.0
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}
CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)

# Reported to an optional usage_callback after every API call so usage can be tracked
# for the admin usage panel -- kept as a plain dict (not a DB model) since MistralClient
# has no DB dependency and shouldn't gain one just to log usage.
UsageCallback = Callable[[dict[str, Any]], Awaitable[None]]

logger = logging.getLogger(__name__)

SUPPORTED_DOCUMENT_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class MistralClientError(RuntimeError):
    """Raised when the Mistral API returns an error or unexpected payload."""


def resolve_document_mime_type(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    mime_type = SUPPORTED_DOCUMENT_MIME_TYPES.get(suffix)
    if mime_type is None:
        raise MistralClientError(f"Unsupported resume file type: {suffix or filename!r}")
    return mime_type


def _strict_json_schema(raw_schema: dict[str, Any]) -> dict[str, Any]:
    """Ensures Pydantic v2 JSON schemas satisfy strict json_schema mode."""
    schema = copy.deepcopy(raw_schema)

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node.setdefault("additionalProperties", False)
                props = node["properties"]
                if isinstance(props, dict):
                    node["required"] = list(props.keys())
            for val in node.values():
                _walk(val)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(schema)
    return schema


def _parse_retry_after(header_val: str | None, fallback: float) -> float:
    if not header_val:
        return fallback
    stripped = header_val.strip()
    try:
        return max(0.25, min(60.0, float(stripped)))
    except ValueError:
        pass
    try:
        dt = parsedate_to_datetime(stripped)
        delay = dt.timestamp() - time.time()
        return max(0.25, min(60.0, delay))
    except (TypeError, ValueError, OverflowError):
        return fallback


def _strip_json_fences(text: str) -> str:
    cleaned = text.strip()
    match = CODE_FENCE_RE.match(cleaned)
    if match:
        return match.group(1).strip()
    return cleaned


class MistralClient:
    def __init__(
        self,
        api_keys: Iterable[str],
        base_url: str = "https://api.mistral.ai/v1",
        timeout_seconds: float = 120.0,
        max_concurrency: int = 16,
        usage_callback: UsageCallback | None = None,
    ) -> None:
        keys = [key.strip() for key in api_keys if key and key.strip()]
        if not keys:
            raise ValueError("At least one Mistral API key is required.")

        self._keys: list[str] = keys
        self._key_index = 0
        self._key_cooldowns: dict[str, float] = {}
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_seconds)
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._usage_callback = usage_callback

    def _next_api_key(self) -> str:
        now = time.monotonic()
        n = len(self._keys)
        for offset in range(n):
            idx = (self._key_index + offset) % n
            candidate = self._keys[idx]
            if self._key_cooldowns.get(candidate, 0.0) <= now:
                self._key_index = (idx + 1) % n
                return candidate
        # All keys are cooling; pick the one expiring soonest.
        soonest = min(self._keys, key=lambda k: self._key_cooldowns.get(k, 0.0))
        self._key_index = (self._keys.index(soonest) + 1) % n
        return soonest

    def _mark_key_cooldown(self, key: str, seconds: float) -> None:
        self._key_cooldowns[key] = max(
            self._key_cooldowns.get(key, 0.0), time.monotonic() + seconds
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "MistralClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def ocr_document(self, document_path: Path, model: str = MistralModel.OCR) -> str:
        return await self.ocr_document_bytes(
            document_path.read_bytes(),
            mime_type=resolve_document_mime_type(document_path.name),
            model=model,
        )

    async def ocr_document_bytes(
        self, document_bytes: bytes, *, mime_type: str, model: str = MistralModel.OCR
    ) -> str:
        payload = {
            "model": model,
            "document": {
                "type": "document_url",
                "document_url": self._document_data_url(document_bytes, mime_type),
            },
        }
        response = await self._post("/ocr", payload)
        return self._extract_markdown(response)

    async def chat_json(
        self,
        *,
        model: str,
        system_prompt: str,
        user_prompt: str,
        response_model: type[BaseModel],
        temperature: float = 0.1,
        max_tokens: int | None = None,
    ) -> BaseModel:
        schema = _strict_json_schema(response_model.model_json_schema())
        base_messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        last_error: Exception | None = None
        for repair_attempt in range(2):
            messages = list(base_messages)
            if repair_attempt == 1 and last_error is not None:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Previous JSON failed validation. Return ONLY valid JSON matching the "
                            f"schema with no truncation or markdown fences. Error: {last_error}"
                        ),
                    }
                )
            payload: dict[str, Any] = {
                "model": model,
                "temperature": temperature,
                "messages": messages,
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {
                        "name": response_model.__name__,
                        "schema": schema,
                        "strict": True,
                    },
                },
            }
            if max_tokens is not None:
                payload["max_tokens"] = max_tokens

            response = await self._post("/chat/completions", payload)
            try:
                choice = response["choices"][0]
                finish_reason = choice.get("finish_reason")
                raw_content = choice["message"]["content"]
            except (KeyError, IndexError, TypeError) as exc:
                raise MistralClientError("Unexpected chat/completions response format.") from exc

            if not isinstance(raw_content, str):
                raise MistralClientError("Mistral chat/completions content was not text.")
            if finish_reason == "length":
                last_error = ValueError("Response was truncated at max_tokens.")
                continue

            cleaned = _strip_json_fences(raw_content)
            try:
                return response_model.model_validate_json(cleaned)
            except ValidationError as exc:
                last_error = exc
                logger.warning(
                    "Mistral JSON validation failed (attempt %d): %s", repair_attempt + 1, exc
                )

        raise MistralClientError(
            f"Mistral response could not be validated as {response_model.__name__}: {last_error}"
        )

    async def embed(self, text: str, model: str = MistralModel.EMBEDDING) -> list[float]:
        payload = {"model": model, "input": [text]}
        response = await self._post("/embeddings", payload)
        return response["data"][0]["embedding"]

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response: httpx.Response | None = None
        last_exc: httpx.HTTPError | None = None

        for attempt in range(MAX_RATE_LIMIT_RETRIES):
            api_key = self._next_api_key()
            try:
                async with self._semaphore:
                    response = await self._client.post(
                        f"{self._base_url}{path}",
                        headers={
                            "Authorization": f"Bearer {api_key}",
                            "Content-Type": "application/json",
                        },
                        json=payload,
                    )
                last_exc = None
            except httpx.HTTPError as exc:
                last_exc = exc
                response = None
                if self._usage_callback is not None:
                    await self._report_usage(path, payload, None, False)
                if attempt == MAX_RATE_LIMIT_RETRIES - 1:
                    raise MistralClientError(
                        f"Mistral API transport error after retries: {exc}"
                    ) from exc
                delay = RETRY_BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 0.5)
                await asyncio.sleep(delay)
                continue

            if response.status_code == 401:
                self._mark_key_cooldown(api_key, 300.0)
                if len(self._keys) > 1 and attempt < MAX_RATE_LIMIT_RETRIES - 1:
                    continue
                break

            if response.status_code not in TRANSIENT_STATUS_CODES:
                break

            if response.status_code == 429:
                fallback = RETRY_BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 1.0)
                delay = _parse_retry_after(response.headers.get("retry-after"), fallback)
                self._mark_key_cooldown(api_key, min(delay, 30.0))
            else:
                delay = RETRY_BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 0.5)

            if attempt == MAX_RATE_LIMIT_RETRIES - 1:
                break

            if self._usage_callback is not None:
                await self._report_usage(path, payload, response, False)
            await asyncio.sleep(delay)

        if response is None:
            raise MistralClientError(f"Mistral API request failed: {last_exc}")

        success = response.status_code < 400
        if self._usage_callback is not None:
            await self._report_usage(path, payload, response, success)

        if not success:
            raise MistralClientError(f"Mistral API error {response.status_code}: {response.text}")
        return response.json()

    async def _report_usage(
        self,
        path: str,
        payload: dict[str, Any],
        response: httpx.Response | None,
        success: bool,
    ) -> None:
        usage: dict[str, Any] = {}
        if success and response is not None:
            try:
                usage = response.json().get("usage") or {}
            except ValueError:
                usage = {}
        try:
            await self._usage_callback(
                {
                    "model": payload.get("model", "unknown"),
                    "endpoint": path.lstrip("/"),
                    "prompt_tokens": usage.get("prompt_tokens"),
                    "completion_tokens": usage.get("completion_tokens"),
                    "total_tokens": usage.get("total_tokens"),
                    "success": success,
                }
            )
        except Exception:
            logger.warning("Mistral usage_callback failed", exc_info=True)

    @staticmethod
    def _document_data_url(document_bytes: bytes, mime_type: str) -> str:
        encoded = base64.b64encode(document_bytes).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    @staticmethod
    def _extract_markdown(response: dict[str, Any]) -> str:
        pages = response.get("pages", [])
        if pages:
            return "\n\n".join(page.get("markdown", "") for page in pages).strip()

        text = response.get("text") or response.get("markdown")
        if isinstance(text, str):
            return text.strip()

        raise MistralClientError("OCR response did not contain pages markdown or text.")
