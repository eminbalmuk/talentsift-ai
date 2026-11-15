import re
from typing import Any

from talentsift_ai.pipeline.sparse import tr_lower

# Seniority & Competency keywords for heuristic scoring
SENIORITY_KEYWORDS = {
    "lead", "senior", "principal", "architect", "manager", "head", "director",
    "led", "architected", "managed", "designed", "implemented", "scaled",
    "lider", "kıdemli", "yönetici", "mimar", "yönetti", "ölçekledi",
}

_SENIORITY_PATTERNS = [
    re.compile(rf"\b{re.escape(kw)}\b") for kw in sorted(SENIORITY_KEYWORDS)
]


def calculate_competency_breakdown(candidate: dict[str, Any]) -> dict[str, Any]:
    """Returns both total competency_score and its sub-component breakdown."""
    # 1. Experience Years (Up to 10+ years => 0.35 max weight)
    exp_years = candidate.get("experience_years", 0) or 0
    exp_score = min(float(exp_years) / 10.0, 1.0) * 0.35

    # 2. Education & GPA (Up to 4.0 => 0.25 max weight)
    gpa = candidate.get("gpa")
    if gpa is not None and gpa > 0:
        gpa_score = min(float(gpa) / 4.0, 1.0) * 0.25
    else:
        # Neutral baseline below average so omitting a low GPA does not beat honest reporting
        gpa_score = 0.10

    # 3. Class Year / Graduation Status (0.15 max weight)
    current_class = candidate.get("current_class", 5) or 5
    if current_class >= 5:  # Graduated
        class_score = 0.15
    elif current_class == 4:  # Senior
        class_score = 0.12
    elif current_class == 3:
        class_score = 0.08
    else:
        class_score = 0.05

    # 4. Skills & Seniority Keywords in CV Text (0.25 max weight)
    cv_text = tr_lower(candidate.get("raw_cv_text") or "")
    skills = candidate.get("skills") or []
    if isinstance(skills, list):
        cv_text += " " + " ".join(tr_lower(str(s)) for s in skills)

    matched_keywords = sum(1 for pat in _SENIORITY_PATTERNS if pat.search(cv_text))
    keyword_score = min(matched_keywords / 5.0, 1.0) * 0.25

    total = round(min(exp_score + gpa_score + class_score + keyword_score, 1.0), 4)
    return {
        "competency_score": total,
        "exp_score": round(exp_score, 4),
        "gpa_score": round(gpa_score, 4),
        "class_score": round(class_score, 4),
        "keyword_score": round(keyword_score, 4),
    }


def calculate_competency_score(candidate: dict[str, Any]) -> float:
    """Calculates a candidate's competency score in [0.0, 1.0]."""
    return float(calculate_competency_breakdown(candidate)["competency_score"])


class PreLLMReranker:
    """
    Pre-LLM reranking: combines the hybrid search relevance score (dense UltraBERT
    cosine similarity + sparse BM25/TF-IDF fusion) with a heuristic competency score,
    before the expensive LLM debate stage runs on only the resulting top candidates.
    """

    def rerank(
        self,
        *,
        candidates: list[dict[str, Any]],
        top_k: int = 1000,
        relevance_weight: float = 0.65,
        competency_weight: float = 0.35,
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []

        reranked_candidates = []
        for candidate in candidates:
            rel_score = float(candidate.get("similarity", 0.5))
            breakdown = calculate_competency_breakdown(candidate)
            comp_score = float(breakdown["competency_score"])
            combined_score = (relevance_weight * rel_score) + (competency_weight * comp_score)

            cand_copy = dict(candidate)
            cand_copy["relevance_score"] = round(rel_score, 4)
            cand_copy["competency_score"] = comp_score
            cand_copy["competency_breakdown"] = breakdown
            cand_copy["pre_llm_score"] = round(combined_score, 4)
            reranked_candidates.append(cand_copy)

        reranked_candidates.sort(key=lambda x: x["pre_llm_score"], reverse=True)
        return reranked_candidates[:top_k]
