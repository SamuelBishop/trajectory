"""Load user and mentor configuration from explicit local paths."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import yaml
from pydantic import BaseModel, ValidationError

from trajectory.domain import (
    CommunicationConfig,
    ConstraintsConfig,
    CurrentStateConfig,
    GoalsConfig,
    MentorProfile,
    MentorResources,
    PrinciplesConfig,
    SourcesConfig,
    UserConfig,
    ValuesConfig,
)
from trajectory.errors import AttributionError, ConfigurationError


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ConfigurationError(f"Required configuration file not found: {path}") from error
    except OSError as error:
        raise ConfigurationError(f"Could not read configuration file {path}: {error}") from error


def _read_yaml_model[ModelT: BaseModel](path: Path, model_type: type[ModelT]) -> ModelT:
    text = _read_text(path)
    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise ConfigurationError(f"Invalid YAML in {path}: {error}") from error
    if not isinstance(raw, dict):
        raise ConfigurationError(f"Expected a YAML mapping in {path}")
    try:
        return model_type.model_validate(raw)
    except ValidationError as error:
        raise ConfigurationError(f"Invalid configuration in {path}:\n{error}") from error


def _read_markdown_profile(path: Path) -> MentorProfile:
    text = _read_text(path)
    if not text.startswith("---\n"):
        raise ConfigurationError(f"Mentor profile must start with YAML front matter: {path}")
    try:
        _, front_matter, body = text.split("---", 2)
        raw = yaml.safe_load(front_matter)
    except (ValueError, yaml.YAMLError) as error:
        raise ConfigurationError(
            f"Invalid mentor profile front matter in {path}: {error}"
        ) from error
    if not isinstance(raw, dict):
        raise ConfigurationError(f"Expected a YAML mapping in mentor profile: {path}")
    raw["body"] = body.strip()
    try:
        return MentorProfile.model_validate(raw)
    except ValidationError as error:
        raise ConfigurationError(f"Invalid mentor profile in {path}:\n{error}") from error


class _HasId(Protocol):
    id: str


def _assert_unique_ids(records: Sequence[_HasId], kind: str) -> None:
    ids = [record.id for record in records]
    duplicates = sorted({record_id for record_id in ids if ids.count(record_id) > 1})
    if duplicates:
        raise ConfigurationError(f"Duplicate {kind} IDs: {', '.join(duplicates)}")


def load_user_config(directory: Path) -> UserConfig:
    values = _read_yaml_model(directory / "values.yaml", ValuesConfig)
    goals = _read_yaml_model(directory / "goals.yaml", GoalsConfig)
    current_state = _read_yaml_model(directory / "current_state.yaml", CurrentStateConfig)
    constraints = _read_yaml_model(directory / "constraints.yaml", ConstraintsConfig)
    communication = _read_yaml_model(directory / "communication.yaml", CommunicationConfig)
    _assert_unique_ids(goals.goals, "goal")
    return UserConfig(
        values=values,
        goals=goals.goals,
        current_state=current_state,
        constraints=constraints,
        communication=communication,
    )


def load_mentor_resources(directory: Path) -> MentorResources:
    profile = _read_markdown_profile(directory / "profile.md")
    sources = _read_yaml_model(directory / "sources.yaml", SourcesConfig).sources
    principles = _read_yaml_model(directory / "principles.yaml", PrinciplesConfig).principles
    _assert_unique_ids(sources, "source")
    _assert_unique_ids(principles, "principle")

    source_by_id = {source.id: source for source in sources}
    for source in sources:
        if source.mentor_id != profile.id:
            raise AttributionError(
                f"Source {source.id} belongs to {source.mentor_id}, not profile {profile.id}"
            )
        if not source.approved:
            raise AttributionError(f"Source {source.id} has not been approved")
        if profile.fictional and not source.synthetic:
            raise AttributionError(f"Fictional profile source {source.id} must be synthetic")

    for principle in principles:
        if principle.mentor_id != profile.id:
            raise AttributionError(
                f"Principle {principle.id} belongs to {principle.mentor_id}, "
                f"not profile {profile.id}"
            )
        missing = sorted(set(principle.source_ids) - source_by_id.keys())
        if missing:
            raise AttributionError(
                f"Principle {principle.id} references unknown sources: {', '.join(missing)}"
            )
        if profile.fictional and principle.support_type != "synthetic_demo":
            raise AttributionError(
                f"Fictional profile principle {principle.id} must use synthetic_demo support"
            )

    return MentorResources(profile=profile, sources=sources, principles=principles)
