# AGENTS.md

Router only. This file holds no rules — it points at the ones that govern.
Keep it under 60 lines (`[HC-ROUTE-DONT-ROOT]`).

## Read in this order

1. **`docs/methodology/CONSTITUTION.md`** — the canon. 31 `[HC-*]` / `[SC-*]`
   bars and the 6-step loop. It supersedes this file and every other
   (`[HC-CANON-PRECEDENCE]`).
2. **`docs/methodology/coverage-gaps.md`** — which bars nothing actually checks.
   Read before implementing in an area marked *Not verified*.
3. The path rules below, for the files you are touching.

## Path rules — load on match

| Touching | Read |
| --- | --- |
| `src/trajectory/providers/**` | `.github/instructions/providers.instructions.md` |
| `src/trajectory/**`, `tests/**` | `.github/instructions/python-engine.instructions.md` |
| `desktop/src/main/**`, `desktop/src/preload/**`, `desktop/electron.vite.config.ts` | `.github/instructions/desktop-main.instructions.md` |
| `desktop/src/renderer/**` | `.github/instructions/desktop-renderer.instructions.md` |
| `docs/**`, `README.md`, `resources/mentors/**` | `.github/instructions/docs-and-mentors.instructions.md` |

## Commands

```bash
./scripts/verify.sh          # whole chain, fail-fast (~30s, no packaging)
.venv/bin/python -m pytest   # Python tests only
cd desktop && npm test       # desktop tests only
cd desktop && npm run package  # build only — must also open the app to test the bridge
```

Python lives in `.venv` (3.12). The system Python is 3.9 and will not work.

## Agents

`plan` (cannot edit) → `implement` → `verify` (cannot fix) → `review` (cannot
write, different model vendor). Skills: `/verify`, `/reflect`, `/cap`.

## Must not

- Commit real user config, journals, or credentials — `[HC-NO-PRIVATE-DATA-COMMITS]`
- Print a secret, even redacted — `[HC-SECRETS-ENV-ONLY]`
- Fall back to a different provider on failure — `[HC-NO-PROVIDER-FALLBACK]`
- Fall back to plaintext when encryption is unavailable — `[HC-NO-PLAINTEXT-HISTORY]`
- Pass private payloads through argv — `[HC-PRIVATE-INPUT-STDIN]`
- Report work done without showing command output — `[HC-VERIFY-BEFORE-DONE]`
- Claim evidence that was not captured — `[HC-EVIDENCE]`
- Paraphrase a rule slug — `[HC-CITE-SLUG-VERBATIM]`
- Edit `CONSTITUTION.md` without a human approving — `[HC-PROPOSE-NEVER-COMMIT]`
- Widen the diff beyond the task — `[HC-NARROW-DIFF]`

`/cap` pushing straight to `main` is sanctioned here. Verification is what
protects that branch, not a gate.
