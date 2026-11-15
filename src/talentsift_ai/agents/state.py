from typing import NotRequired, TypedDict


class AgentAnalysisState(TypedDict):
    score: int
    arguments: str
    evidence_quotes: list[str]


class ArbitratorReportState(TypedDict):
    technical_fit: float
    experience_fit: float
    education_fit: float
    final_score: float
    rationale: str
    evidence_quotes: list[str]


class AgentState(TypedDict):
    cv_text: str
    user_job_description: str
    language: str
    optimist_analysis: NotRequired[AgentAnalysisState]
    pessimist_analysis: NotRequired[AgentAnalysisState]
    arbitrator_report: NotRequired[ArbitratorReportState]
