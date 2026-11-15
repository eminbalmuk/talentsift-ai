from langgraph.graph import END, START, StateGraph

from talentsift_ai.agents.prompts import (
    ARBITRATOR_SYSTEM_PROMPT,
    DEFAULT_LANGUAGE,
    OPTIMIST_SYSTEM_PROMPT,
    PESSIMIST_SYSTEM_PROMPT,
    language_instruction,
)
from talentsift_ai.agents.state import AgentState
from talentsift_ai.evaluation import compute_evidence_grounding, redact_demographic_markers
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.models import MistralModel
from talentsift_ai.schemas import AgentAnalysis, ArbitratorReport, DebateResult

# Generous cap for Turkish plain-prose rationale + structured evidence_quotes JSON output.
AGENT_MAX_TOKENS = 1100
MAX_CV_CHARS_FOR_DEBATE = 18_000


class DebateGraph:
    def __init__(self, mistral_client: MistralClient) -> None:
        self._mistral = mistral_client
        self._graph = self._build_graph()

    async def evaluate(
        self,
        *,
        organization_id: int,
        candidate_id: int,
        cv_text: str,
        job_description: str,
        language: str = DEFAULT_LANGUAGE,
    ) -> DebateResult:
        redacted_cv = redact_demographic_markers(cv_text)[:MAX_CV_CHARS_FOR_DEBATE]
        state: AgentState = {
            "cv_text": redacted_cv,
            "user_job_description": job_description,
            "language": language,
        }
        final_state = await self._graph.ainvoke(state)
        optimist = final_state["optimist_analysis"]
        pessimist = final_state["pessimist_analysis"]
        arbitrator = final_state["arbitrator_report"]

        combined_quotes = list(
            dict.fromkeys(
                [
                    *(arbitrator.get("evidence_quotes") or []),
                    *(optimist.get("evidence_quotes") or []),
                    *(pessimist.get("evidence_quotes") or []),
                ]
            )
        )[:6]
        grounding_score = compute_evidence_grounding(combined_quotes, cv_text)

        return DebateResult(
            organization_id=organization_id,
            candidate_id=candidate_id,
            optimist_score=optimist["score"],
            optimist_arguments=optimist["arguments"],
            pessimist_score=pessimist["score"],
            pessimist_arguments=pessimist["arguments"],
            final_score=round(float(arbitrator["final_score"]), 1),
            arbitrator_rationale=arbitrator["rationale"],
            evidence_quotes=combined_quotes,
            grounding_score=grounding_score,
        )

    def _build_graph(self):
        builder = StateGraph(AgentState)
        builder.add_node("optimist", self._optimist_node)
        builder.add_node("pessimist", self._pessimist_node)
        builder.add_node("arbitrator", self._arbitrator_node)
        # Run Optimist and Pessimist blindly in parallel to prevent anchoring and cut latency.
        builder.add_edge(START, "optimist")
        builder.add_edge(START, "pessimist")
        builder.add_edge("optimist", "arbitrator")
        builder.add_edge("pessimist", "arbitrator")
        builder.add_edge("arbitrator", END)
        return builder.compile()

    async def _optimist_node(self, state: AgentState) -> dict:
        analysis = await self._mistral.chat_json(
            model=MistralModel.DEBATE,
            system_prompt=(
                f"{OPTIMIST_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}"
            ),
            user_prompt=self._base_prompt(state),
            response_model=AgentAnalysis,
            temperature=0.25,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {"optimist_analysis": analysis.model_dump()}

    async def _pessimist_node(self, state: AgentState) -> dict:
        analysis = await self._mistral.chat_json(
            model=MistralModel.DEBATE,
            system_prompt=(
                f"{PESSIMIST_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}"
            ),
            user_prompt=self._base_prompt(state),
            response_model=AgentAnalysis,
            temperature=0.2,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {"pessimist_analysis": analysis.model_dump()}

    async def _arbitrator_node(self, state: AgentState) -> dict:
        report = await self._mistral.chat_json(
            model=MistralModel.ARBITRATION,
            system_prompt=(
                f"{ARBITRATOR_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}"
            ),
            user_prompt=(
                f"{self._base_prompt(state)}\n\n"
                f"<optimist_analysis>\n{state['optimist_analysis']}\n</optimist_analysis>\n\n"
                f"<pessimist_analysis>\n{state['pessimist_analysis']}\n</pessimist_analysis>"
            ),
            response_model=ArbitratorReport,
            temperature=0.1,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {"arbitrator_report": report.model_dump()}

    @staticmethod
    def _base_prompt(state: AgentState) -> str:
        return (
            f"<job_description>\n{state['user_job_description']}\n</job_description>\n\n"
            f"<candidate_resume>\n{state['cv_text']}\n</candidate_resume>"
        )
