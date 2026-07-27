from pathlib import Path

import pytest

from tests.helpers import demo_request
from trajectory.domain import Recommendation
from trajectory.errors import AttributionError
from trajectory.providers.deterministic import DeterministicProvider
from trajectory.validation import validate_recommendation


@pytest.mark.asyncio
async def test_accepts_resolved_attribution(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)

    validate_recommendation(recommendation, request)


@pytest.mark.asyncio
async def test_rejects_unknown_recommendation_citation(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)
    raw = recommendation.model_dump()
    raw["source_ids"] = ["invented_source"]

    with pytest.raises(AttributionError, match="unknown sources: invented_source"):
        validate_recommendation(Recommendation.model_validate(raw), request)


@pytest.mark.asyncio
async def test_preserves_observation_and_inference_fields(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)

    assert "asked" in recommendation.observations[0]
    assert "may be perfectionism" in recommendation.inferences[0]


@pytest.mark.asyncio
async def test_accepts_independently_sourced_principles(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)
    second_source = request.sources[0].model_copy(update={"id": "demo_source_002"})
    second_principle = request.principles[0].model_copy(
        update={
            "id": "demo_opportunity_cost_002",
            "source_ids": ["demo_source_002"],
        }
    )
    expanded_request = request.model_copy(
        update={
            "principles": [*request.principles, second_principle],
            "sources": [*request.sources, second_source],
        }
    )
    raw = recommendation.model_dump()
    raw["principle_ids"] = [
        "demo_opportunity_cost_001",
        "demo_opportunity_cost_002",
    ]
    raw["source_ids"] = ["demo_source_001", "demo_source_002"]

    validate_recommendation(Recommendation.model_validate(raw), expanded_request)


@pytest.mark.asyncio
async def test_rejects_principle_without_cited_support(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)
    second_source = request.sources[0].model_copy(update={"id": "demo_source_002"})
    second_principle = request.principles[0].model_copy(
        update={
            "id": "demo_opportunity_cost_002",
            "source_ids": ["demo_source_002"],
        }
    )
    expanded_request = request.model_copy(
        update={
            "principles": [*request.principles, second_principle],
            "sources": [*request.sources, second_source],
        }
    )
    raw = recommendation.model_dump()
    raw["principle_ids"] = [
        "demo_opportunity_cost_001",
        "demo_opportunity_cost_002",
    ]

    with pytest.raises(AttributionError, match="have no cited supporting source"):
        validate_recommendation(Recommendation.model_validate(raw), expanded_request)


@pytest.mark.asyncio
async def test_rejects_source_without_cited_principle_link(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    request = await demo_request(user_directory, mentor_directory)
    recommendation = await DeterministicProvider().generate(request)
    unlinked_source = request.sources[0].model_copy(update={"id": "demo_source_002"})
    expanded_request = request.model_copy(update={"sources": [*request.sources, unlinked_source]})
    raw = recommendation.model_dump()
    raw["source_ids"] = ["demo_source_001", "demo_source_002"]

    with pytest.raises(AttributionError, match="not linked to a cited principle"):
        validate_recommendation(Recommendation.model_validate(raw), expanded_request)
