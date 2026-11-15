import re
from dataclasses import dataclass

from talentsift_ai.pipeline.sparse import tr_lower

_DEMOGRAPHIC_LINE_RE = re.compile(
    r"^\s*(?:birth\s*date|date\s*of\s*birth|dob|doğum\s*tarihi|gender|cinsiyet|"
    r"marital\s*status|medeni\s*(?:hal|durum)|military\s*(?:service|status)|askerlik|"
    r"nationality|uyruk|tc\s*kimlik|t\.c\.\s*kimlik|religion|din)\s*[:\-].*$",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class DebateEvaluationSample:
    question: str
    answer: str
    contexts: list[str]


def build_faithfulness_sample(
    *,
    job_description: str,
    cv_text: str,
    arbitrator_rationale: str,
) -> DebateEvaluationSample:
    return DebateEvaluationSample(
        question=f"Is this candidate a fit for the role?\n\n{job_description}",
        answer=arbitrator_rationale,
        contexts=[cv_text],
    )


def protected_attribute_policy() -> str:
    return (
        "The evaluation must be based only on technical skills, projects, experience, GPA, "
        "class year, and evidence in the resume. It must not rely on gender, ethnicity, age, "
        "religion, disability, nationality, or other protected attributes."
    )


def redact_demographic_markers(cv_text: str) -> str:
    """Removes explicit demographic header metadata lines before sending resume text to LLMs."""
    cleaned = _DEMOGRAPHIC_LINE_RE.sub("[REDACTED_DEMOGRAPHIC]", cv_text)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", tr_lower(text)).strip()


def compute_evidence_grounding(evidence_quotes: list[str], cv_text: str) -> float:
    """Measures fraction of cited evidence quotes actually grounded in the source resume."""
    quotes = [q.strip() for q in evidence_quotes if isinstance(q, str) and len(q.strip()) >= 4]
    if not quotes:
        return 0.0
    norm_cv = _normalize_ws(cv_text)
    if not norm_cv:
        return 0.0
    cv_tokens = set(re.findall(r"[0-9a-zA-Zçğıöşü+#]+", norm_cv))

    matched = 0.0
    for quote in quotes:
        norm_q = _normalize_ws(quote)
        if norm_q in norm_cv:
            matched += 1.0
            continue
        q_tokens = set(re.findall(r"[0-9a-zA-Zçğıöşü+#]+", norm_q))
        if q_tokens:
            overlap = len(q_tokens & cv_tokens) / len(q_tokens)
            if overlap >= 0.75:
                matched += overlap
    return round(matched / len(quotes), 4)


def evaluate_debate_faithfulness(
    *,
    job_description: str,
    cv_text: str,
    arbitrator_rationale: str,
    evidence_quotes: list[str] | None = None,
) -> dict[str, float]:
    """Computes deterministic faithfulness & lexical support metrics for a debate output."""
    sample = build_faithfulness_sample(
        job_description=job_description,
        cv_text=cv_text,
        arbitrator_rationale=arbitrator_rationale,
    )
    quotes_score = compute_evidence_grounding(evidence_quotes or [], sample.contexts[0])

    context_tokens = set(re.findall(r"[0-9a-zA-Zçğıöşü+#]{3,}", _normalize_ws(sample.contexts[0])))
    jd_tokens = set(re.findall(r"[0-9a-zA-Zçğıöşü+#]{3,}", _normalize_ws(job_description)))
    allowed_vocab = context_tokens | jd_tokens

    rationale_tokens = re.findall(r"[0-9a-zA-Zçğıöşü+#]{3,}", _normalize_ws(sample.answer))
    vocab_support = (
        sum(1 for t in rationale_tokens if t in allowed_vocab) / len(rationale_tokens)
        if rationale_tokens
        else 0.0
    )
    return {
        "evidence_grounding": quotes_score,
        "vocab_support": round(vocab_support, 4),
    }
