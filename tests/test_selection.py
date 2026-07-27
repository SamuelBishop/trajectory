from pathlib import Path

import pytest

from trajectory.config import load_mentor_resources, load_user_config
from trajectory.errors import InsufficientContextError
from trajectory.selection import select_goals, select_principles, select_sources


def test_selects_grounding_deterministically(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    user = load_user_config(user_directory)
    resources = load_mentor_resources(mentor_directory)
    question = "Should I keep polishing this pull request?"

    goals = select_goals(question, user)
    principles = select_principles(question, goals, resources)
    sources = select_sources(principles, resources)

    assert [goal.id for goal in goals] == ["career_001"]
    assert [principle.id for principle in principles] == ["demo_opportunity_cost_001"]
    assert [source.id for source in sources] == ["demo_source_001"]


def test_fails_when_no_goal_matches(user_directory: Path) -> None:
    user = load_user_config(user_directory)

    with pytest.raises(InsufficientContextError, match="No active goal matched"):
        select_goals("Should I buy a telescope?", user)
