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

cd "$(dirname "$0")/../desktop"

if [[ ! -d node_modules ]]; then
  echo "error: desktop/node_modules is missing." >&2
  echo "Run 'cd desktop && npm install', then rerun." >&2
  exit 1
fi

step() {
  echo
  echo "==> $1"
}

step "Typecheck"
npm run --silent typecheck

step "Tests"
npm run --silent test

step "Build"
npm run --silent build

echo
echo "All checks passed."
