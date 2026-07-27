import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from trajectory.cli import _default_directory, app

runner = CliRunner()
QUESTION = "Should I spend another two hours polishing this low-risk pull request?"


def test_cli_deterministic_happy_path() -> None:
    result = runner.invoke(app, ["decide", QUESTION])

    assert result.exit_code == 0
    assert "Assessment: Stop after resolving only correctness-relevant concerns." in result.stdout
    assert "Inference: Further polishing may be perfectionism" in result.stdout
    assert "Confidence: Moderate" in result.stdout
    assert "career_001" in result.stdout
    assert "demo_opportunity_cost_001" in result.stdout
    assert "demo_source_001" in result.stdout


def test_cli_json_output() -> None:
    result = runner.invoke(app, ["decide", QUESTION, "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["goal_ids"] == ["career_001"]
    assert payload["confidence"] == 0.72
    assert payload["observations"]
    assert payload["inferences"]


def test_chat_cli_accepts_private_history_on_stdin() -> None:
    payload = {
        "message": QUESTION,
        "history": [
            {"role": "user", "content": "I am deciding what to do tonight."},
            {"role": "assistant", "content": "What are the highest-value alternatives?"},
        ],
    }
    result = runner.invoke(
        app,
        ["chat", "--provider", "deterministic", "--json", "--input-json"],
        input=json.dumps(payload),
    )

    assert result.exit_code == 0
    response = json.loads(result.stdout)
    assert "short correctness check" in response["answer"]
    assert response["goal_ids"] == ["career_001"]
    assert response["uncertainties"]


def test_default_directory_finds_editable_checkout_outside_repository(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.chdir(tmp_path)

    directory = _default_directory(Path("examples/demo/user"), "demo/user")

    assert (directory / "values.yaml").is_file()


def test_cli_reports_missing_configuration(tmp_path: Path) -> None:
    result = runner.invoke(
        app,
        ["decide", QUESTION, "--user-dir", str(tmp_path / "missing")],
    )

    assert result.exit_code == 1
    assert "Required configuration file not found" in result.stderr


def test_cli_openai_never_prints_fake_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_secret = "sk-do-not-print-this"
    monkeypatch.setenv("OPENAI_API_KEY", fake_secret)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    result = runner.invoke(app, ["decide", QUESTION, "--provider", "openai"])

    assert result.exit_code == 1
    assert "OPENAI_MODEL is required" in result.stderr
    assert fake_secret not in result.stderr
