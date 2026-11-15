import math
import re
from collections.abc import Sequence
from typing import Any

import numpy as np
from rank_bm25 import BM25Okapi
from sklearn.feature_extraction.text import TfidfVectorizer

# Common English + Turkish filler words and recruiting boilerplate that add noise to
# sparse lexical scoring when matching full job descriptions against resumes.
SPARSE_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
        "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
        "will", "with", "we", "you", "your", "our", "their", "this", "these", "those",
        "have", "had", "can", "may", "must", "should", "able", "looking", "seeking",
        "candidate", "role", "position", "responsibilities", "requirements", "preferred",
        "experience", "years", "skills", "team", "work", "working", "strong", "excellent",
        "company", "state", "city", "name", "summary", "highlights", "education",
        "ve", "veya", "ile", "bir", "bu", "da", "de", "icin", "için", "olan", "olarak",
        "gibi", "en", "cok", "çok", "daha", "her", "tum", "tüm", "ilgili", "aday",
        "pozisyon", "aranan", "nitelikler", "sorumluluklar", "deneyim", "yil", "yıl",
        "takim", "takım", "calisma", "çalışma", "ekip", "uzman", "tecrübe", "bilgisi",
    }
)

_SINGLE_CHAR_TECH = frozenset({"c", "r"})
_TOKEN_RE = re.compile(r"(?:\.[a-z0-9]+|[0-9a-zA-ZçğıöşüÇĞİÖŞÜ+#/.-]+)")

# Curated technical / domain vocabulary for explainable JD-vs-CV matched/missing chips.
_KNOWN_TECH_TERMS: tuple[str, ...] = (
    "python", "java", "javascript", "typescript", "c++", "c#", ".net", "golang", "go",
    "rust", "kotlin", "swift", "php", "ruby", "scala", "sql", "postgresql", "mysql",
    "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq", "fastapi", "django",
    "flask", "spring", "react", "next.js", "nextjs", "vue", "angular", "node.js",
    "nodejs", "tailwind", "graphql", "rest", "grpc", "docker", "kubernetes", "helm",
    "terraform", "ansible", "aws", "azure", "gcp", "linux", "ci/cd", "git", "github",
    "pytorch", "tensorflow", "scikit-learn", "huggingface", "transformers", "langchain",
    "langgraph", "rag", "llm", "nlp", "opencv", "pandas", "numpy", "spark", "airflow",
    "dbt", "snowflake", "power bi", "tableau", "excel", "sap", "autocad", "solidworks",
    "figma", "photoshop", "illustrator", "jira", "agile", "scrum", "selenium", "pytest",
    "playwright", "cybersecurity", "siem", "firewall", "cisco", "oauth", "jwt",
)


def tr_lower(text: str) -> str:
    """Turkish-safe case folding (avoids Python's İ -> i + combining dot quirk without mangling
    uppercase English 'I' in technical acronyms like FastAPI, AI, UI, CI/CD)."""
    return text.replace("İ", "i").replace("\u0307", "").lower()


def tokenize_sparse(text: str) -> list[str]:
    """Tokenizes resumes and job descriptions while preserving tech tokens like
    ``c++``, ``c#``, ``.net``, ``node.js``, ``ci/cd``, ``c``, and ``r``."""
    if not text:
        return []
    tokens: list[str] = []
    for raw in _TOKEN_RE.findall(tr_lower(text)):
        if raw.startswith(".") and len(raw) >= 3:
            cleaned = raw.rstrip("./-")
        else:
            cleaned = raw.strip("./-")
        if not cleaned or cleaned in SPARSE_STOPWORDS:
            continue
        if len(cleaned) >= 2 or cleaned in _SINGLE_CHAR_TECH:
            tokens.append(cleaned)
    return tokens


def build_candidate_sparse_text(candidate: dict[str, Any]) -> str:
    """Builds a field-weighted text representation for sparse lexical matching.

    Extracted technical skills are repeated so explicit skill tags receive stronger
    term-frequency weight than surrounding resume prose.
    """
    skills = candidate.get("skills") or []
    if isinstance(skills, (list, tuple)):
        skills_str = " ".join(str(s) for s in skills if s)
    else:
        skills_str = str(skills)
    university = str(candidate.get("university") or "")
    raw_cv = str(candidate.get("raw_cv_text") or "")
    parts = []
    if skills_str:
        parts.append(f"{skills_str} {skills_str} {skills_str}")
    if university:
        parts.append(university)
    if raw_cv:
        parts.append(raw_cv)
    return "\n".join(parts)


