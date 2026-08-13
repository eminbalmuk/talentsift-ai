from pathlib import Path
from typing import Any

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.pipeline.reranker import PreLLMReranker


class HybridSearchService:
    def __init__(
        self,
        *,
        mistral_client: MistralClient,
        repository: CandidateRepository,
        reranker: PreLLMReranker | None = None,
    ) -> None:
        self._mistral = mistral_client
        self._repository = repository
        self._reranker = reranker or PreLLMReranker()

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
        # 1. Generate Query Vector Embedding using Mistral API
        query_embedding = await self._mistral.embed(job_description)

        # 2. Perform Supabase Hybrid Search (BM25 + pgvector) to fetch candidate pool
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

        # 3. Apply Pre-LLM Reranking (FlashRank Cross-Encoder + Competency Score)
        reranked = self._reranker.rerank(
            query=job_description,
            candidates=candidates,
            top_k=limit,
            relevance_weight=relevance_weight,
            competency_weight=competency_weight,
        )
        return reranked


def load_job_description(value: str) -> str:
    path = Path(value)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return value
