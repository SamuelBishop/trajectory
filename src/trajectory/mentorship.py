"""End-to-end decision-review orchestration."""

from __future__ import annotations

from pathlib import Path

from trajectory.config import load_mentor_resources, load_user_config
from trajectory.domain import (
    ChatMessage,
    ChatRequest,
    ChatResult,
    DecisionRequest,
    DecisionResult,
)
from trajectory.errors import InsufficientContextError
from trajectory.prompting import CHAT_PROMPT_VERSION, PROMPT_VERSION
from trajectory.providers.base import MentorProvider
from trajectory.selection import select_goals, select_principles, select_sources
from trajectory.validation import (
    validate_chat_response,
    validate_demo_grounding,
    validate_recommendation,
)


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


async def chat_with_mentor(
    message: str,
    history: list[ChatMessage],
    provider: MentorProvider,
    user_directory: Path,
    mentor_directory: Path,
) -> ChatResult:
    user = load_user_config(user_directory)
    resources = load_mentor_resources(mentor_directory)
    try:
        goals = select_goals(message, user)
    except InsufficientContextError:
        goals = sorted(
            (goal for goal in user.goals if goal.status == "active"),
            key=lambda goal: (goal.priority, goal.id),
        )[:3]
    if not goals:
        raise InsufficientContextError("Chat requires at least one active goal.")

    try:
        principles = select_principles(message, goals, resources)
    except InsufficientContextError:
        principles = sorted(resources.principles, key=lambda principle: principle.id)[:3]
    sources = select_sources(principles, resources)

    request = ChatRequest(
        message=message,
        history=history[-20:],
        values=user.values,
        current_state=user.current_state,
        constraints=user.constraints,
        communication=user.communication,
        goals=goals,
        mentor_profile=resources.profile,
        principles=principles,
        sources=sources,
        provider=provider.name,
        prompt_version=CHAT_PROMPT_VERSION,
    )
    validate_demo_grounding(request)
    response = await provider.chat(request)
    validate_chat_response(response, request)
    return ChatResult(response=response, request=request)