def extract_skill_matches(
    query_text: str, candidate: dict[str, Any], *, max_items: int = 12
) -> dict[str, list[str]]:
    """Extracts human-readable matched & missing technical terms between JD and CV."""
    if not query_text:
        return {"matched_skills": [], "missing_skills": []}

    jd_lower = tr_lower(query_text)
    jd_tokens = tokenize_sparse(query_text)
    jd_token_set = set(jd_tokens)

    cand_text = tr_lower(build_candidate_sparse_text(candidate))
    cand_token_set = set(tokenize_sparse(cand_text))

    # 1. Check recognizable tech multi-word/single terms mentioned in JD
    target_terms: list[str] = []
    seen_targets: set[str] = set()
    for term in _KNOWN_TECH_TERMS:
        if " " in term or "." in term or "/" in term or "+" in term or "#" in term:
            pattern = rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])"
            present = re.search(pattern, jd_lower) is not None
        else:
            present = term in jd_token_set
        if present and term not in seen_targets:
            seen_targets.add(term)
            target_terms.append(term)

    # 2. Fallback to distinctive non-stopword JD tokens if curated tech terms are sparse
    if len(target_terms) < 6:
        for tok in jd_tokens:
            if tok not in seen_targets and len(tok) >= 3:
                seen_targets.add(tok)
                target_terms.append(tok)
            if len(target_terms) >= max_items:
                break

    matched: list[str] = []
    missing: list[str] = []
    for term in target_terms[:max_items]:
        if " " in term or "." in term or "/" in term or "+" in term or "#" in term:
            in_cv = (
                re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", cand_text) is not None
            )
        else:
            in_cv = term in cand_token_set
        if in_cv:
            matched.append(term)
        else:
            missing.append(term)

    return {"matched_skills": matched, "missing_skills": missing}


def lexical_overlap_score(query_text: str, candidate: dict[str, Any]) -> float:
    """Single-candidate lexical/keyword coverage score in ``[0.0, 1.0]``.

    Used when scoring an individual candidate against a job posting without a full
    applicant pool (e.g. instant application scoring or ad-hoc debate).
    """
    q_tokens = tokenize_sparse(query_text)
    if not q_tokens:
        return 0.0
    doc_tokens = set(tokenize_sparse(build_candidate_sparse_text(candidate)))
    if not doc_tokens:
        return 0.0

    q_unique = set(q_tokens)
    overlap = len(q_unique & doc_tokens)
    if overlap == 0:
        return 0.0
    # Soft saturation: matching ~40%+ of unique non-stopword JD terms is a very strong match.
    coverage = overlap / len(q_unique)
    return round(min(1.0, math.sqrt(coverage)), 4)


class SparseScorer:
    """Dual-signal sparse scorer combining Okapi BM25 and sublinear 1-2 gram TF-IDF."""

    def __init__(self, *, k1: float = 1.5, b: float = 0.75, bm25_weight: float = 0.5) -> None:
        self.k1 = k1
        self.b = b
        self.bm25_weight = bm25_weight

    def score_candidates(
        self, query_text: str, candidates: Sequence[dict[str, Any]]
    ) -> list[dict[str, float]]:
        """Computes bm25_score, tfidf_score, and normalized sparse_score per candidate."""
        n = len(candidates)
        if n == 0:
            return []

        query_tokens = tokenize_sparse(query_text)
        if not query_tokens:
            return [{"bm25_score": 0.0, "tfidf_score": 0.0, "sparse_score": 0.0} for _ in range(n)]

        if n == 1:
            ov = lexical_overlap_score(query_text, candidates[0])
            return [{"bm25_score": ov, "tfidf_score": ov, "sparse_score": ov}]

        sparse_texts = [build_candidate_sparse_text(c) for c in candidates]
        tokenized_docs = [tokenize_sparse(t) for t in sparse_texts]

        # 1. Okapi BM25
        if any(tokenized_docs):
            bm25 = BM25Okapi(tokenized_docs, k1=self.k1, b=self.b)
            bm25_raw = np.asarray(bm25.get_scores(query_tokens), dtype=np.float64)
        else:
            bm25_raw = np.zeros(n, dtype=np.float64)

        # 2. Sublinear 1-2 gram TF-IDF
        try:
            vectorizer = TfidfVectorizer(
                tokenizer=tokenize_sparse,
                token_pattern=None,
                ngram_range=(1, 2),
                sublinear_tf=True,
                max_features=50_000,
            )
            doc_matrix = vectorizer.fit_transform(sparse_texts)
            query_vec = vectorizer.transform([query_text])
            tfidf_raw = np.asarray((query_vec @ doc_matrix.T).toarray()[0], dtype=np.float64)
        except ValueError:
            tfidf_raw = np.zeros(n, dtype=np.float64)

        bm25_norm = _minmax_or_zero(bm25_raw)
        tfidf_norm = _minmax_or_zero(tfidf_raw)
        w_bm25 = self.bm25_weight
        w_tfidf = 1.0 - w_bm25
        sparse_combined = w_bm25 * bm25_norm + w_tfidf * tfidf_norm

        return [
            {
                "bm25_score": round(float(bm25_raw[i]), 4),
                "tfidf_score": round(float(tfidf_raw[i]), 4),
                "sparse_score": round(float(sparse_combined[i]), 4),
            }
            for i in range(n)
        ]


