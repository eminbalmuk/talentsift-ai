from pathlib import Path
from typing import Any

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.pipeline.embeddings import EmbeddingProvider, get_embedder
from talentsift_ai.pipeline.reranker import PreLLMReranker
from talentsift_ai.pipeline.sparse import SparseScorer, fuse_dense_and_sparse
from talentsift_ai.settings import get_settings


class HybridSearchService:
    def __init__(
        self,
        *,
        repository: CandidateRepository,
        mistral_client: MistralClient | None = None,
        embedder: EmbeddingProvider | None = None,
        reranker: PreLLMReranker | None = None,
        sparse_scorer: SparseScorer | None = None,
        dense_weight: float | None = None,
        sparse_weight: float | None = None,
        fusion_method: str | None = None,
    ) -> None:
        settings = get_settings()
        self._mistral = mistral_client
        self._repository = repository
        self._embedder = embedder or get_embedder(settings, mistral_client=mistral_client)
        self._reranker = reranker or PreLLMReranker()
        self._sparse_scorer = sparse_scorer or SparseScorer()
        self._dense_weight = (
            settings.hybrid_dense_weight if dense_weight is None else dense_weight
        )
        self._sparse_weight = (
            settings.hybrid_sparse_weight if sparse_weight is None else sparse_weight
        )
        self._fusion_method = fusion_method or settings.hybrid_fusion_method

    async def rank(
        self,
        *,
        organization_id: int,
        job_posting_id: int,
        job_description: str,
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 1000,
        candidate_pool_limit: int = 2000,
        relevance_weight: float = 0.65,
        competency_weight: float = 0.35,
    ) -> list[dict[str, Any]]:
        # 1. Generate asymmetric query embedding using the configured provider
        query_embedding = await self._embedder.embed_query(job_description)

        # 2. Fetch filtered candidate pool + pgvector cosine similarities from Postgres
        candidates = await self._repository.hybrid_search_candidates(
            organization_id=organization_id,
            job_posting_id=job_posting_id,
            query_text=job_description,
            query_embedding=query_embedding,
            min_gpa=min_gpa,
            class_year=class_year,
            min_experience_years=min_experience_years,
            limit=candidate_pool_limit,
        )

        # 3. Compute Sparse (Okapi BM25 + 1-2gram TF-IDF) & fuse with Dense vector similarity
        fused = fuse_dense_and_sparse(
            candidates,
            query_text=job_description,
            dense_weight=self._dense_weight,
            sparse_weight=self._sparse_weight,
            method=self._fusion_method,
            sparse_scorer=self._sparse_scorer,
        )

        # 4. Apply Pre-LLM Reranking (hybrid relevance score + heuristic competency score)
        return self._reranker.rerank(
            candidates=fused,
            top_k=limit,
            relevance_weight=relevance_weight,
            competency_weight=competency_weight,
        )


def load_job_description(value: str) -> str:
    path = Path(value)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return value
