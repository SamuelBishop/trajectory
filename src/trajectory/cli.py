"""Trajectory command-line interface."""

from __future__ import annotations

import asyncio
from enum import StrEnum
from importlib.resources import files
from pathlib import Path
from typing import Annotated

import typer

from trajectory.errors import TrajectoryError
from trajectory.mentorship import review_decision
from trajectory.providers import (
    CopilotProvider,
    DeterministicProvider,
    MentorProvider,
    OpenAICompatibleProvider,
)
from trajectory.rendering import render_recommendation

app = typer.Typer(
    no_args_is_help=True,
    help="Local-first, source-grounded decision mentorship.",
)


def _default_directory(repository_path: Path, package_path: str) -> Path:
    if repository_path.is_dir():
        return repository_path
    return Path(str(files("trajectory").joinpath(package_path)))


DEFAULT_USER_DIRECTORY = _default_directory(
    Path("examples/demo/user"),
    "demo/user",
)
DEFAULT_MENTOR_DIRECTORY = _default_directory(
    Path("resources/mentors/demo_mentor"),
    "demo/mentor",
)


class ProviderName(StrEnum):
    deterministic = "deterministic"
    copilot = "copilot"
    openai = "openai"


@app.callback()
def main() -> None:
    """Trajectory command group."""


def _provider(name: ProviderName) -> MentorProvider:
    if name is ProviderName.copilot:
        return CopilotProvider.from_environment()
    if name is ProviderName.openai:
        return OpenAICompatibleProvider.from_environment()
    return DeterministicProvider()


@app.command()
def decide(
    question: Annotated[str, typer.Argument(help="The decision you want reviewed.")],
    provider: Annotated[
        ProviderName,
        typer.Option(
            "--provider",
            case_sensitive=False,
            help="Model provider to use.",
        ),
    ] = ProviderName.deterministic,
    user_directory: Annotated[
        Path,
        typer.Option(
            "--user-dir",
            exists=False,
            file_okay=False,
            dir_okay=True,
            readable=True,
            help="Directory containing the user's YAML configuration.",
        ),
    ] = DEFAULT_USER_DIRECTORY,
    mentor_directory: Annotated[
        Path,
        typer.Option(
            "--mentor-dir",
            exists=False,
            file_okay=False,
            dir_okay=True,
            readable=True,
            help="Directory containing one mentor profile and its grounding.",
        ),
    ] = DEFAULT_MENTOR_DIRECTORY,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print the validated recommendation as JSON."),
    ] = False,
) -> None:
    try:
        result = asyncio.run(
            review_decision(
                question=question,
                provider=_provider(provider),
                user_directory=user_directory,
                mentor_directory=mentor_directory,
            )
        )
    except TrajectoryError as error:
        typer.echo(f"Error: {error}", err=True)
        raise typer.Exit(code=1) from error

    if json_output:
        typer.echo(result.recommendation.model_dump_json(indent=2))
    else:
        typer.echo(render_recommendation(result.recommendation))


if __name__ == "__main__":
    app()
