import asyncio
from dataclasses import dataclass
from pathlib import Path

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.pipeline.extraction import extract_cv_structure
from talentsift_ai.schemas import Candidate, CandidateCreate, CVStructure


@dataclass
class IngestionResult:
    raw_cv_text: str
    structured_data: CVStructure
    embedding: list[float]


class ResumeIngestionPipeline:
    def __init__(
        self,
        *,
        mistral_client: MistralClient,
        repository: CandidateRepository,
        organization_id: int | None = None,
        job_posting_id: int | None = None,
        max_concurrency: int = 8,
    ) -> None:
        self._mistral = mistral_client
        self._repository = repository
        self._organization_id = organization_id
        self._job_posting_id = job_posting_id
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def process_pdf(self, pdf_path: Path) -> IngestionResult:
        return await self.process_bytes(pdf_path.read_bytes())

    async def process_bytes(self, pdf_bytes: bytes) -> IngestionResult:
        async with self._semaphore:
            raw_text = await self._mistral.ocr_pdf_bytes(pdf_bytes)
            cv_structure = await extract_cv_structure(self._mistral, raw_text)
            embedding_text = self._embedding_text(raw_text, cv_structure.skills)
            embedding = await self._mistral.embed(embedding_text)
            return IngestionResult(
                raw_cv_text=raw_text,
                structured_data=cv_structure,
                embedding=embedding,
            )

    async def ingest_directory(self, resume_dir: Path) -> list[Candidate]:
        pdf_paths = sorted(resume_dir.glob("*.pdf"))
        tasks = [self.ingest_pdf(path) for path in pdf_paths]
        return await asyncio.gather(*tasks)

    async def ingest_pdf(self, pdf_path: Path) -> Candidate:
        return await self.ingest_bytes(pdf_path.read_bytes(), source_path=str(pdf_path))

    async def ingest_bytes(self, pdf_bytes: bytes, *, source_path: str | None = None) -> Candidate:
        if self._organization_id is None or self._job_posting_id is None:
            raise ValueError("organization_id & job_posting_id required for database ingestion.")

        processed = await self.process_bytes(pdf_bytes)
        candidate = CandidateCreate(
            **processed.structured_data.model_dump(),
            organization_id=self._organization_id,
            job_posting_id=self._job_posting_id,
            raw_cv_text=processed.raw_cv_text,
            cv_embedding=processed.embedding,
            source_path=source_path,
        )
        return await self._repository.insert_candidate(candidate)

    @staticmethod
    def _embedding_text(raw_text: str, skills: list[str]) -> str:
        skills_text = ", ".join(skills)
        return f"Skills: {skills_text}\n\nResume:\n{raw_text}"
