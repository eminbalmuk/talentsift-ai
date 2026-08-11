from pathlib import Path

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient


class HybridSearchService:
    def __init__(self, *, mistral_client: MistralClient, repository: CandidateRepository) -> None:
        self._mistral = mistral_client
        self._repository = repository

    async def rank(
        self,
        *,
        organization_id: int,
        job_description: str,
        min_gpa: float | None = None,
        class_year: int | None = None,
        min_experience_years: int | None = None,
        limit: int = 50,
    ) -> list[dict]:
        query_embedding = await self._mistral.embed(job_description)
        return await self._repository.search_candidates(
            organization_id=organization_id,
            query_embedding=query_embedding,
            min_gpa=min_gpa,
            class_year=class_year,
            min_experience_years=min_experience_years,
            limit=limit,
        )


def load_job_description(value: str) -> str:
    path = Path(value)
    if path.exists():
        return path.read_text(encoding="utf-8")
    return value
