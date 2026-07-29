# Coverage gaps

Which bars in `CONSTITUTION.md` are actually caught by something, and which are
held up by nothing but attention.

This repository has no CI and no hooks, so "Automated" here means *a test in the
suite fails when the bar is crossed* — and only when someone runs the suite.
Nothing runs on its own.

The point of this file is to stop the constitution from feeling safer than it
is. A rule with no check is still a rule, but it is a promise rather than a
guarantee, and it should be treated that way when reviewing.

**Amendment rule**: before implementing in an area whose bar is marked
*Not verified*, say so in the plan. Either add the missing check as part of the
work, or state plainly that the change rests on review alone.

## Legend

- **Automated** — a named test fails if the bar is crossed.
- **Partial** — a test covers part of the bar; the rest is judgment.
- **Not verified** — nothing catches a violation. Review is the only defense.

## Registry

| Slug | Status | What actually checks it | What is left uncovered |
| --- | --- | --- | --- |
| `[HC-NO-PLAINTEXT-HISTORY]` | Partial | `desktop/tests/store.test.ts` (2 cases) | Tests inject a fake `safeStorage`. Real OS keychain behavior, and the Linux `basic_text` backend check, are exercised only by hand. |
| `[HC-PRIVATE-INPUT-STDIN]` | Partial | `desktop/tests/engine/providers.test.ts` — "disables tools, denies permissions, and cleans up the session" | The engine now runs in-process, so the only surviving boundary is the Copilot SDK's own stdio transport. The test proves the prompt goes through `sendAndWait`; nothing fails if future code spawns a process with a payload in argv. |
| `[HC-SECRETS-ENV-ONLY]` | Partial | `desktop/tests/secrets.test.ts` (11 cases), including "never writes the credential in a readable form", "refuses to store anything when encryption is unavailable", and "exposes no channel that returns a credential"; `desktop/scripts/smoke-packaged.mjs` — "a credential can be stored and removed but never read back", "the credential was never written in the clear"; `desktop/tests/engine/providers.test.ts` — "requires credentials from the environment" | The in-app credential path added by the Settings editor is covered end to end, including the refusal when encryption is unavailable and the absence of a getter on the bridge. A secret printed from a new code path is still not caught. |
| `[HC-NO-EXFILTRATION]` | Partial | `desktop/tests/engine/providers.test.ts` — "gives the runtime no ambient context to read" | The Copilot SDK's ambient-file defaults are now pinned. Nothing else is: no dependency policy and no network assertion, so a new outbound call anywhere would pass the suite. The `integrations/` exemption widens this gap rather than narrowing it — nothing checks that an adapter uses read-only methods, that its requests carry no user content, or that the hosts it contacts match the ones it declares. Closing it needs an import-discipline test over network clients plus a per-adapter allowlist assertion. Until then the ingress-only bar rests on review alone. |
| `[HC-NO-PRIVATE-DATA-COMMITS]` | Partial | `.gitignore` | Only covers paths already listed. A new private directory, or a secret pasted into a tracked file, is caught by review alone. |
| `[HC-EXPLICIT-CONFIG-PATHS]` | Automated | `desktop/tests/engine/paths.test.ts` (5 cases), `desktop/tests/engine/config.test.ts` — "reports a missing configuration file by path" | — |
| `[HC-NO-PROVIDER-FALLBACK]` | Automated | `desktop/tests/engine/providers.test.ts` — "does not fall back after a second invalid response" | — |
| `[HC-PROVIDER-PARITY]` | Partial | `desktop/tests/engine/providers.test.ts` — "requests a strict schema in which every property is required", "supports chat" | The `MentorProvider` interface now makes a missing method a compile error, which is stronger than before. Behavioural parity — that both providers actually answer equivalently — is still per-provider tests rather than a parity check. |
| `[HC-STRICT-SCHEMA-REQUIRED]` | Automated | `desktop/tests/engine/domain.test.ts` — "lists every recommendation property in required", "lists every chat response property in required"; `desktop/tests/engine/providers.test.ts` — "requests a strict schema in which every property is required" | Gap closed during the TypeScript migration. The emitted schema is now asserted both in isolation and as sent to the API. |
| `[HC-SDK-BOUNDARY]` | Partial | `desktop/tests/engine/providers.test.ts` — "disables tools, denies permissions, and cleans up the session", "rejects permission requests rather than declining to answer them", "wraps SDK errors without leaking the underlying message", "wraps SDK errors" | Cleanup, denial semantics, and error wrapping are covered. Import discipline is not — nothing fails if a module outside `providers/` imports a vendor SDK. |
| `[HC-PACKAGED-RUNTIME]` | Partial | `desktop/tests/engine/providers.test.ts` — "spawns the native runtime binary when hosted by Electron", "spawns the unpacked binary rather than one inside the asar", "refuses rather than hanging when the runtime is missing"; `desktop/scripts/smoke-packaged.mjs` — "the OpenAI SDK ships inside the build" | Runtime resolution is unit-tested and the OpenAI SDK is exercised in a real packaged launch. The Copilot runtime needs a signed-in GitHub account, so its packaged path is a manual check. |
| `[HC-CITATIONS-RESOLVE]` | Automated | `desktop/tests/engine/validation.test.ts` — "rejects an unknown citation", "accepts resolved attribution" | — |
| `[HC-BIDIRECTIONAL-ATTRIBUTION]` | Automated | `desktop/tests/engine/validation.test.ts` — "rejects a principle with no cited support", "rejects a source not linked to a cited principle", "accepts independently sourced principles" | — |
| `[HC-OBSERVATION-VS-INFERENCE]` | Automated | `desktop/tests/engine/validation.test.ts` — "preserves observation and inference fields" | Field separation is enforced; whether the model actually put the right content in each field is not. |
| `[HC-MENTOR-IDENTITY-INTEGRITY]` | Partial | `desktop/tests/engine/config.test.ts` — "rejects an unapproved source", "rejects an unknown principle source", "rejects a non-synthetic source on a fictional profile", plus voice structure and internal pattern-reference validation; `desktop/tests/engine/mentors.test.ts` — "rewrites the mentor id on every record so the copy loads", "reports a broken profile instead of hiding it" | Source approval is enforced for principles, and a duplicated profile cannot inherit another mentor's attribution. Voice provenance, fidelity, non-verbatim synthesis, disclosure quality, and implied endorsement remain judgment. |
| `[HC-REFUSE-UNGROUNDED]` | Automated | `desktop/tests/engine/selection.test.ts` — "fails when no goal matches", "fails when no principle matches the selected goals"; `desktop/tests/engine/providers.test.ts` — "rejects a question outside the committed demo", "does not treat a design proposal as a pull request" | Only the deterministic provider refuses on demand. A hosted model answering thinly from general knowledge is not detectable here. |
| `[SC-UNCERTAINTY-DECLARED]` | Automated | `desktop/tests/engine/prompting.test.ts` — "rejects out-of-range confidence", "rejects a response with no uncertainty" | Zod's `.min(1)` on `uncertainties` is now asserted, so an empty list no longer passes. |
| `[HC-RENDERER-LEAST-PRIVILEGE]` | Partial | `desktop/scripts/smoke-packaged.mjs` — "the renderer has no Node access" | The observable effect is now asserted in a launched packaged app: `require`, `process`, and `module` must all be undefined. The `webPreferences` flags themselves are still unasserted, and the smoke test only runs when someone runs it. |
| `[HC-PRELOAD-CJS]` | Automated | `desktop/scripts/smoke-packaged.mjs` — "the preload bridge is exposed" | Gap closed. The smoke test copies the packaged app outside the repository, launches it, and reads `window.trajectory` from the real renderer. It is not part of `scripts/verify.sh` because it needs `npm run package` first, so it still depends on someone running it. |
| `[HC-VALIDATE-IPC-INPUT]` | Partial | `desktop/scripts/smoke-packaged.mjs` — "an invalid profile edit is refused", "a traversing mentor ID is refused"; `desktop/tests/engine/mentors.test.ts` (13 cases on the ID guard and its containment check); `desktop/tests/engine/documents.test.ts` — "accepts the five user files and rejects anything else", "accepts the three mentor files and rejects anything else" | The arguments that became file paths are now exercised through the real bridge in a packaged launch. `requireId` and `requireMessage` on the chat channels are still unexercised, and the smoke test only runs when someone runs it. |
| `[HC-NO-RENDERER-URL-FROM-ENV]` | Not verified | — | Requires a packaged build with the environment variable set. Not covered. |
| `[HC-ATOMIC-SERIALIZED-WRITES]` | Partial | `desktop/tests/store.test.ts` — "serializes concurrent mutations without losing conversations" | Serialization is covered. Atomicity — temp file, `fsync`, `rename` — is not directly asserted; a regression to a plain in-place write would pass. |
| `[HC-EVIDENCE]` | Not verified | — | Adversarial review only. This is structural: nothing mechanical can distinguish captured output from convincing prose. |
| `[HC-VERIFY-BEFORE-DONE]` | Not verified | — | `scripts/verify.sh` exists but is invoked on request. Nothing forces it to run. |
| `[HC-TEST-WITH-BEHAVIOR]` | Not verified | — | No coverage threshold and no diff-versus-tests check. |
| `[HC-NARROW-DIFF]` | Not verified | — | Review only. |
| `[HC-CITE-SLUG-VERBATIM]` | Not verified | — | No checker greps claimed slugs against `CONSTITUTION.md`. Doing it by hand is cheap: every cited slug should appear in that file. |
| `[SC-NO-PLACEHOLDERS]` | Not verified | — | Review only. |
| `[HC-CANON-PRECEDENCE]` | Not verified | — | Review only. |
| `[HC-ROUTE-DONT-ROOT]` | Not verified | — | `AGENTS.md` has a stated line budget but nothing enforces it. Check the line count when editing it. |
| `[HC-REAL-MISTAKES-ONLY]` | Not verified | — | Review of the justification attached to a proposed rule. |
| `[HC-PROPOSE-NEVER-COMMIT]` | Not verified | — | `/cap` can push to `main` unconditionally by design. |

