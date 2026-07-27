from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from openai import OpenAIError

from tests.helpers import demo_chat_request, demo_request
from trajectory.errors import ProviderError, ProviderResponseError
from trajectory.providers.copilot import CopilotProvider
from trajectory.providers.deterministic import DeterministicProvider
from trajectory.providers.openai_compatible import OpenAICompatibleProvider


def _provider_json(request: Any) -> str:
    return json.dumps(
        {
            "assessment": "redirect",
            "response": "Stop after the correctness check.",
            "why_now": "The selected career goal has higher opportunity value.",
            "goal_ids": [request.goals[0].id],
            "principle_ids": [request.principles[0].id],
            "source_ids": [request.sources[0].id],
            "observations": ["The pull request is described as low risk."],
            "inferences": ["More polish may be perfectionism."],
            "alternatives_considered": ["Keep polishing.", "Submit after checking."],
            "suggested_next_step": "Run a short correctness checklist and submit.",
            "confidence": 0.7,
            "uncertainties": ["Unreported production risk may exist."],
        }
    )


def _chat_json(request: Any) -> str:
    return json.dumps(
        {
            "answer": "Focus on the design proposal after a short correctness check.",
            "goal_ids": [request.goals[0].id],
            "principle_ids": [request.principles[0].id],
            "source_ids": [request.sources[0].id],
            "observations": ["The pull request is described as complete."],
            "inferences": ["Additional polish may have lower opportunity value."],
            "confidence": 0.75,
            "uncertainties": ["Unreported production risk may exist."],
        }
    )


class FakeCompletions:
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        content = self.contents.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeOpenAIClient:
    def __init__(self, contents: list[str]) -> None:
        self.chat = SimpleNamespace(completions=FakeCompletions(contents))


class FailingCompletions:
    async def create(self, **kwargs: Any) -> Any:
        raise OpenAIError("provider unavailable")


class FailingOpenAIClient:
    def __init__(self) -> None:
        self.chat = SimpleNamespace(completions=FailingCompletions())


class FakeCopilotMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class FakeCopilotSession:
    def __init__(self, contents: list[str]) -> None:
        self.contents = contents
        self.session_id = "fake-session"

    async def send_and_wait(self, message: dict[str, str]) -> Any:
        return SimpleNamespace(
            type=SimpleNamespace(value="assistant.message"),
            data=FakeCopilotMessage(self.contents.pop(0)),
        )


class FakeCopilotClient:
    def __init__(self, contents: list[str], options: dict[str, Any]) -> None:
        self.contents = contents
        self.options = options
        self.deleted_session_ids: list[str] = []

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def delete_session(self, session_id: str) -> None:
        self.deleted_session_ids.append(session_id)

    async def create_session(self, options: dict[str, Any]) -> FakeCopilotSession:
        assert options["available_tools"] == []
        assert options["system_message"]["mode"] == "append"
        assert callable(options["on_permission_request"])
        return FakeCopilotSession(self.contents)


class FailingCopilotClient(FakeCopilotClient):
    async def start(self) -> None:
        raise RuntimeError("authentication unavailable")


@pytest.mark.asyncio
async def test_openai_provider_validates_and_retries(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    client = FakeOpenAIClient(["not json", _provider_json(request)])
    provider = OpenAICompatibleProvider(model="test-model", client=client)

    recommendation = await provider.generate(request)

    assert recommendation.goal_ids == ["career_001"]
    assert len(client.chat.completions.calls) == 2


@pytest.mark.asyncio
async def test_openai_provider_supports_chat(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_chat_request(user_directory, mentor_directory)
    client = FakeOpenAIClient([_chat_json(request)])
    provider = OpenAICompatibleProvider(model="test-model", client=client)

    response = await provider.chat(request)

    assert response.goal_ids == ["career_001"]
    response_format = client.chat.completions.calls[0]["response_format"]
    assert response_format["json_schema"]["name"] == "trajectory_chat_response"


@pytest.mark.asyncio
async def test_deterministic_provider_rejects_non_demo_question(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    unrelated = request.model_copy(update={"question": "Should I write the design proposal now?"})

    with pytest.raises(ProviderError, match="supports only the committed"):
        await DeterministicProvider().generate(unrelated)


@pytest.mark.asyncio
async def test_deterministic_provider_does_not_treat_proposal_as_pr(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    proposal = request.model_copy(update={"question": "Should I polish the design proposal?"})

    with pytest.raises(ProviderError, match="supports only the committed"):
        await DeterministicProvider().generate(proposal)


@pytest.mark.asyncio
async def test_openai_provider_does_not_fallback(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    provider = OpenAICompatibleProvider(
        model="test-model",
        client=FakeOpenAIClient(["bad", "still bad"]),
    )

    with pytest.raises(ProviderResponseError):
        await provider.generate(request)


@pytest.mark.asyncio
async def test_openai_provider_wraps_sdk_errors(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    provider = OpenAICompatibleProvider(
        model="test-model",
        client=FailingOpenAIClient(),
    )

    with pytest.raises(ProviderError, match="OpenAI-compatible request failed"):
        await provider.generate(request)


@pytest.mark.asyncio
async def test_copilot_provider_uses_sdk_boundary(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    contents = [_provider_json(request)]
    created_clients: list[FakeCopilotClient] = []

    def factory(options: dict[str, Any]) -> FakeCopilotClient:
        client = FakeCopilotClient(contents, options)
        created_clients.append(client)
        return client

    provider = CopilotProvider(model="test-model", client_factory=factory)
    recommendation = await provider.generate(request)

    assert recommendation.principle_ids == ["demo_opportunity_cost_001"]
    assert created_clients[0].deleted_session_ids == ["fake-session"]


@pytest.mark.asyncio
async def test_copilot_provider_supports_chat(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_chat_request(user_directory, mentor_directory)
    contents = [_chat_json(request)]

    def factory(options: dict[str, Any]) -> FakeCopilotClient:
        return FakeCopilotClient(contents, options)

    provider = CopilotProvider(model="test-model", client_factory=factory)

    response = await provider.chat(request)

    assert response.answer.startswith("Focus on the design proposal")


@pytest.mark.asyncio
async def test_copilot_provider_wraps_sdk_errors(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)

    def factory(options: dict[str, Any]) -> FailingCopilotClient:
        return FailingCopilotClient([], options)

    provider = CopilotProvider(model="test-model", client_factory=factory)

    with pytest.raises(ProviderError, match="Copilot SDK request failed"):
        await provider.generate(request)


def test_openai_environment_requires_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "test-model")

    with pytest.raises(ProviderError, match="OPENAI_API_KEY"):
        OpenAICompatibleProvider.from_environment()
