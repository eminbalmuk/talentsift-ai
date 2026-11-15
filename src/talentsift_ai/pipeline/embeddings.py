import asyncio
import logging
import os
import threading
from collections.abc import Sequence
from typing import Any, Protocol

import httpx
import numpy as np

from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.models import (
    DEFAULT_NIM_EMBEDDING_MODEL,
    MISTRAL_EMBEDDING_DIMENSIONS,
    NIM_EMBEDDING_BASE_URL,
    NIM_EMBEDDING_DIMENSIONS,
    ULTRABERT_EMBEDDING_DIMENSIONS,
    ULTRABERT_EMBEDDING_MODEL,
)
from talentsift_ai.settings import Settings, get_settings

logger = logging.getLogger(__name__)

DEFAULT_QUERY_INSTRUCTION = (
    "Instruct: Given a job description, retrieve matching candidate resumes\nQuery: "
)
_CHUNK_CHAR_LIMIT = 24_000
_CHUNK_OVERLAP = 2_000


class EmbeddingProvider(Protocol):
    dimensions: int

    async def embed_document(self, text: str) -> list[float]: ...

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    async def embed_query(self, text: str) -> list[float]: ...


def _split_long_text(text: str) -> list[str]:
    cleaned = text.strip()
    if not cleaned:
        return [" "]
    if len(cleaned) <= _CHUNK_CHAR_LIMIT:
        return [cleaned]
    chunks: list[str] = []
    step = _CHUNK_CHAR_LIMIT - _CHUNK_OVERLAP
    for start in range(0, len(cleaned), step):
        piece = cleaned[start : start + _CHUNK_CHAR_LIMIT]
        if piece.strip():
            chunks.append(piece)
        if start + _CHUNK_CHAR_LIMIT >= len(cleaned):
            break
    return chunks or [cleaned[:_CHUNK_CHAR_LIMIT]]


class UltraBERTEmbedder:
    """Local asymmetric semantic embedder powered by ``dmis-lab/UltraBERT-Embed-150M``.

    Uses CUDA ``bfloat16``/``float16`` + ``sdpa`` when available and falls back cleanly
    to CPU ``float32`` without touching Hugging Face network endpoints if cached locally.
    """

    def __init__(
        self,
        *,
        model_name: str = ULTRABERT_EMBEDDING_MODEL,
        dimensions: int = ULTRABERT_EMBEDDING_DIMENSIONS,
        device: str | None = None,
        local_files_only: bool = False,
        query_instruction: str = DEFAULT_QUERY_INSTRUCTION,
        batch_size: int = 8,
    ) -> None:
        self.model_name = model_name
        self.dimensions = dimensions
        self.device = device
        self.local_files_only = local_files_only
        self.query_instruction = query_instruction
        self.batch_size = batch_size
        self._model = None
        self._load_lock = threading.Lock()
        self._encode_lock = threading.Lock()

    def _ensure_model_loaded(self):
        if self._model is not None:
            return self._model

        with self._load_lock:
            if self._model is not None:
                return self._model

            os.environ.setdefault("USE_TF", "0")
            os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
            import torch
            from sentence_transformers import SentenceTransformer

            target_device = self.device or ("cuda" if torch.cuda.is_available() else "cpu")
            if target_device.startswith("cuda"):
                dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            else:
                dtype = torch.float32
            model_kwargs = {
                "dtype": dtype,
                "attn_implementation": "sdpa",
            }

            try:
                model = SentenceTransformer(
                    self.model_name,
                    device=target_device,
                    model_kwargs=model_kwargs,
                    trust_remote_code=True,
                    local_files_only=True,
                )
            except OSError:
                if self.local_files_only:
                    raise
                logger.info(
                    "Model %s not fully cached locally; downloading from Hugging Face Hub.",
                    self.model_name,
                )
                model = SentenceTransformer(
                    self.model_name,
                    device=target_device,
                    model_kwargs=model_kwargs,
                    trust_remote_code=True,
                    local_files_only=False,
                )

            self._model = model
            return self._model

    def _encode_raw_chunks(
        self, model, texts: list[str], *, prompt: str | None = None
    ) -> list[list[float]]:
        import torch

        kwargs: dict[str, object] = {
            "batch_size": self.batch_size,
            "normalize_embeddings": True,
            "show_progress_bar": False,
        }
        if prompt:
            kwargs["prompt"] = prompt

        try:
            vectors = model.encode(texts, **kwargs)
        except RuntimeError as exc:
            if "out of memory" not in str(exc).lower() or not torch.cuda.is_available():
                raise
            logger.warning("CUDA OOM during UltraBERT encoding; retrying with batch_size=1.")
            torch.cuda.empty_cache()
            kwargs["batch_size"] = 1
            vectors = model.encode(texts, **kwargs)

        return [[float(x) for x in vec] for vec in vectors]

    def _encode_sync(self, texts: Sequence[str], *, prompt: str | None = None) -> list[list[float]]:
        import numpy as np

        if not texts:
            return []
        model = self._ensure_model_loaded()

        # Split ultra-long resumes into overlapping windows, then L2-normalize averaged vectors.
        doc_chunks: list[list[str]] = [_split_long_text(t) for t in texts]
        flat_chunks = [chunk for group in doc_chunks for chunk in group]

        with self._encode_lock:
            flat_vecs = self._encode_raw_chunks(model, flat_chunks, prompt=prompt)

        out: list[list[float]] = []
        cursor = 0
        for group in doc_chunks:
            k = len(group)
            vecs = np.asarray(flat_vecs[cursor : cursor + k], dtype=np.float32)
            cursor += k
            if k > 1:
                mean_vec = vecs.mean(axis=0)
                norm = float(np.linalg.norm(mean_vec))
                vec_arr = mean_vec / max(norm, 1e-9)
            else:
                vec_arr = vecs[0]
            if vec_arr.shape[0] != self.dimensions:
                raise ValueError(
                    f"Embedding dimension mismatch: expected {self.dimensions}, "
                    f"got {vec_arr.shape[0]}"
                )
            out.append([float(x) for x in vec_arr])
        return out

    async def embed_document(self, text: str) -> list[float]:
        results = await self.embed_documents([text])
        return results[0]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await asyncio.to_thread(self._encode_sync, texts, prompt=None)

    async def embed_query(self, text: str) -> list[float]:
        results = await asyncio.to_thread(
            self._encode_sync, [text], prompt=self.query_instruction
        )
        return results[0]


