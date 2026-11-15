import asyncio
import logging
import os
import threading
from collections.abc import Sequence
from typing import Protocol

from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.models import (
    DEFAULT_EMBEDDING_MODEL,
    MISTRAL_EMBEDDING_DIMENSIONS,
    ULTRABERT_EMBEDDING_DIMENSIONS,
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
        model_name: str = DEFAULT_EMBEDDING_MODEL,
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
_CACHE_LOCK = threading.Lock()


def get_embedder(
    settings: Settings | None = None,
    *,
    mistral_client: MistralClient | None = None,
) -> EmbeddingProvider:
    cfg = settings or get_settings()
    if cfg.embedding_provider.lower() == "mistral":
        if mistral_client is None:
            raise ValueError(
                "mistral_client is required when EMBEDDING_PROVIDER is set to 'mistral'."
            )
        return MistralEmbedder(mistral_client)

    cache_key = (
        cfg.embedding_model_name,
        cfg.embedding_dimensions,
        cfg.embedding_device,
        cfg.embedding_local_files_only,
        cfg.embedding_query_instruction,
    )
    with _CACHE_LOCK:
        embedder = _ULTRABERT_CACHE.get(cache_key)
        if embedder is None:
            embedder = UltraBERTEmbedder(
                model_name=cfg.embedding_model_name,
                dimensions=cfg.embedding_dimensions,
                device=cfg.embedding_device,
                local_files_only=cfg.embedding_local_files_only,
                query_instruction=cfg.embedding_query_instruction,
            )
            _ULTRABERT_CACHE[cache_key] = embedder
        return embedder
