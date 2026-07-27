"""GitHub Copilot SDK recommendation provider."""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from trajectory.domain import (
    ChatRequest,
    ChatResponse,
    DecisionRequest,
    Recommendation,
)
from trajectory.errors import ProviderError, ProviderResponseError
from trajectory.prompting import (
    CHAT_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_chat_user_message,
    build_user_message,
    parse_structured_response,
)


class CopilotProvider:
    name = "copilot"

    def __init__(
        self,
        *,
        model: str,
        github_token: str | None = None,
        client_factory: Callable[..., Any] | None = None,
    ) -> None:
        self.model = model
        self.github_token = github_token
        self._client_factory = client_factory

    @classmethod
    def from_environment(cls) -> CopilotProvider:
        return cls(
            model=os.getenv("COPILOT_MODEL", "gpt-5"),
            github_token=os.getenv("COPILOT_GITHUB_TOKEN"),
        )

    def _load_sdk(
        self,
    ) -> tuple[
        Callable[..., Any],
        Callable[..., Any],
        tuple[type[Exception], ...],
    ]:
        if self._client_factory is not None:
            return (
                self._client_factory,
                lambda *_args: None,
                (OSError, RuntimeError, TimeoutError, ValueError),
            )
        try:
            from copilot import CopilotClient, PermissionRequestResult, StopError
            from copilot.jsonrpc import JsonRpcError, ProcessExitedError
        except ImportError as error:
            raise ProviderError(
                "Copilot provider is not installed. Run: pip install '.[copilot]'"
            ) from error
        return (
            CopilotClient,
            lambda *_args: PermissionRequestResult(),
            (
                JsonRpcError,
                ProcessExitedError,
                StopError,
                OSError,
                RuntimeError,
                TimeoutError,
                ValueError,
            ),
        )

    async def _generate_structured[ResponseT: BaseModel](
        self,
        *,
        system_prompt: str,
        user_message: str,
        model_type: type[ResponseT],
    ) -> ResponseT:
        client_factory, deny_permission, sdk_errors = self._load_sdk()
        client_options: dict[str, Any] = {
            "log_level": "error",
            "use_logged_in_user": self.github_token is None,
        }
        if self.github_token:
            client_options["github_token"] = self.github_token

        session_config: dict[str, Any] = {
            "client_name": "trajectory",
            "model": self.model,
            "system_message": {"mode": "append", "content": system_prompt},
            "available_tools": [],
            "on_permission_request": deny_permission,
            "streaming": False,
            "infinite_sessions": {"enabled": False},
        }
        client: Any | None = None
        session: Any | None = None
        try:
            client = client_factory(client_options)
            try:
                await client.start()
                session = await client.create_session(session_config)
                message = user_message
                last_error: ProviderResponseError | None = None
                for attempt in range(2):
                    reply = await session.send_and_wait({"prompt": message})
                    event_type = getattr(getattr(reply, "type", None), "value", None)
                    content = getattr(getattr(reply, "data", None), "content", None)
                    if reply is None or event_type != "assistant.message" or not content:
                        last_error = ProviderResponseError(
                            "Copilot SDK returned no assistant message"
                        )
                    else:
                        try:
                            return parse_structured_response(content, model_type)
                        except ProviderResponseError as error:
                            last_error = error
                    if attempt == 0:
                        message = (
                            "Your response was not valid against the supplied schema. "
                            "Return only a corrected JSON object."
                        )
                if last_error is None:
                    raise ProviderResponseError("Copilot SDK did not return a recommendation")
                raise last_error
            finally:
                if client is not None:
                    try:
                        if session is not None:
                            await client.delete_session(session.session_id)
                    finally:
                        await client.stop()
        except sdk_errors as error:
            raise ProviderError(
                f"Copilot SDK request failed ({type(error).__name__}). "
                "Check local GitHub authentication, entitlement, model access, "
                "and organization policy."
            ) from error
        except ExceptionGroup as error:
            _, unexpected = error.split(sdk_errors)
            if unexpected is not None:
                raise
            raise ProviderError(
                "Copilot SDK cleanup failed. The recommendation was not accepted; "
                "check local Copilot session storage before retrying."
            ) from error

    async def generate(self, request: DecisionRequest) -> Recommendation:
        return await self._generate_structured(
            system_prompt=SYSTEM_PROMPT,
            user_message=build_user_message(request),
            model_type=Recommendation,
        )

    async def chat(self, request: ChatRequest) -> ChatResponse:
        return await self._generate_structured(
            system_prompt=CHAT_SYSTEM_PROMPT,
            user_message=build_chat_user_message(request),
            model_type=ChatResponse,
        )
