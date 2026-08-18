from typing import NotRequired, TypedDict


class AgentAnalysisState(TypedDict):
    score: int
    arguments: str


class ArbitratorReportState(TypedDict):
    final_score: float
    rationale: str


class AgentState(TypedDict):
    cv_text: str
    user_job_description: str
    language: str
    optimist_analysis: NotRequired[AgentAnalysisState]
    pessimist_analysis: NotRequired[AgentAnalysisState]
    arbitrator_report: NotRequired[ArbitratorReportState]
    current_turn: int

