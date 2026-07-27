from pathlib import Path

import pytest

from trajectory.domain import ChatMessage
from trajectory.errors import ProviderError
from trajectory.mentorship import chat_with_mentor
from trajectory.providers.deterministic import DeterministicProvider

QUESTION = "Should I spend another two hours polishing this low-risk pull request?"


@pytest.mark.asyncio
async def test_chat_includes_bounded_history(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    history = [ChatMessage(role="user", content=f"Earlier message {index}") for index in range(20)]

    result = await chat_with_mentor(
        message=QUESTION,
        history=history,
        provider=DeterministicProvider(),
        user_directory=user_directory,
        mentor_directory=mentor_directory,
    )

    assert result.request.history == history
    assert result.response.goal_ids == ["career_001"]


@pytest.mark.asyncio
async def test_chat_falls_back_to_priority_context_for_general_questions(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    with pytest.raises(ProviderError, match="supports only the committed"):
        await chat_with_mentor(
            message="What should I focus on this week?",
            history=[],
            provider=DeterministicProvider(),
            user_directory=user_directory,
            mentor_directory=mentor_directory,
        )
