"""Strict domain models for decision review."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
ChatText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=12_000),
]
Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, pattern=r"^[a-z0-9][a-z0-9_-]*$"),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ValuesConfig(StrictModel):
    core_values: list[Text] = Field(min_length=1)
    non_negotiables: list[Text] = Field(default_factory=list)
    definitions_of_success: list[Text] = Field(default_factory=list)
    unacceptable_tradeoffs: list[Text] = Field(default_factory=list)


class Goal(StrictModel):
    id: Identifier
    description: Text
    motivation: Text
    priority: int = Field(ge=1, le=5)
    domain: Identifier
    success_criteria: list[Text] = Field(min_length=1)
    status: Literal["active", "paused", "completed", "rejected"]
    target_date: date | None = None
    tags: list[Text] = Field(default_factory=list)


class GoalsConfig(StrictModel):
    goals: list[Goal] = Field(min_length=1)


class CurrentStateConfig(StrictModel):
    current_role: Text
    responsibilities: list[Text] = Field(default_factory=list)
    current_projects: list[Text] = Field(default_factory=list)
    known_deadlines: list[Text] = Field(default_factory=list)
    current_energy: Text
    recent_progress: list[Text] = Field(default_factory=list)
    unresolved_decisions: list[Text] = Field(default_factory=list)


class ConstraintsConfig(StrictModel):
    practical_constraints: list[Text] = Field(default_factory=list)
    protected_commitments: list[Text] = Field(default_factory=list)


class CommunicationConfig(StrictModel):
    directness: Text
    warmth: Text
    challenge_level: Text
    tolerance_for_excuses: Text
    uncertainty_style: Text
    verbosity: Text
    use_of_questions: Text
    use_of_evidence: Text
    encourage_when: Text
    critique_when: Text
    prohibited_patterns: list[Text] = Field(min_length=1)


class UserConfig(StrictModel):
    values: ValuesConfig
    goals: list[Goal]
    current_state: CurrentStateConfig
    constraints: ConstraintsConfig
    communication: CommunicationConfig


class MentorProfile(StrictModel):
    id: Identifier
    name: Text
    fictional: bool
    description: Text
    domains: list[Identifier] = Field(min_length=1)
    disclaimer: Text
    body: Text


class SourceRecord(StrictModel):
    id: Identifier
    title: Text
    creator: Text
    mentor_id: Identifier
    source_type: Identifier
    url: Text | None = None
    publication_date: date | None = None
    accessed_date: date | None = None
    first_party: bool
    approved: bool
    copyright_status: Identifier
    synthetic: bool
    notes: Text


class SourcesConfig(StrictModel):
    sources: list[SourceRecord] = Field(min_length=1)


class MentorPrinciple(StrictModel):
    id: Identifier
    mentor_id: Identifier
    name: Text
    description: Text
    domains: list[Identifier] = Field(min_length=1)
    tags: list[Text] = Field(default_factory=list)
    source_ids: list[Identifier] = Field(min_length=1)
    support_type: Literal[
        "explicit",
        "strong_inference",
        "weak_inference",
        "user_defined",
        "synthetic_demo",
    ]
    confidence: float = Field(ge=0, le=1)
    interpretation_notes: Text
    possible_limitations: list[Text] = Field(default_factory=list)
    possible_conflicts: list[Text] = Field(default_factory=list)
    review_status: Identifier


class PrinciplesConfig(StrictModel):
    principles: list[MentorPrinciple] = Field(min_length=1)


class MentorResources(StrictModel):
    profile: MentorProfile
    sources: list[SourceRecord]
    principles: list[MentorPrinciple]


class DecisionRequest(StrictModel):
    question: Text
    values: ValuesConfig
    current_state: CurrentStateConfig
    constraints: ConstraintsConfig
    communication: CommunicationConfig
    goals: list[Goal] = Field(min_length=1)
    mentor_profile: MentorProfile
    principles: list[MentorPrinciple] = Field(min_length=1)
    sources: list[SourceRecord] = Field(min_length=1)
    provider: Identifier
    prompt_version: Identifier


class Recommendation(StrictModel):
    assessment: Text
    response: Text
    why_now: Text
    goal_ids: list[Identifier] = Field(min_length=1)
    principle_ids: list[Identifier] = Field(min_length=1)
    source_ids: list[Identifier] = Field(min_length=1)
    observations: list[Text] = Field(min_length=1)
    inferences: list[Text] = Field(min_length=1)
    alternatives_considered: list[Text] = Field(min_length=2)
    suggested_next_step: Text
    confidence: float = Field(ge=0, le=1)
    uncertainties: list[Text] = Field(min_length=1)


class DecisionResult(StrictModel):
    recommendation: Recommendation
    request: DecisionRequest


class ChatMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: ChatText


class ChatInput(StrictModel):
    message: ChatText
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class ChatRequest(StrictModel):
    message: ChatText
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)
    values: ValuesConfig
    current_state: CurrentStateConfig
    constraints: ConstraintsConfig
    communication: CommunicationConfig
    goals: list[Goal] = Field(min_length=1)
    mentor_profile: MentorProfile
    principles: list[MentorPrinciple] = Field(min_length=1)
    sources: list[SourceRecord] = Field(min_length=1)
    provider: Identifier
    prompt_version: Identifier


class ChatResponse(StrictModel):
    answer: ChatText
    goal_ids: list[Identifier] = Field(min_length=1)
    principle_ids: list[Identifier] = Field(min_length=1)
    source_ids: list[Identifier] = Field(min_length=1)
    observations: list[Text]
    inferences: list[Text]
    confidence: float = Field(ge=0, le=1)
    uncertainties: list[Text] = Field(min_length=1)


class ChatResult(StrictModel):
    response: ChatResponse
    request: ChatRequest
