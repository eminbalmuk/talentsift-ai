from dataclasses import dataclass


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

