"""Shared model-provider protocol."""

from typing import Protocol

from trajectory.domain import DecisionRequest, Recommendation


class MentorProvider(Protocol):
    name: str

    async def generate(self, request: DecisionRequest) -> Recommendation:
        """Generate one structured recommendation."""
