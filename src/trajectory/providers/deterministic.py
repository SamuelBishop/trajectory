"""Credential-free deterministic provider for demos and tests."""

import re

from trajectory.domain import ChatRequest, ChatResponse, DecisionRequest, Recommendation
from trajectory.errors import ProviderError


class DeterministicProvider:
    name = "deterministic"

    async def generate(self, request: DecisionRequest) -> Recommendation:
        question = request.question.lower()
        is_demo_question = "polish" in question and (
            "pull request" in question or re.search(r"\bpr\b", question) is not None
        )
        is_demo_grounding = (
            request.goals[0].id == "career_001"
            and request.principles[0].id == "demo_opportunity_cost_001"
            and request.principles[0].source_ids[0] == "demo_source_001"
            and request.mentor_profile.id == "demo_mentor"
        )
        is_demo_context = (
            "A low-risk pull request that has already received substantial polish."
            in request.current_state.current_projects
            and "A design proposal postponed twice." in request.current_state.current_projects
            and "Whether to keep polishing the pull request tonight."
            in request.current_state.unresolved_decisions
        )
        if not is_demo_question or not is_demo_grounding or not is_demo_context:
            raise ProviderError(
                "The deterministic provider supports only the committed pull-request "
                "demo. Choose copilot or openai for other decisions."
            )

        goal = request.goals[0]
        principle = request.principles[0]
        source_id = principle.source_ids[0]
        goal_description = goal.description.rstrip(".")
        return Recommendation(
            assessment="stop_after_correctness_checks",
            response="Stop after resolving only correctness-relevant concerns.",
            why_now=(
                f"More polish appears lower value than progress on '{goal_description}' "
                "and the postponed design work in your current state."
            ),
            goal_ids=[goal.id],
            principle_ids=[principle.id],
            source_ids=[source_id],
            observations=[
                f'The user asked: "{request.question}"',
                "The current-state file says the pull request is functionally complete.",
            ],
            inferences=[
                "Further polishing may be perfectionism rather than material risk reduction."
            ],
            alternatives_considered=[
                "Continue polishing for two hours.",
                "Submit immediately without another check.",
                "Resolve only correctness-relevant concerns, then submit.",
            ],
            suggested_next_step=(
                "Write a short correctness checklist, address only material risks, submit "
                "the pull request, then outline the design proposal."
            ),
            confidence=0.72,
            uncertainties=["The system cannot inspect unreported production or security risk."],
        )

    async def chat(self, request: ChatRequest) -> ChatResponse:
        question = request.message.lower()
        if not (
            "polish" in question
            and ("pull request" in question or re.search(r"\bpr\b", question))
            and request.goals[0].id == "career_001"
            and request.principles[0].id == "demo_opportunity_cost_001"
        ):
            raise ProviderError(
                "The deterministic provider supports only the committed pull-request "
                "demo. Choose copilot or openai for other chat messages."
            )
        return ChatResponse(
            answer=(
                "I would stop after a short correctness check. The pull request is "
                "functionally complete, while the postponed design proposal more directly "
                "supports your architectural-ownership goal. Write a brief material-risk "
                "checklist, submit the pull request, and use the remaining time to outline "
                "the proposal."
            ),
            goal_ids=[request.goals[0].id],
            principle_ids=[request.principles[0].id],
            source_ids=[request.sources[0].id],
            observations=[
                "The current state describes the pull request as functionally complete.",
                "The design proposal has been postponed twice.",
            ],
            inferences=["Additional polish may have lower opportunity value than the design work."],
            confidence=0.72,
            uncertainties=["The system cannot inspect unreported production or security risk."],
        )
