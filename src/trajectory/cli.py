"""Trajectory command-line interface."""

from __future__ import annotations

import asyncio
import sys
from enum import StrEnum
from importlib.resources import files
from pathlib import Path
from typing import Annotated

import typer
from pydantic import ValidationError

from trajectory.domain import ChatInput
from trajectory.errors import TrajectoryError
from trajectory.mentorship import chat_with_mentor, review_decision
from trajectory.providers import (
    CopilotProvider,
    DeterministicProvider,
    MentorProvider,
    OpenAICompatibleProvider,
)
from trajectory.rendering import render_chat_response, render_recommendation

app = typer.Typer(
    no_args_is_help=True,
    help="Local-first, source-grounded decision mentorship.",
)


def _default_directory(repository_path: Path, package_path: str) -> Path:
    if repository_path.is_dir():
        return repository_path
    source_checkout_path = Path(__file__).resolve().parents[2] / repository_path
    if source_checkout_path.is_dir():
        return source_checkout_path
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


@app.command()
def chat(
    message: Annotated[
        str | None,
        typer.Argument(help="The message to send. Omit when using --input-json."),
    ] = None,
    provider: Annotated[
        ProviderName,
        typer.Option("--provider", case_sensitive=False, help="Model provider to use."),
    ] = ProviderName.copilot,
    user_directory: Annotated[
        Path,
        typer.Option("--user-dir", file_okay=False, help="User configuration directory."),
    ] = DEFAULT_USER_DIRECTORY,
    mentor_directory: Annotated[
        Path,
        typer.Option("--mentor-dir", file_okay=False, help="Mentor resource directory."),
    ] = DEFAULT_MENTOR_DIRECTORY,
    input_json: Annotated[
        bool,
        typer.Option("--input-json", help="Read message and history JSON from stdin."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print the structured chat response as JSON."),
    ] = False,
) -> None:
    try:
        if input_json:
            raw = sys.stdin.read(1_000_001)
            if len(raw) > 1_000_000:
                raise typer.BadParameter("stdin JSON exceeds 1 MB")
            payload = ChatInput.model_validate_json(raw)
        elif message is not None:
            payload = ChatInput(message=message)
        else:
            raise typer.BadParameter("Provide a message or use --input-json")

        result = asyncio.run(
            chat_with_mentor(
                message=payload.message,
                history=payload.history,
                provider=_provider(provider),
                user_directory=user_directory,
                mentor_directory=mentor_directory,
            )
        )
    except (TrajectoryError, ValidationError) as error:
        typer.echo(f"Error: {error}", err=True)
        raise typer.Exit(code=1) from error

    if json_output:
        typer.echo(result.response.model_dump_json(indent=2))
    else:
        typer.echo(render_chat_response(result.response))


if __name__ == "__main__":
    app()
