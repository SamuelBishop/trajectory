from pathlib import Path

from trajectory.domain import DecisionRequest
from trajectory.mentorship import review_decision
from trajectory.providers.deterministic import DeterministicProvider


async def demo_request(user_directory: Path, mentor_directory: Path) -> DecisionRequest:
    result = await review_decision(
        question="Should I spend another two hours polishing this low-risk pull request?",
        provider=DeterministicProvider(),
        user_directory=user_directory,
        mentor_directory=mentor_directory,
    )
    return result.request
