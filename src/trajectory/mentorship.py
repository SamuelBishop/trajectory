"""End-to-end decision-review orchestration."""

from __future__ import annotations

from pathlib import Path

from trajectory.config import load_mentor_resources, load_user_config
from trajectory.domain import DecisionRequest, DecisionResult
from trajectory.prompting import PROMPT_VERSION
from trajectory.providers.base import MentorProvider
from trajectory.selection import select_goals, select_principles, select_sources
from trajectory.validation import validate_demo_grounding, validate_recommendation


async def review_decision(
    question: str,
    provider: MentorProvider,
    user_directory: Path,
    mentor_directory: Path,
) -> DecisionResult:
    user = load_user_config(user_directory)
    resources = load_mentor_resources(mentor_directory)
    goals = select_goals(question, user)
    principles = select_principles(question, goals, resources)
    sources = select_sources(principles, resources)

    request = DecisionRequest(
        question=question,
        values=user.values,
        current_state=user.current_state,
        constraints=user.constraints,
        communication=user.communication,
        goals=goals,
        mentor_profile=resources.profile,
        principles=principles,
        sources=sources,
        provider=provider.name,
        prompt_version=PROMPT_VERSION,
    )
    validate_demo_grounding(request)
    recommendation = await provider.generate(request)
    validate_recommendation(recommendation, request)
    return DecisionResult(recommendation=recommendation, request=request)