def _minmax_or_zero(values: np.ndarray) -> np.ndarray:
    v_min = float(values.min())
    v_max = float(values.max())
    span = v_max - v_min
    if span <= 1e-9:
        return np.zeros_like(values, dtype=np.float64)
    return (values - v_min) / span


def fuse_dense_and_sparse(
    candidates: list[dict[str, Any]],
    *,
    query_text: str = "",
    dense_weight: float = 0.60,
    sparse_weight: float = 0.40,
    method: str = "hybrid_blend",
    rrf_k: int = 20,
    sparse_scorer: SparseScorer | None = None,
) -> list[dict[str, Any]]:
    """Enriches candidates with sparse scores, skill matches, and fused ``similarity`` in [0, 1]."""
    n = len(candidates)
    if n == 0:
        return []

    total_w = dense_weight + sparse_weight
    w_d = dense_weight / total_w if total_w > 0 else 0.6
    w_s = 1.0 - w_d

    scorer = sparse_scorer or SparseScorer()
    sparse_metrics = (
        scorer.score_candidates(query_text, candidates)
        if query_text
        else [
            {
                "bm25_score": float(c.get("bm25_rank", 0.0) or 0.0),
                "tfidf_score": 0.0,
                "sparse_score": float(c.get("bm25_rank", 0.0) or 0.0),
            }
            for c in candidates
        ]
    )

    dense_raw = np.array(
        [float(c.get("vector_similarity", c.get("similarity", 0.0)) or 0.0) for c in candidates],
        dtype=np.float64,
    )
    sparse_raw = np.array([m["sparse_score"] for m in sparse_metrics], dtype=np.float64)

    if n == 1:
        dense_clamped = float(np.clip(dense_raw[0], 0.0, 1.0))
        sp = float(np.clip(sparse_raw[0], 0.0, 1.0))
        fused_val = w_d * dense_clamped + w_s * sp if sp > 0 else dense_clamped
        row = dict(candidates[0])
        row.update(sparse_metrics[0])
        row.update(extract_skill_matches(query_text, row))
        row["vector_similarity"] = round(dense_clamped, 4)
        row["dense_score"] = round(dense_clamped, 4)
        row["similarity"] = round(float(np.clip(fused_val, 0.0, 1.0)), 4)
        return [row]

    dense_norm = _minmax_or_zero(dense_raw)
    sparse_norm = _minmax_or_zero(sparse_raw)
    has_sparse = bool(sparse_raw.max() > 1e-9)

    if not has_sparse:
        convex = dense_norm
    else:
        convex = w_d * dense_norm + w_s * sparse_norm

    # Weighted RRF normalized by the theoretical best rank (rank 1 on both signals)
    rank_dense = np.empty(n, dtype=np.float64)
    rank_dense[np.argsort(-dense_raw, kind="mergesort")] = np.arange(1, n + 1)
    if has_sparse:
        rank_sparse = np.empty(n, dtype=np.float64)
        rank_sparse[np.argsort(-sparse_raw, kind="mergesort")] = np.arange(1, n + 1)
        rrf_raw = w_d / (rrf_k + rank_dense) + w_s / (rrf_k + rank_sparse)
        rrf_max = (w_d + w_s) / (rrf_k + 1.0)
    else:
        rrf_raw = 1.0 / (rrf_k + rank_dense)
        rrf_max = 1.0 / (rrf_k + 1.0)
    rrf_ratio = rrf_raw / rrf_max

    method_norm = method.lower()
    if method_norm == "convex":
        fused = convex
    elif method_norm == "rrf":
        fused = rrf_ratio
    else:
        fused = 0.70 * convex + 0.30 * rrf_ratio

    enriched: list[dict[str, Any]] = []
    for i, cand in enumerate(candidates):
        row = dict(cand)
        row.update(sparse_metrics[i])
        row.update(extract_skill_matches(query_text, row))
        row["vector_similarity"] = round(float(dense_raw[i]), 4)
        # Preserve calibrated cosine similarity in dense_score when vectors vary mildly,
        # while normalized signals drive pool ranking fusion cleanly.
        row["dense_score"] = round(float(np.clip(dense_raw[i], 0.0, 1.0)), 4)
        row["similarity"] = round(float(np.clip(fused[i], 0.0, 1.0)), 4)
        enriched.append(row)

    enriched.sort(key=lambda item: item["similarity"], reverse=True)
    return enriched
