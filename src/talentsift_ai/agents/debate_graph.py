from langgraph.graph import END, START, StateGraph

from talentsift_ai.agents.prompts import (
    ARBITRATOR_SYSTEM_PROMPT,
    DEFAULT_LANGUAGE,
    OPTIMIST_SYSTEM_PROMPT,
    PESSIMIST_SYSTEM_PROMPT,
    language_instruction,
)
from talentsift_ai.agents.state import AgentState
from talentsift_ai.mistral_client import MistralClient
from talentsift_ai.models import MistralModel
from talentsift_ai.schemas import AgentAnalysis, ArbitratorReport, DebateResult

# Responses are instructed to stay to 2-4 plain-text sentences; this cap is a generous
# backstop (not a tight limit) so a verbose response gets cut cleanly rather than the
# strict JSON payload being truncated mid-field, which would break parsing entirely.
AGENT_MAX_TOKENS = 400


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
        state: AgentState = {
            "cv_text": cv_text,
            "user_job_description": job_description,
            "language": language,
            "current_turn": 0,
        }
        final_state = await self._graph.ainvoke(state)
        optimist = final_state["optimist_analysis"]
        pessimist = final_state["pessimist_analysis"]
        arbitrator = final_state["arbitrator_report"]
        return DebateResult(
            organization_id=organization_id,
            candidate_id=candidate_id,
            optimist_score=optimist["score"],
            optimist_arguments=optimist["arguments"],
            pessimist_score=pessimist["score"],
            pessimist_arguments=pessimist["arguments"],
            final_score=arbitrator["final_score"],
            arbitrator_rationale=arbitrator["rationale"],
        )

    def _build_graph(self):
        builder = StateGraph(AgentState)
        builder.add_node("optimist", self._optimist_node)
        builder.add_node("pessimist", self._pessimist_node)
        builder.add_node("arbitrator", self._arbitrator_node)
        builder.add_edge(START, "optimist")
        builder.add_edge("optimist", "pessimist")
        builder.add_edge("pessimist", "arbitrator")
        builder.add_edge("arbitrator", END)
        return builder.compile()

    async def _optimist_node(self, state: AgentState) -> dict:
        analysis = await self._mistral.chat_json(
            model=MistralModel.DEBATE,
            system_prompt=f"{OPTIMIST_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}",
            user_prompt=self._base_prompt(state),
            response_model=AgentAnalysis,
            temperature=0.3,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {
            "optimist_analysis": analysis.model_dump(),
            "current_turn": state["current_turn"] + 1,
        }

    async def _pessimist_node(self, state: AgentState) -> dict:
        analysis = await self._mistral.chat_json(
            model=MistralModel.DEBATE,
            system_prompt=f"{PESSIMIST_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}",
            user_prompt=(
                f"{self._base_prompt(state)}\n\n"
                f"Optimist analysis to challenge:\n{state['optimist_analysis']}"
            ),
            response_model=AgentAnalysis,
            temperature=0.2,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {
            "pessimist_analysis": analysis.model_dump(),
            "current_turn": state["current_turn"] + 1,
        }

    async def _arbitrator_node(self, state: AgentState) -> dict:
        report = await self._mistral.chat_json(
            model=MistralModel.ARBITRATION,
            system_prompt=f"{ARBITRATOR_SYSTEM_PROMPT.strip()}\n{language_instruction(state['language'])}",
            user_prompt=(
                f"{self._base_prompt(state)}\n\n"
                f"Optimist analysis:\n{state['optimist_analysis']}\n\n"
                f"Pessimist analysis:\n{state['pessimist_analysis']}"
            ),
            response_model=ArbitratorReport,
            temperature=0.1,
            max_tokens=AGENT_MAX_TOKENS,
        )
        return {
            "arbitrator_report": report.model_dump(),
            "current_turn": state["current_turn"] + 1,
        }

    @staticmethod
    def _base_prompt(state: AgentState) -> str:
        return (
            f"Job description:\n{state['user_job_description']}\n\n"
            f"Candidate resume:\n{state['cv_text']}"
        )
