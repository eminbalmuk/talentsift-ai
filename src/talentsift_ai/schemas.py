from pydantic import BaseModel, Field, confloat, conint


class CVStructure(BaseModel):
    full_name: str = Field(description="Candidate full name.")
    university: str | None = Field(
        default=None,
        description="Latest university attended or graduated.",
    )
    gpa: confloat(ge=0, le=4) | None = Field(
        default=None,
        description="Grade point average normalized to a 4.00 scale.",
    )
    current_class: conint(ge=1, le=5) = Field(
        description="Current class year from 1-4, or 5 for graduated candidates.",
    )
    experience_years: conint(ge=0) = Field(
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


class ArbitratorReport(BaseModel):
    final_score: confloat(ge=0, le=100)
    rationale: str = Field(
        description=(
            "2-4 concise sentences of plain prose explaining the final score. No markdown "
            "formatting: no headers, no bullet/numbered lists, no bold/italics, no line breaks."
        ),
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
    is_selected: bool = False
