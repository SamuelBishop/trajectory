"""Shared model-provider protocol."""

from typing import Protocol

from trajectory.domain import ChatRequest, ChatResponse, DecisionRequest, Recommendation


class MentorProvider(Protocol):
    name: str

    async def generate(self, request: DecisionRequest) -> Recommendation:
        """Generate one structured recommendation."""

    async def chat(self, request: ChatRequest) -> ChatResponse:
        """Generate one grounded chat response."""
