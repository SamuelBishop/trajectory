---
name: verify
description: Run the Trajectory verification chain and report the results verbatim, without fixing anything.
---

# Verify

Run the verification chain and report exactly what happened.

## Process

1. Run the chain:

   ```bash
   ./scripts/verify.sh
   ```

   It is fail-fast: Python tests, Ruff lint, Ruff format check, mypy strict,
   then the desktop typecheck, tests, and build.

2. If the diff is narrow, a subset is acceptable — but name which stages ran and
   why they cover the change. A partial run reported as a full one is the
   failure this exists to prevent (`[HC-VERIFY-BEFORE-DONE]`).

3. Package the desktop app when the change touched
   `desktop/electron.vite.config.ts`, `desktop/src/preload/**`, or window
   creation:

   ```bash
   cd desktop && npm run package
   ```

   Then **open the packaged app and confirm `window.trajectory` is defined**.
   Packaging is necessary but not sufficient — `electron-builder --dir` builds
   without ever launching the app, so a clean package says nothing about the
   bridge (`[HC-PRELOAD-CJS]`). Typecheck, tests, and build all pass while
   `window.trajectory` is `undefined`. Say so when you skip this.

4. Report the command, exit status, and relevant output verbatim. Do not
   compress a stack trace into a sentence.

## Rules

- **Do not fix what you find.** Report it and hand back. Verification that
  repairs its own findings is not an independent signal.
- **Do not interpret a failure into a pass.** A test that looks flaky is a
  reported failure.
- Python is `.venv` (3.12). The system Python is 3.9 and fails confusingly —
  check which one ran before reporting a Python failure as real.
- The script skips desktop checks when `desktop/node_modules` is missing, and
  exits non-zero when it does. A partial run is not a pass.
