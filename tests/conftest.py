from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def user_directory() -> Path:
    return PROJECT_ROOT / "examples" / "demo" / "user"


@pytest.fixture
def mentor_directory() -> Path:
    return PROJECT_ROOT / "resources" / "mentors" / "demo_mentor"
