import asyncio
import io
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from pathlib import Path

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.mistral_client import MistralClient, resolve_document_mime_type
from talentsift_ai.pipeline.embeddings import EmbeddingProvider, get_embedder
from talentsift_ai.pipeline.extraction import extract_cv_structure
from talentsift_ai.schemas import Candidate, CandidateCreate, CVStructure

SUPPORTED_RESUME_EXTENSIONS = (".pdf", ".docx", ".txt", ".md")


def _extract_docx_text_locally(document_bytes: bytes) -> str:
    """Extracts plain text paragraphs from a .docx ZIP container without an OCR API round-trip."""
    try:
        with zipfile.ZipFile(io.BytesIO(document_bytes)) as zf:
            if "word/document.xml" not in zf.namelist():
                return ""
            xml_bytes = zf.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError, OSError):
        return ""

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return ""

    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for para in root.findall(".//w:p", ns):
        runs = [node.text for node in para.findall(".//w:t", ns) if node.text]
        if runs:
            paragraphs.append("".join(runs))
    return "\n".join(paragraphs).strip()


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
        embedder: EmbeddingProvider | None = None,
        organization_id: int | None = None,
        job_posting_id: int | None = None,
        max_concurrency: int = 8,
    ) -> None:
        self._mistral = mistral_client
        self._repository = repository
        self._embedder = embedder or get_embedder(mistral_client=mistral_client)
        self._organization_id = organization_id
        self._job_posting_id = job_posting_id
        self._semaphore = asyncio.Semaphore(max_concurrency)

    async def process_document(self, document_path: Path) -> IngestionResult:
        return await self.process_bytes(
            document_path.read_bytes(), filename=document_path.name
        )

    async def _extract_raw_text(self, document_bytes: bytes, *, filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        if suffix in {".txt", ".md"}:
            return document_bytes.decode("utf-8", errors="replace").strip()

        if suffix == ".docx":
            local_text = _extract_docx_text_locally(document_bytes)
            if len(local_text) >= 80:
                return local_text

        mime_type = resolve_document_mime_type(filename)
        return await self._mistral.ocr_document_bytes(document_bytes, mime_type=mime_type)

    async def process_bytes(self, document_bytes: bytes, *, filename: str) -> IngestionResult:
        async with self._semaphore:
            raw_text = await self._extract_raw_text(document_bytes, filename=filename)
            cv_structure = await extract_cv_structure(self._mistral, raw_text)
            embedding_text = self._embedding_text(raw_text, cv_structure.skills)
            embedding = await self._embedder.embed_document(embedding_text)
            return IngestionResult(
                raw_cv_text=raw_text,
                structured_data=cv_structure,
                embedding=embedding,
            )

    async def ingest_directory(self, resume_dir: Path) -> list[Candidate]:
        document_paths = sorted(
            path
            for extension in SUPPORTED_RESUME_EXTENSIONS
            for path in resume_dir.glob(f"*{extension}")
        )
        tasks = [self.ingest_document(path) for path in document_paths]
        return await asyncio.gather(*tasks)

    async def ingest_document(self, document_path: Path) -> Candidate:
        return await self.ingest_bytes(
            document_path.read_bytes(),
            filename=document_path.name,
            source_path=str(document_path),
        )

    async def ingest_bytes(
        self, document_bytes: bytes, *, filename: str, source_path: str | None = None
    ) -> Candidate:
        if self._organization_id is None or self._job_posting_id is None:
            raise ValueError("organization_id and job_posting_id are required to ingest into DB.")
        res = await self.process_bytes(document_bytes, filename=filename)
        candidate = CandidateCreate(
            organization_id=self._organization_id,
            job_posting_id=self._job_posting_id,
            raw_cv_text=res.raw_cv_text,
            cv_embedding=res.embedding,
            source_path=source_path or filename,
            **res.structured_data.model_dump(),
        )
        return await self._repository.upsert_candidate(candidate)

    @staticmethod
    def _embedding_text(raw_cv_text: str, skills: list[str]) -> str:
        if not skills:
            return raw_cv_text
        return f"Key technical skills: {', '.join(skills)}\n\n{raw_cv_text}"
