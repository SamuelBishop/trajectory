"""Versioned prompts and structured response parsing."""

from __future__ import annotations

import json

from pydantic import BaseModel, ValidationError

from trajectory.domain import ChatRequest, ChatResponse, DecisionRequest, Recommendation
from trajectory.errors import ProviderResponseError

PROMPT_VERSION = "decision_v1"
CHAT_PROMPT_VERSION = "chat_v1"

SYSTEM_PROMPT = """\
You are Trajectory, a candid and calm decision mentor.

Prioritize the user's supplied values, constraints, and goals over mentor principles.
Evaluate opportunity cost. Treat recovery, relationships, health, and leisure as
legitimate priorities. Challenge avoidance or perfectionism only as labeled inference.
Distinguish user statements and observations from model inference. Cite only IDs in
the supplied context. Do not quote or claim to speak for a real person. Do not make
unsupported scientific claims, diagnose health conditions, shame the user, provide
empty praise, expose chain of thought, or manufacture certainty.

Return only one JSON object matching the supplied Recommendation schema. Include a
concise rationale, concrete next step, confidence from 0 to 1, and material uncertainty.
"""

CHAT_SYSTEM_PROMPT = """\
You are Trajectory, a candid, calm, and context-aware mentor in an ongoing chat.

Answer the user's current message directly while using the supplied conversation
history, values, constraints, goals, current state, and mentor principles. Prioritize
the user's values over mentor principles. Distinguish observations from inference,
cite only supplied IDs, acknowledge meaningful uncertainty, and preserve user agency.
Do not imitate or claim to speak for a real person. Do not diagnose health conditions,
shame the user, provide empty praise, expose chain of thought, or invent evidence.

Return only one JSON object matching the supplied ChatResponse schema.
"""


def build_user_message(request: DecisionRequest) -> str:
    schema = Recommendation.model_json_schema()
    context = request.model_dump(mode="json")
    return (
        "Recommendation JSON schema:\n"
        f"{json.dumps(schema, separators=(',', ':'), sort_keys=True)}\n\n"
        "Decision context:\n"
        f"{json.dumps(context, separators=(',', ':'), sort_keys=True)}"
    )


def build_chat_user_message(request: ChatRequest) -> str:
    schema = ChatResponse.model_json_schema()
    context = request.model_dump(mode="json")
    return (
        "ChatResponse JSON schema:\n"
        f"{json.dumps(schema, separators=(',', ':'), sort_keys=True)}\n\n"
        "Chat context:\n"
        f"{json.dumps(context, separators=(',', ':'), sort_keys=True)}"
    )


def parse_structured_response[ResponseT: BaseModel](
    content: str,
    model_type: type[ResponseT],
) -> ResponseT:
    candidate = content.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1])
            if candidate.lstrip().startswith("json\n"):
                candidate = candidate.lstrip()[5:]
    try:
        raw = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise ProviderResponseError(f"Provider returned invalid JSON: {error.msg}") from error
    try:
        return model_type.model_validate(raw)
    except ValidationError as error:
        raise ProviderResponseError(
            f"Provider response failed schema validation:\n{error}"
        ) from error


def parse_recommendation(content: str) -> Recommendation:
    return parse_structured_response(content, Recommendation)


def parse_chat_response(content: str) -> ChatResponse:
    return parse_structured_response(content, ChatResponse)
