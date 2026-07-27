#!/usr/bin/env bash
#
# The verification chain for Trajectory. Fail-fast.
#
# Implements: [HC-VERIFY-BEFORE-DONE]
#
# Nothing invokes this automatically. There is no CI and there are no hooks in
# this repository — that is a deliberate choice for a solo project. This script
# exists so "run verification" is one command with no ambiguity about what it
# covers, not so a gate can run it.
#
# It does NOT package the desktop app. Packaging takes minutes, and packaging
# alone is necessary but not sufficient to detect a broken preload bridge
# ([HC-PRELOAD-CJS]) — `electron-builder --dir` never launches the app. When the
# change touches the preload, the Electron build config, or window creation, run
# `cd desktop && npm run package` and then open the packaged app and confirm
# `window.trajectory` is actually defined.

set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON=".venv/bin/python"

if [[ ! -x "$PYTHON" ]]; then
  echo "error: $PYTHON not found." >&2
  echo "The system Python is 3.9 and this project requires 3.12+." >&2
  echo "Create the environment first: python3.12 -m venv .venv" >&2
  exit 1
fi

step() {
  echo
  echo "==> $1"
}

step "Python tests"
"$PYTHON" -m pytest

step "Ruff lint"
"$PYTHON" -m ruff check .

step "Ruff format check"
"$PYTHON" -m ruff format --check .

step "mypy (strict)"
"$PYTHON" -m mypy

if [[ -d desktop/node_modules ]]; then
  step "Desktop typecheck"
  (cd desktop && npm run --silent typecheck)

  step "Desktop tests"
  (cd desktop && npm run --silent test)

  step "Desktop build"
  (cd desktop && npm run --silent build)
else
  echo
  echo "==> Desktop checks SKIPPED — desktop/node_modules missing"
  echo "    Run 'cd desktop && npm install', then rerun."
  echo
  echo "Python checks passed, but this was a PARTIAL run. Not green." >&2
  exit 1
fi

echo
echo "All checks passed."
