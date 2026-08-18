import asyncio
import base64
import itertools
import logging
import random
from collections.abc import Awaitable, Callable, Iterable
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel

from talentsift_ai.models import MistralModel

MAX_RATE_LIMIT_RETRIES = 4
RETRY_BASE_DELAY_SECONDS = 1.0

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


class MistralClient:
    def __init__(
        self,
        api_keys: Iterable[str],
        base_url: str = "https://api.mistral.ai/v1",
        timeout_seconds: float = 120.0,
        max_concurrency: int = 16,
        usage_callback: UsageCallback | None = None,
    ) -> None:
        keys = [key for key in api_keys if key]
        if not keys:
            raise ValueError("At least one Mistral API key is required.")

        self._keys = itertools.cycle(keys)
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_seconds)
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._usage_callback = usage_callback

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
        schema = response_model.model_json_schema()
        payload = {
            "model": model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
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
        content = response["choices"][0]["message"]["content"]
        return response_model.model_validate_json(content)

    async def embed(self, text: str, model: str = MistralModel.EMBEDDING) -> list[float]:
        payload = {"model": model, "input": [text]}
        response = await self._post("/embeddings", payload)
        return response["data"][0]["embedding"]

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        response: httpx.Response | None = None
        for attempt in range(MAX_RATE_LIMIT_RETRIES):
            async with self._semaphore:
                response = await self._client.post(
                    f"{self._base_url}{path}",
                    headers={
                        "Authorization": f"Bearer {next(self._keys)}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

            if response.status_code != 429:
                break
            if attempt == MAX_RATE_LIMIT_RETRIES - 1:
                break

            retry_after = response.headers.get("retry-after")
            delay = (
                float(retry_after)
                if retry_after
                else RETRY_BASE_DELAY_SECONDS * (2**attempt) + random.uniform(0, 1)
            )
            await asyncio.sleep(delay)

        success = response.status_code < 400
        if self._usage_callback is not None:
            await self._report_usage(path, payload, response, success)

        if not success:
            raise MistralClientError(f"Mistral API error {response.status_code}: {response.text}")
        return response.json()

    async def _report_usage(
        self, path: str, payload: dict[str, Any], response: httpx.Response, success: bool
    ) -> None:
        usage: dict[str, Any] = {}
        if success:
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

