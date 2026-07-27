import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from trajectory.cli import app

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
