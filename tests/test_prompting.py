import json

import pytest

from trajectory.domain import Recommendation
from trajectory.errors import ProviderResponseError
from trajectory.prompting import parse_recommendation


def _valid_recommendation() -> dict[str, object]:
    return {
        "assessment": "redirect",
        "response": "Stop polishing.",
        "why_now": "The alternative is more valuable.",
        "goal_ids": ["career_001"],
        "principle_ids": ["demo_opportunity_cost_001"],
        "source_ids": ["demo_source_001"],
        "observations": ["The pull request is described as low risk."],
        "inferences": ["More polish may be perfectionism."],
        "alternatives_considered": ["Keep polishing.", "Submit after a short check."],
        "suggested_next_step": "Run the checklist and submit.",
        "confidence": 0.7,
        "uncertainties": ["Unreported risk may exist."],
    }


def test_parses_json_and_fenced_json() -> None:
    raw = json.dumps(_valid_recommendation())

    assert isinstance(parse_recommendation(raw), Recommendation)
    assert isinstance(parse_recommendation(f"```json\n{raw}\n```"), Recommendation)


def test_rejects_invalid_json() -> None:
    with pytest.raises(ProviderResponseError, match="invalid JSON"):
        parse_recommendation("not json")


def test_rejects_out_of_range_confidence() -> None:
    raw = _valid_recommendation()
    raw["confidence"] = 1.1

    with pytest.raises(ProviderResponseError, match="schema validation"):
        parse_recommendation(json.dumps(raw))
