"""OpenAI and OpenAI-compatible structured recommendation provider."""

from __future__ import annotations

import os
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


class OpenAICompatibleProvider:
    name = "openai"

    def __init__(
        self,
        *,
        model: str,
        api_key: str | None = None,
        base_url: str | None = None,
        client: Any | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url
        self._client = client

    @classmethod
    def from_environment(cls) -> OpenAICompatibleProvider:
        api_key = os.getenv("OPENAI_API_KEY")
        model = os.getenv("OPENAI_MODEL")
        base_url = os.getenv("OPENAI_BASE_URL")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is required for the OpenAI provider")
        if not model:
            raise ProviderError("OPENAI_MODEL is required for the OpenAI provider")
        return cls(model=model, api_key=api_key, base_url=base_url)

    def _create_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from openai import AsyncOpenAI
        except ImportError as error:
            raise ProviderError(
                "OpenAI provider is not installed. Run: pip install '.[openai]'"
            ) from error
        self._client = AsyncOpenAI(api_key=self.api_key, base_url=self.base_url)
        return self._client

    def _response_format(
        self,
        model_type: type[BaseModel],
        schema_name: str,
    ) -> dict[str, Any]:
        if self.base_url and "api.openai.com" not in self.base_url:
            return {"type": "json_object"}
        return {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": model_type.model_json_schema(),
            },
        }

    async def _generate_structured[ResponseT: BaseModel](
        self,
        *,
        system_prompt: str,
        user_message: str,
        model_type: type[ResponseT],
        schema_name: str,
    ) -> ResponseT:
        client = self._create_client()
        try:
            from openai import OpenAIError
        except ImportError as error:
            raise ProviderError(
                "OpenAI provider is not installed. Run: pip install '.[openai]'"
            ) from error
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        last_error: ProviderResponseError | None = None
        for attempt in range(2):
            try:
                response = await client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format=self._response_format(model_type, schema_name),
                    temperature=0,
                )
            except OpenAIError as error:
                raise ProviderError(
                    f"OpenAI-compatible request failed ({type(error).__name__}). "
                    "Check the API key, model, endpoint, and account access."
                ) from error
            if not response.choices:
                last_error = ProviderResponseError("OpenAI provider returned no completion choices")
                continue
            content = response.choices[0].message.content
            if not content:
                last_error = ProviderResponseError("OpenAI provider returned no content")
            else:
                try:
                    return parse_structured_response(content, model_type)
                except ProviderResponseError as error:
                    last_error = error
            if attempt == 0:
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Your response was not valid against the supplied schema. "
                            "Return only a corrected JSON object."
                        ),
                    }
                )
        if last_error is None:
            raise ProviderResponseError("OpenAI provider did not return structured output")
        raise last_error

    async def generate(self, request: DecisionRequest) -> Recommendation:
        return await self._generate_structured(
            system_prompt=SYSTEM_PROMPT,
            user_message=build_user_message(request),
            model_type=Recommendation,
            schema_name="trajectory_recommendation",
        )

    async def chat(self, request: ChatRequest) -> ChatResponse:
        return await self._generate_structured(
            system_prompt=CHAT_SYSTEM_PROMPT,
            user_message=build_chat_user_message(request),
            model_type=ChatResponse,
            schema_name="trajectory_chat_response",
        )