## Summary

Of 32 bars: 9 automated, 12 partial, 11 not verified.

The shape of that is expected rather than alarming. The verified end is the
engine's grounding and attribution logic — the part that is pure functions over
data, and the part where a wrong answer is the product failing at its main
claim. The unverified end is Electron packaging behavior and process discipline,
which need either a packaged app or a human.

The TypeScript migration closed `[HC-STRICT-SCHEMA-REQUIRED]` and
`[SC-UNCERTAINTY-DECLARED]`: both are now asserted directly rather than implied
by a retry test. It also closed `[HC-PRELOAD-CJS]` and moved
`[HC-RENDERER-LEAST-PRIVILEGE]` off zero, by adding
`desktop/scripts/smoke-packaged.mjs` — a smoke test that copies the packaged app
outside the repository, launches it, and drives the real preload bridge. That
script was written because the Copilot runtime failed three different ways in
the packaged app while every other check stayed green, which is also why
`[HC-PACKAGED-RUNTIME]` now exists.

In-app configuration editing moved `[HC-VALIDATE-IPC-INPUT]` off *Not verified*.
That bar had been the largest standing gap in the registry, and the feature
that closed it is also the one that would have exploited it: a mentor ID now
crosses the boundary and becomes a directory name. The guard is a pattern check
plus a resolved-prefix containment check, tested in both the suite and a
packaged launch. The same work extended `[HC-SECRETS-ENV-ONLY]`, whose bar was
amended to permit an encrypted in-app credential, and `[HC-MENTOR-IDENTITY-INTEGRITY]`,
which now covers profile duplication rewriting attribution rather than
inheriting it.

