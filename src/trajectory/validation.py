"""Cross-record validation for generated recommendations."""

from __future__ import annotations

from trajectory.domain import DecisionRequest, Recommendation
from trajectory.errors import AttributionError


def _unknown(cited: list[str], available: set[str]) -> list[str]:
    return sorted(set(cited) - available)


def validate_recommendation(
    recommendation: Recommendation,
    request: DecisionRequest,
) -> None:
    unknown_goals = _unknown(recommendation.goal_ids, {goal.id for goal in request.goals})
    if unknown_goals:
        raise AttributionError(f"Recommendation cites unknown goals: {', '.join(unknown_goals)}")

    principle_by_id = {principle.id: principle for principle in request.principles}
    unknown_principles = _unknown(recommendation.principle_ids, set(principle_by_id))
    if unknown_principles:
        raise AttributionError(
            f"Recommendation cites unknown principles: {', '.join(unknown_principles)}"
        )

    source_ids = {source.id for source in request.sources}
    unknown_sources = _unknown(recommendation.source_ids, source_ids)
    if unknown_sources:
        raise AttributionError(
            f"Recommendation cites unknown sources: {', '.join(unknown_sources)}"
        )

    cited_sources = set(recommendation.source_ids)
    uncovered_principles = sorted(
        principle_id
        for principle_id in recommendation.principle_ids
        if not cited_sources.intersection(principle_by_id[principle_id].source_ids)
    )
    if uncovered_principles:
        raise AttributionError(
            "Recommendation principles have no cited supporting source: "
            f"{', '.join(uncovered_principles)}"
        )

    linked_sources: set[str] = set()
    for principle_id in recommendation.principle_ids:
        linked_sources.update(principle_by_id[principle_id].source_ids)
    unlinked_sources = sorted(cited_sources - linked_sources)
    if unlinked_sources:
        raise AttributionError(
            "Recommendation sources are not linked to a cited principle: "
            f"{', '.join(unlinked_sources)}"
        )


def validate_demo_grounding(request: DecisionRequest) -> None:
    if not request.mentor_profile.fictional:
        return
    if any(not source.synthetic for source in request.sources):
        raise AttributionError("Fictional demo mentor may cite only synthetic sources")
    if any(principle.support_type != "synthetic_demo" for principle in request.principles):
        raise AttributionError("Fictional demo mentor may use only synthetic principles")
