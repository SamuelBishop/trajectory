"""Deterministic relevance selection for the small MVP context."""

from __future__ import annotations

import re

from trajectory.domain import Goal, MentorPrinciple, MentorResources, SourceRecord, UserConfig
from trajectory.errors import InsufficientContextError

_TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
_STOP_WORDS = {
    "about",
    "another",
    "could",
    "from",
    "have",
    "into",
    "should",
    "spend",
    "that",
    "this",
    "with",
    "would",
}


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in _TOKEN_PATTERN.findall(value.lower().replace("_", " "))
        if len(token) > 2 and token not in _STOP_WORDS
    }


def _score(query_tokens: set[str], values: list[str]) -> int:
    candidate_tokens = _tokens(" ".join(values))
    return len(query_tokens & candidate_tokens)


def select_goals(question: str, user: UserConfig, limit: int = 3) -> list[Goal]:
    query_tokens = _tokens(question)
    scored = [
        (
            _score(
                query_tokens,
                [goal.description, goal.motivation, goal.domain, *goal.tags],
            ),
            goal,
        )
        for goal in user.goals
        if goal.status == "active"
    ]
    relevant = [(score, goal) for score, goal in scored if score > 0]
    relevant.sort(key=lambda item: (-item[0], item[1].priority, item[1].id))
    if not relevant:
        raise InsufficientContextError(
            "No active goal matched the question. Add relevant terms or tags to goals.yaml."
        )
    return [goal for _, goal in relevant[:limit]]


def select_principles(
    question: str,
    goals: list[Goal],
    resources: MentorResources,
    limit: int = 3,
) -> list[MentorPrinciple]:
    query_tokens = _tokens(question)
    query_tokens.update(_tokens(" ".join(goal.domain for goal in goals)))
    scored = [
        (
            _score(
                query_tokens,
                [principle.name, principle.description, *principle.domains, *principle.tags],
            ),
            principle,
        )
        for principle in resources.principles
    ]
    relevant = [(score, principle) for score, principle in scored if score > 0]
    relevant.sort(key=lambda item: (-item[0], item[1].id))
    if not relevant:
        raise InsufficientContextError(
            "No mentor principle matched the question and selected goals."
        )
    return [principle for _, principle in relevant[:limit]]


def select_sources(
    principles: list[MentorPrinciple],
    resources: MentorResources,
) -> list[SourceRecord]:
    source_ids = {source_id for principle in principles for source_id in principle.source_ids}
    selected = [source for source in resources.sources if source.id in source_ids]
    selected.sort(key=lambda source: source.id)
    if not selected:
        raise InsufficientContextError("Selected principles have no approved sources.")
    return selected