The gap worth closing next is `[HC-SDK-BOUNDARY]`'s import discipline — nothing
fails if a module outside `providers/` imports a vendor SDK, and that is the
boundary the whole provider contract rests on.

## Infrastructure assumptions

These are not constitution bars, but the stack quietly depends on them.

**Agent model pinning fails open.** `.github/agents/*.agent.md` honors a valid
`model:` value and *silently ignores an invalid one*, falling back to the
default model with no warning. Verified by probing a deliberately bogus
identifier: the run succeeded normally.

This matters for `review`, which is pinned to a different model vendor from
`implement` on purpose — single-vendor self-review biases toward declaring work
complete. If that identifier is ever deprecated, the adversarial property
disappears silently and review keeps looking like it works.

Current pinning, confirmed by distinct credit costs per run rather than by
trusting the config:

| Agent | `model:` | Observed cost |
| --- | --- | --- |
| `plan` | `claude-opus-4.6` | 4.71 |
| `implement` | `claude-opus-4.6` | — |
| `verify` | `gpt-5.4-mini` | 0.72 |
| `review` | `gpt-5.5` | 4.98 |
| *(bogus identifier)* | `not-a-real-model-xyz` | 2.5 — fell back |

Three distinct tiers means the values are being honored today. If every agent
starts costing the same, the pinning has silently broken.

**Agent discovery** is verifiable cheaply and does fail loudly:

```bash
copilot --agent __nonexistent -p x
# No such agent: __nonexistent, available: implement, plan, review, verify
```
