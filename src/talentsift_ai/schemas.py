from pydantic import BaseModel, Field, confloat, conint


class CVStructure(BaseModel):
    full_name: str = Field(min_length=1, description="Candidate full name.")
    university: str | None = Field(
        default=None,
        description="Latest university attended or graduated.",
    )
    gpa: confloat(ge=0, le=4) | None = Field(
        default=None,
        description="Grade point average normalized to a 4.00 scale.",
    )
    current_class: conint(ge=1, le=5) = Field(
        default=5,
        description="Current class year from 1-4, or 5 for graduated/unspecified candidates.",
    )
    experience_years: conint(ge=0) = Field(
        default=0,
        description="Total years of software or relevant work experience.",
    )
    skills: list[str] = Field(default_factory=list, description="Prominent technical skills.")


class JobPostingCreate(BaseModel):
    organization_id: int
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    deadline_at: str | None = None


class JobPosting(JobPostingCreate):
    id: int
    is_active: bool = True


class CandidateCreate(CVStructure):
    organization_id: int
    job_posting_id: int
    raw_cv_text: str
    cv_embedding: list[float] | None = None
    source_path: str | None = None


class Candidate(CandidateCreate):
    id: int


class AgentAnalysis(BaseModel):
    score: conint(ge=0, le=100)
    arguments: str = Field(
        description=(
            "2-4 concise sentences of plain prose. No markdown formatting: no headers, "
            "no bullet/numbered lists, no bold/italics, no line breaks."
        ),
    )
    evidence_quotes: list[str] = Field(
        default_factory=list,
        description=(
            "1-3 short verbatim snippets copied from the resume text supporting your assessment."
        ),
    )


class ArbitratorReport(BaseModel):
    technical_fit: confloat(ge=0, le=100) = Field(
        default=50.0,
        description="Sub-score (0-100) for verified technical skills and stack match.",
    )
    experience_fit: confloat(ge=0, le=100) = Field(
        default=50.0,
        description="Sub-score (0-100) for relevant experience depth, seniority, and projects.",
    )
    education_fit: confloat(ge=0, le=100) = Field(
        default=50.0,
        description=(
            "Sub-score (0-100) for education, GPA, or role-appropriate academic background."
        ),
    )
    final_score: confloat(ge=0, le=100) = Field(
        description=(
            "A precise overall score (0-100) with one decimal place (e.g. 72.3, 84.7, 91.0) "
            "calibrated from technical_fit, experience_fit, education_fit, and verified risks. "
            "Do NOT round to multiples of 5 or 10."
        ),
    )
    rationale: str = Field(
        description=(
            "2-4 concise sentences of plain prose explaining the final score, grounded in facts. "
            "No markdown formatting: no headers, no bullet/numbered lists, no bold/italics."
        ),
    )
    evidence_quotes: list[str] = Field(
        default_factory=list,
        description="1-3 short verbatim phrases from the resume supporting the decision.",
    )


class DebateResult(BaseModel):
    organization_id: int
    candidate_id: int
    optimist_score: int
    optimist_arguments: str
    pessimist_score: int
    pessimist_arguments: str
    final_score: float
    arbitrator_rationale: str
    evidence_quotes: list[str] = Field(default_factory=list)
    grounding_score: float | None = None
    is_selected: bool = False