def _average_normalized_chunks(
    doc_chunks: list[list[str]],
    flat_vecs: list[list[float]],
    dimensions: int,
) -> list[list[float]]:
    out: list[list[float]] = []
    cursor = 0
    for group in doc_chunks:
        k = len(group)
        vecs = np.asarray(flat_vecs[cursor : cursor + k], dtype=np.float32)
        cursor += k
        if k > 1:
            mean_vec = vecs.mean(axis=0)
            norm = float(np.linalg.norm(mean_vec))
            vec_arr = mean_vec / max(norm, 1e-9)
        else:
            vec_arr = vecs[0]
        if vec_arr.shape[0] != dimensions:
            raise ValueError(
                f"Embedding dimension mismatch: expected {dimensions}, got {vec_arr.shape[0]}"
            )
        out.append([float(x) for x in vec_arr])
    return out


class NvidiaNimEmbedder:
    """Cloud asymmetric embedder via NVIDIA NIM (e.g. ``nvidia/nemotron-3.5-embed-1b``).

    Sends ``input_type='passage'`` for resumes/postings and ``input_type='query'`` for
    search queries, using Matryoshka ``dimensions`` (default 1024) for pgvector index compatibility.
    """

    def __init__(
        self,
        *,
        api_key: str,
        model_name: str = DEFAULT_NIM_EMBEDDING_MODEL,
        dimensions: int = NIM_EMBEDDING_DIMENSIONS,
        base_url: str = NIM_EMBEDDING_BASE_URL,
        timeout_seconds: float = 60.0,
        batch_size: int = 16,
        max_retries: int = 4,
    ) -> None:
        cleaned_key = api_key.strip()
        if not cleaned_key:
            raise ValueError(
                "NVIDIA_API_KEY is required when EMBEDDING_PROVIDER is set to 'nvidia'."
            )
        self._api_key = cleaned_key
        self.model_name = model_name
        self.dimensions = dimensions
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.batch_size = max(1, batch_size)
        self.max_retries = max(1, max_retries)
        self._client: httpx.AsyncClient | None = None
        self._client_loop: asyncio.AbstractEventLoop | None = None

    def _get_client(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        if (
            self._client is None
            or self._client.is_closed
            or self._client_loop is not loop
        ):
            self._client = httpx.AsyncClient(timeout=self.timeout_seconds)
            self._client_loop = loop
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            try:
                running_loop = asyncio.get_running_loop()
            except RuntimeError:
                running_loop = None
            if running_loop is self._client_loop:
                await self._client.aclose()
        self._client = None
        self._client_loop = None

    async def _post_batch(
        self,
        texts: list[str],
        *,
        input_type: str,
    ) -> list[list[float]]:
        client = self._get_client()
        endpoint = f"{self.base_url}/embeddings"
        payload: dict[str, Any] = {
            "model": self.model_name,
            "input": texts,
            "input_type": input_type,
            "encoding_format": "float",
            "truncate": "END",
            "dimensions": self.dimensions,
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        last_error: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                resp = await client.post(endpoint, headers=headers, json=payload)
            except httpx.TransportError as exc:
                last_error = exc
                if attempt + 1 < self.max_retries:
                    await asyncio.sleep(min(1.0 * (2**attempt), 8.0))
                    continue
                raise

            if resp.status_code == 200:
                items = resp.json().get("data") or []
                items.sort(key=lambda item: item["index"])
                return [[float(x) for x in item["embedding"]] for item in items]

            if resp.status_code in (429, 500, 502, 503, 504) and attempt + 1 < self.max_retries:
                retry_after = resp.headers.get("Retry-After")
                try:
                    delay = float(retry_after) if retry_after else min(1.0 * (2**attempt), 8.0)
                except ValueError:
                    delay = min(1.0 * (2**attempt), 8.0)
                await asyncio.sleep(max(0.1, delay))
                continue

            raise RuntimeError(
                f"NVIDIA NIM embeddings failed ({resp.status_code}): {resp.text[:300]}"
            )

        if last_error is not None:
            raise last_error
        raise RuntimeError("NVIDIA NIM embeddings exhausted retries.")

    async def _encode_async(self, texts: Sequence[str], *, input_type: str) -> list[list[float]]:
        if not texts:
            return []
        doc_chunks = [_split_long_text(t) for t in texts]
        flat_chunks = [chunk for group in doc_chunks for chunk in group]

        flat_vecs: list[list[float]] = []
        for idx in range(0, len(flat_chunks), self.batch_size):
            batch = flat_chunks[idx : idx + self.batch_size]
            flat_vecs.extend(await self._post_batch(batch, input_type=input_type))

        return _average_normalized_chunks(doc_chunks, flat_vecs, self.dimensions)

    async def embed_document(self, text: str) -> list[float]:
        return (await self.embed_documents([text]))[0]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await self._encode_async(texts, input_type="passage")

    async def embed_query(self, text: str) -> list[float]:
        return (await self._encode_async([text], input_type="query"))[0]


class MistralEmbedder:
    """Adapter around MistralClient.embed for optional API-based embedding fallback."""

    def __init__(self, mistral_client: MistralClient) -> None:
        self._client = mistral_client
        self.dimensions = MISTRAL_EMBEDDING_DIMENSIONS

    async def embed_document(self, text: str) -> list[float]:
        return await self._client.embed(text)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return list(await asyncio.gather(*(self._client.embed(t) for t in texts)))

    async def embed_query(self, text: str) -> list[float]:
        return await self._client.embed(text)


_ULTRABERT_CACHE: dict[tuple[str, int, str | None, bool, str], UltraBERTEmbedder] = {}
_NIM_CACHE: dict[tuple[str, str, int, str], NvidiaNimEmbedder] = {}
_CACHE_LOCK = threading.Lock()


async def close_cached_embedders() -> None:
    with _CACHE_LOCK:
        nim_instances = list(_NIM_CACHE.values())
    for instance in nim_instances:
        await instance.aclose()


def get_embedder(
    settings: Settings | None = None,
    *,
    mistral_client: MistralClient | None = None,
) -> EmbeddingProvider:
    cfg = settings or get_settings()
    provider = cfg.embedding_provider.lower().strip()
    if provider == "mistral":
        if mistral_client is None:
            raise ValueError(
                "mistral_client is required when EMBEDDING_PROVIDER is set to 'mistral'."
            )
        return MistralEmbedder(mistral_client)

    if provider == "ultrabert":
        model_name = cfg.embedding_model_name or ULTRABERT_EMBEDDING_MODEL
        cache_key = (
            model_name,
            cfg.embedding_dimensions,
            cfg.embedding_device,
            cfg.embedding_local_files_only,
            cfg.embedding_query_instruction,
        )
        with _CACHE_LOCK:
            embedder = _ULTRABERT_CACHE.get(cache_key)
            if embedder is None:
                embedder = UltraBERTEmbedder(
                    model_name=model_name,
                    dimensions=cfg.embedding_dimensions,
                    device=cfg.embedding_device,
                    local_files_only=cfg.embedding_local_files_only,
                    query_instruction=cfg.embedding_query_instruction,
                )
                _ULTRABERT_CACHE[cache_key] = embedder
            return embedder

    if provider in {"nvidia", "nim"}:
        nim_model = cfg.embedding_model_name or DEFAULT_NIM_EMBEDDING_MODEL
        nim_key = (
            nim_model,
            cfg.nvidia_base_url,
            cfg.embedding_dimensions,
            cfg.nvidia_api_key,
        )
        with _CACHE_LOCK:
            nim_embedder = _NIM_CACHE.get(nim_key)
            if nim_embedder is None:
                nim_embedder = NvidiaNimEmbedder(
                    api_key=cfg.nvidia_api_key,
                    model_name=nim_model,
                    dimensions=cfg.embedding_dimensions,
                    base_url=cfg.nvidia_base_url,
                    timeout_seconds=min(cfg.request_timeout_seconds, 60.0),
                )
                _NIM_CACHE[nim_key] = nim_embedder
            return nim_embedder

    raise ValueError(
        f"Unsupported EMBEDDING_PROVIDER: {cfg.embedding_provider!r}. "
        "Expected 'nvidia', 'ultrabert', or 'mistral'."
    )
