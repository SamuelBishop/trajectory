from pathlib import Path
from shutil import copytree

import pytest
import yaml

from trajectory.config import load_mentor_resources, load_user_config
from trajectory.errors import AttributionError, ConfigurationError


def test_loads_all_demo_configuration(
    user_directory: Path,
    mentor_directory: Path,
) -> None:
    user = load_user_config(user_directory)
    resources = load_mentor_resources(mentor_directory)

    assert [goal.id for goal in user.goals] == ["career_001", "health_001"]
    assert resources.profile.fictional is True
    assert resources.sources[0].synthetic is True
    assert resources.principles[0].source_ids == ["demo_source_001"]


def test_rejects_duplicate_goal_ids(user_directory: Path, tmp_path: Path) -> None:
    copied = tmp_path / "user"
    copytree(user_directory, copied)
    goals_path = copied / "goals.yaml"
    raw = yaml.safe_load(goals_path.read_text(encoding="utf-8"))
    raw["goals"].append(raw["goals"][0])
    goals_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    with pytest.raises(ConfigurationError, match="Duplicate goal IDs: career_001"):
        load_user_config(copied)


def test_reports_file_for_malformed_configuration(
    user_directory: Path,
    tmp_path: Path,
) -> None:
    copied = tmp_path / "user"
    copytree(user_directory, copied)
    (copied / "values.yaml").write_text("core_values: not-a-list\n", encoding="utf-8")

    with pytest.raises(ConfigurationError, match=r"values\.yaml"):
        load_user_config(copied)


def test_rejects_unknown_principle_source(
    mentor_directory: Path,
    tmp_path: Path,
) -> None:
    copied = tmp_path / "mentor"
    copytree(mentor_directory, copied)
    principles_path = copied / "principles.yaml"
    raw = yaml.safe_load(principles_path.read_text(encoding="utf-8"))
    raw["principles"][0]["source_ids"] = ["missing_source"]
    principles_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    with pytest.raises(AttributionError, match="unknown sources: missing_source"):
        load_mentor_resources(copied)


def test_rejects_unapproved_source(mentor_directory: Path, tmp_path: Path) -> None:
    copied = tmp_path / "mentor"
    copytree(mentor_directory, copied)
    sources_path = copied / "sources.yaml"
    raw = yaml.safe_load(sources_path.read_text(encoding="utf-8"))
    raw["sources"][0]["approved"] = False
    sources_path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")

    with pytest.raises(AttributionError, match="has not been approved"):
        load_mentor_resources(copied)
