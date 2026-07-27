from pathlib import Path

from trajectory.domain import ChatRequest, DecisionRequest
from trajectory.mentorship import chat_with_mentor, review_decision
from trajectory.providers.deterministic import DeterministicProvider


async def demo_request(user_directory: Path, mentor_directory: Path) -> DecisionRequest:
    result = await review_decision(
        question="Should I spend another two hours polishing this low-risk pull request?",
        provider=DeterministicProvider(),
        user_directory=user_directory,
        mentor_directory=mentor_directory,
    )
    return result.request


async def demo_chat_request(user_directory: Path, mentor_directory: Path) -> ChatRequest:
    result = await chat_with_mentor(
        message="Should I spend another two hours polishing this low-risk pull request?",
        history=[],
        provider=DeterministicProvider(),
        user_directory=user_directory,
        mentor_directory=mentor_directory,
    )
    return result.request
