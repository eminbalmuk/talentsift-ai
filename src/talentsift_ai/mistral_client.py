import asyncio
import base64
import itertools
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel

from talentsift_ai.models import MistralModel


class MistralClientError(RuntimeError):
    """Raised when the Mistral API returns an error or unexpected payload."""


class MistralClient:
    def __init__(
        self,
        api_keys: Iterable[str],
        base_url: str = "https://api.mistral.ai/v1",
        timeout_seconds: float = 120.0,
        max_concurrency: int = 16,
    ) -> None:
        keys = [key for key in api_keys if key]
        if not keys:
            raise ValueError("At least one Mistral API key is required.")

        self._keys = itertools.cycle(keys)
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=timeout_seconds)
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "MistralClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.close()

    async def ocr_pdf(self, pdf_path: Path, model: str = MistralModel.OCR) -> str:
        payload = {
            "model": model,
            "document": {
                "type": "document_url",
                "document_url": self._pdf_data_url(pdf_path),
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
        response = await self._post("/chat/completions", payload)
        content = response["choices"][0]["message"]["content"]
        return response_model.model_validate_json(content)

    async def embed(self, text: str, model: str = MistralModel.EMBEDDING) -> list[float]:
        payload = {"model": model, "inputs": [text]}
        response = await self._post("/embeddings", payload)
        return response["data"][0]["embedding"]

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with self._semaphore:
            response = await self._client.post(
                f"{self._base_url}{path}",
                headers={
                    "Authorization": f"Bearer {next(self._keys)}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

        if response.status_code >= 400:
            raise MistralClientError(f"Mistral API error {response.status_code}: {response.text}")
        return response.json()

    @staticmethod
    def _pdf_data_url(pdf_path: Path) -> str:
        encoded = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
        return f"data:application/pdf;base64,{encoded}"

    @staticmethod
    def _extract_markdown(response: dict[str, Any]) -> str:
        pages = response.get("pages", [])
        if pages:
            return "\n\n".join(page.get("markdown", "") for page in pages).strip()

        text = response.get("text") or response.get("markdown")
        if isinstance(text, str):
            return text.strip()

        raise MistralClientError("OCR response did not contain pages markdown or text.")

