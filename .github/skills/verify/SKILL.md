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

   It is fail-fast: desktop typecheck, tests, then build.

2. If the diff is narrow, a subset is acceptable — but name which stages ran and
   why they cover the change. A partial run reported as a full one is the
   failure this exists to prevent (`[HC-VERIFY-BEFORE-DONE]`).

3. **Prototype mode:** the packaged smoke test is on demand, not per-change.
   Run it before you actually use the app, and when the change touched
   `desktop/electron.vite.config.ts`, `desktop/src/preload/**`, window creation,
   packaging configuration, or a provider's runtime resolution:

   ```bash
   cd desktop && npm run package && npm run smoke
   ```

   If you skip it, say so — do not imply the app was verified as packaged.
   Packaging alone is necessary but not sufficient — `electron-builder --dir`
   builds without ever launching the app, so a clean package says nothing about
   the preload bridge (`[HC-PRELOAD-CJS]`) or whether a bundled SDK can run
   (`[HC-PACKAGED-RUNTIME]`). Typecheck, tests, and build all pass while
   `window.trajectory` is `undefined`. `npm run smoke` launches the packaged app
   outside the repository and checks both. Say so when you skip this. The
   Copilot provider needs a signed-in account and is not covered.

4. Report the command, exit status, and relevant output verbatim. Do not
   compress a stack trace into a sentence.

## Rules

- **Do not fix what you find.** Report it and hand back. Verification that
  repairs its own findings is not an independent signal.
- **Do not interpret a failure into a pass.** A test that looks flaky is a
  reported failure.
- Everything is TypeScript and runs from `desktop/`. If `desktop/node_modules`
  is missing the chain refuses to run; report that rather than installing it.
- The script skips desktop checks when `desktop/node_modules` is missing, and
  exits non-zero when it does. A partial run is not a pass.
