# AGENTS.md

Router only. This file holds no rules — it points at the ones that govern.
Keep it under 60 lines (`[HC-ROUTE-DONT-ROOT]`).

> **Prototype mode.** Adversarial review and the packaged smoke test are on
> demand; BEFORE evidence is only required for bug fixes. `./scripts/verify.sh`
> (2.7s) is still mandatory. See section 0 of the constitution.

## Read in this order

1. **`docs/methodology/CONSTITUTION.md`** — the canon. 33 `[HC-*]` / `[SC-*]`
   bars and the 6-step loop. It supersedes everything (`[HC-CANON-PRECEDENCE]`).
2. **`docs/methodology/coverage-gaps.md`** — which bars nothing actually checks.
   Read before implementing in an area marked *Not verified*.
3. The path rules below, for the files you are touching.

## Path rules — load on match

| Touching | Read |
| --- | --- |
| `desktop/src/engine/providers/**` | `.github/instructions/providers.instructions.md` |
| `desktop/src/engine/integrations/**` | `.github/instructions/integrations.instructions.md` |
| `desktop/src/engine/**`, `desktop/tests/engine/**` | `.github/instructions/engine.instructions.md` |
| `desktop/src/main/**`, `desktop/src/preload/**`, `desktop/electron.vite.config.ts` | `.github/instructions/desktop-main.instructions.md` |
| `desktop/src/renderer/**` | `.github/instructions/desktop-renderer.instructions.md` |
| `docs/**`, `README.md`, `resources/mentors/**`, `examples/**`, `*.md` | `.github/instructions/docs-and-mentors.instructions.md` |

## Commands

```bash
./scripts/verify.sh            # whole chain, fail-fast (~20s, no packaging)
cd desktop && npm test         # tests only
cd desktop && npm run package  # build the app (does not launch it)
cd desktop && npm run smoke    # launch the packaged app and drive the real bridge
```

Everything is TypeScript and runs from `desktop/`. There is no Python and no
sidecar; the mentorship engine runs in the Electron main process.

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
- Commit or push unless the author ran `/cap` — `[HC-LAND-ON-REQUEST]`. Inside
  `/cap`, pushing straight to `main` is sanctioned; verification protects it.
