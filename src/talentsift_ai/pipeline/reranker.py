import logging
from typing import Any

logger = logging.getLogger(__name__)

# Seniority & Competency keywords for heuristic scoring
SENIORITY_KEYWORDS = {
    "lead", "senior", "principal", "architect", "manager", "head", "director",
    "led", "architected", "managed", "designed", "implemented", "scaled",
    "lider", "kıdemli", "yönetici", "mimar", "yöneltti", "ölçekledi"
}


def calculate_competency_score(candidate: dict[str, Any]) -> float:
    """
    Calculates a candidate's competency / donanım score (0.0 to 1.0)
    based on experience years, GPA, current class, skills count, and seniority keywords.
    """
    score = 0.0

    # 1. Experience Years (Up to 10+ years => 0.35 max weight)
    exp_years = candidate.get("experience_years", 0) or 0
    exp_score = min(exp_years / 10.0, 1.0) * 0.35
    score += exp_score

    # 2. Education & GPA (Up to 4.0 => 0.25 max weight)
    gpa = candidate.get("gpa")
    if gpa is not None and gpa > 0:
        gpa_score = min(float(gpa) / 4.0, 1.0) * 0.25
        score += gpa_score
    else:
        # Neutral fallback if GPA is not specified
        score += 0.15

    # 3. Class Year / Graduation Status (0.15 max weight)
    current_class = candidate.get("current_class", 5) or 5
    if current_class >= 5:  # Graduated
        score += 0.15
    elif current_class == 4:  # Senior
        score += 0.12
    elif current_class == 3:
        score += 0.08
    else:
        score += 0.05

    # 4. Skills & Seniority Keywords in CV Text (0.25 max weight)
    cv_text = (candidate.get("raw_cv_text") or "").lower()
    skills = candidate.get("skills") or []
    if isinstance(skills, list):
        cv_text += " " + " ".join(str(s).lower() for s in skills)

    matched_keywords = sum(1 for kw in SENIORITY_KEYWORDS if kw in cv_text)
    keyword_score = min(matched_keywords / 5.0, 1.0) * 0.25
    score += keyword_score

    return round(min(score, 1.0), 4)


class PreLLMReranker:
    """
    Pre-LLM Reranking Service using FlashRank Cross-Encoder + Competency Scoring.
    Selects the Top N candidates before passing to expensive LLM agents.
    """

    def __init__(self, model_name: str = "ms-marco-MiniLM-L-6-v2") -> None:
        self.model_name = model_name
        self._ranker = None
        self._init_ranker()

    def _init_ranker(self) -> None:
        try:
            from flashrank import Ranker
            self._ranker = Ranker(model_name=self.model_name)
            logger.info("FlashRank initialized with model %s", self.model_name)
        except Exception as e:
            logger.warning("FlashRank not initialized (%s). Using fallback scoring.", e)
            self._ranker = None

    def rerank(
        self,
        *,
        query: str,
        candidates: list[dict[str, Any]],
        top_k: int = 1000,
        relevance_weight: float = 0.65,
        competency_weight: float = 0.35,
    ) -> list[dict[str, Any]]:
        """
        Reranks a list of candidate dictionaries by combining Cross-Encoder relevance score
        and candidate competency score.
        """
        if not candidates:
            return []

        # Step 1: Calculate Relevance Scores
        relevance_scores: dict[Any, float] = {}
        if self._ranker:
            try:
                from flashrank import RerankRequest
                passages = []
                for c in candidates:
                    name = c.get("full_name", "")
                    skills_str = ", ".join(c.get("skills", []))
                    raw_text = (c.get("raw_cv_text") or "")[:1000]
                    text = f"{name} | Skills: {skills_str} | {raw_text}"
                    passages.append({"id": c.get("id"), "text": text})

                req = RerankRequest(query=query, passages=passages)
                results = self._ranker.rerank(req)
                for res in results:
                    relevance_scores[res["id"]] = float(res.get("score", 0.0))
            except Exception as e:
                logger.error("FlashRank execution error: %s. Using fallback score.", e)
                for c in candidates:
                    relevance_scores[c.get("id")] = float(c.get("similarity", 0.5))
        else:
            for c in candidates:
                relevance_scores[c.get("id")] = float(c.get("similarity", 0.5))

        # Step 2: Calculate Combined Scores (Relevance + Competency)
        reranked_candidates = []
        for candidate in candidates:
            cand_id = candidate.get("id")
            rel_score = relevance_scores.get(cand_id, 0.5)
            comp_score = calculate_competency_score(candidate)

            combined_score = (relevance_weight * rel_score) + (competency_weight * comp_score)

            cand_copy = dict(candidate)
            cand_copy["relevance_score"] = round(rel_score, 4)
            cand_copy["competency_score"] = comp_score
            cand_copy["pre_llm_score"] = round(combined_score, 4)
            reranked_candidates.append(cand_copy)

        # Step 3: Sort by pre_llm_score descending and return Top K
        reranked_candidates.sort(key=lambda x: x["pre_llm_score"], reverse=True)
        return reranked_candidates[:top_k]
