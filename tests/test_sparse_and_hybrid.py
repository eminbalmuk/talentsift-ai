import asyncio
from typing import Any

from talentsift_ai.db.repository import CandidateRepository
from talentsift_ai.pipeline.embeddings import UltraBERTEmbedder, get_embedder
from talentsift_ai.pipeline.search import HybridSearchService
from talentsift_ai.pipeline.sparse import (
    SparseScorer,
    fuse_dense_and_sparse,
    lexical_overlap_score,
    tokenize_sparse,
)
from talentsift_ai.settings import Settings


def test_tokenize_sparse_preserves_tech_tokens_and_filters_stopwords() -> None:
    tokens = tokenize_sparse(
        "Seeking a Senior C++ and C# / .NET Engineer with Node.js, CI/CD, and PostgreSQL."
    )
    assert "c++" in tokens
    assert "c#" in tokens
    assert ".net" in tokens
    assert "node.js" in tokens
    assert "ci/cd" in tokens
    assert "postgresql" in tokens
    assert "seeking" not in tokens
    assert "and" not in tokens


def test_sparse_scorer_and_fusion_boosts_exact_technical_match() -> None:
    query = "Backend engineer with FastAPI, PostgreSQL, Docker, and Kubernetes."
    candidates = [
        {
            "id": 1,
            "skills": ["Java", "Spring"],
            "university": "ITU",
            "raw_cv_text": "Enterprise Java developer building banking monoliths.",
            "vector_similarity": 0.65,
        },
        {
            "id": 2,
            "skills": ["FastAPI", "PostgreSQL", "Docker", "Kubernetes"],
            "university": "METU",
            "raw_cv_text": (
                "Built scalable backend APIs using FastAPI, PostgreSQL, Docker, and Kubernetes."
            ),
            "vector_similarity": 0.62,
        },
        {
            "id": 3,
            "skills": ["Pastry", "Baking"],
            "university": "Culinary Institute",
            "raw_cv_text": "Executive pastry chef managing hotel bakery operations.",
            "vector_similarity": 0.25,
        },
    ]

    fused = fuse_dense_and_sparse(
        candidates,
        query_text=query,
        dense_weight=0.60,
        sparse_weight=0.40,
        method="hybrid_blend",
    )

    assert fused[0]["id"] == 2
    assert fused[-1]["id"] == 3
    assert fused[0]["sparse_score"] > fused[1]["sparse_score"]
    assert 0.0 <= fused[-1]["similarity"] <= fused[0]["similarity"] <= 1.0


def test_fuse_dense_and_sparse_handles_single_and_empty_pools() -> None:
    assert fuse_dense_and_sparse([], query_text="python") == []

    single = [
        {
            "id": 10,
            "skills": ["Python", "SQL"],
            "raw_cv_text": "Python and SQL developer.",
            "vector_similarity": 0.72,
        }
    ]
    fused_single = fuse_dense_and_sparse(single, query_text="Python SQL engineer")
    assert len(fused_single) == 1
    assert fused_single[0]["similarity"] > 0.5


def test_lexical_overlap_score_bounds() -> None:
    cand = {
        "skills": ["Python", "FastAPI", "PostgreSQL"],
        "raw_cv_text": "Built distributed RAG APIs with FastAPI and PostgreSQL.",
    }
    high = lexical_overlap_score("Python FastAPI PostgreSQL RAG developer", cand)
    low = lexical_overlap_score("Executive pastry chef culinary menu planning", cand)
    assert 0.5 <= high <= 1.0
    assert low == 0.0


def test_repository_build_or_tsquery() -> None:
    tsq = CandidateRepository._build_or_tsquery(
        "Seeking a Python & FastAPI engineer! Experience with PostgreSQL."
    )
    assert " | " in tsq
    assert "python" in tsq
    assert "fastapi" in tsq
    assert "postgresql" in tsq


def test_hybrid_search_service_ranks_with_mock_embedder_and_repo() -> None:
    class StubEmbedder:
        dimensions = 768

        async def embed_document(self, text: str) -> list[float]:
            return [0.1] * 768

        async def embed_documents(self, texts: list[str]) -> list[list[float]]:
            return [[0.1] * 768 for _ in texts]

        async def embed_query(self, text: str) -> list[float]:
            assert "FastAPI" in text
            return [0.2] * 768

    class StubRepo:
        async def hybrid_search_candidates(self, **kwargs: Any) -> list[dict[str, Any]]:
            assert len(kwargs["query_embedding"]) == 768
            return [
                {
                    "id": 1,
                    "full_name": "Generic Candidate",
                    "experience_years": 3,
                    "gpa": 3.2,
                    "current_class": 5,
                    "skills": ["Excel"],
                    "raw_cv_text": "Operations analyst with Excel.",
                    "vector_similarity": 0.50,
                },
                {
                    "id": 2,
                    "full_name": "Strong Match",
                    "experience_years": 5,
                    "gpa": 3.7,
                    "current_class": 5,
                    "skills": ["Python", "FastAPI", "PostgreSQL"],
                    "raw_cv_text": "Senior backend engineer using Python, FastAPI, PostgreSQL.",
                    "vector_similarity": 0.78,
                },
            ]

    service = HybridSearchService(
        repository=StubRepo(),  # type: ignore[arg-type]
        embedder=StubEmbedder(),
        sparse_scorer=SparseScorer(),
    )
    ranked = asyncio.run(
        service.rank(
            organization_id=1,
            job_posting_id=1,
            job_description="Senior Python FastAPI PostgreSQL backend engineer",
            limit=10,
        )
    )
    assert len(ranked) == 2
    assert ranked[0]["id"] == 2
    assert ranked[0]["pre_llm_score"] > ranked[1]["pre_llm_score"]
    assert "bm25_score" in ranked[0]
    assert "tfidf_score" in ranked[0]


def test_get_embedder_returns_ultrabert_by_default() -> None:
    embedder = get_embedder(Settings())
    assert isinstance(embedder, UltraBERTEmbedder)
    assert embedder.model_name == "dmis-lab/UltraBERT-Embed-150M"
    assert embedder.dimensions == 768
