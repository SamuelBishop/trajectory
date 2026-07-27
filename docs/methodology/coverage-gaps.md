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
| `[HC-PRIVATE-INPUT-STDIN]` | Partial | `tests/test_cli.py::test_chat_cli_accepts_private_history_on_stdin` | Proves the CLI *accepts* stdin. Nothing fails if the desktop sidecar starts passing a payload through argv instead. |
| `[HC-SECRETS-ENV-ONLY]` | Partial | `tests/test_cli.py::test_cli_openai_never_prints_fake_secret`, `tests/test_providers.py::test_openai_environment_requires_credentials` | Covers one known key shape on one path. A secret printed from a new code path is not caught. |
| `[HC-NO-EXFILTRATION]` | Not verified | — | No dependency policy and no network assertion. A new outbound call anywhere would pass the suite. |
| `[HC-NO-PRIVATE-DATA-COMMITS]` | Partial | `.gitignore` | Only covers paths already listed. A new private directory, or a secret pasted into a tracked file, is caught by review alone. |
| `[HC-EXPLICIT-CONFIG-PATHS]` | Automated | `tests/test_cli.py::test_default_directory_finds_editable_checkout_outside_repository`, `::test_cli_reports_missing_configuration` | — |
| `[HC-NO-PROVIDER-FALLBACK]` | Automated | `tests/test_providers.py::test_openai_provider_does_not_fallback` | — |
| `[HC-PROVIDER-PARITY]` | Partial | `::test_openai_provider_supports_chat`, `::test_copilot_provider_supports_chat` | Per-provider tests, not a parity check. A newly added provider with no chat support fails nothing. |
| `[HC-STRICT-SCHEMA-REQUIRED]` | Partial | `::test_openai_provider_validates_and_retries` | Covers validation and retry behavior, not the emitted schema. Nothing asserts that every property appears in `required` — which is the exact defect that motivated the rule. |
| `[HC-SDK-BOUNDARY]` | Partial | `::test_copilot_provider_uses_sdk_boundary`, `::test_openai_provider_wraps_sdk_errors`, `::test_copilot_provider_wraps_sdk_errors` | Cleanup and error wrapping are covered. Import discipline is not — nothing fails if a module outside `providers/` imports a vendor SDK. |
| `[HC-CITATIONS-RESOLVE]` | Automated | `tests/test_validation.py::test_rejects_unknown_recommendation_citation`, `::test_accepts_resolved_attribution` | — |
| `[HC-BIDIRECTIONAL-ATTRIBUTION]` | Automated | `::test_rejects_principle_without_cited_support`, `::test_rejects_source_without_cited_principle_link`, `::test_accepts_independently_sourced_principles` | — |
| `[HC-OBSERVATION-VS-INFERENCE]` | Automated | `::test_preserves_observation_and_inference_fields` | Field separation is enforced; whether the model actually put the right content in each field is not. |
| `[HC-MENTOR-IDENTITY-INTEGRITY]` | Partial | `tests/test_config.py::test_rejects_unapproved_source`, `::test_rejects_unknown_principle_source` | Source approval is enforced at load. The living-voice and implied-endorsement clauses are pure judgment. |
| `[HC-REFUSE-UNGROUNDED]` | Automated | `tests/test_selection.py::test_fails_when_no_goal_matches`, `tests/test_providers.py::test_deterministic_provider_rejects_non_demo_question`, `::test_deterministic_provider_does_not_treat_proposal_as_pr` | Only the deterministic provider refuses on demand. A hosted model answering thinly from general knowledge is not detectable here. |
| `[SC-UNCERTAINTY-DECLARED]` | Partial | `tests/test_prompting.py::test_rejects_out_of_range_confidence` | Range is validated. An empty uncertainty list still passes. |
| `[HC-RENDERER-LEAST-PRIVILEGE]` | Not verified | — | No test asserts `webPreferences`. Flipping `sandbox` or `contextIsolation` breaks nothing in the suite. |
| `[HC-PRELOAD-CJS]` | Not verified | — | **Highest-risk gap.** This defect is invisible in dev mode and only appears in a packaged build, where `window.trajectory` is silently `undefined`. Nothing in `typecheck`, `test`, or `build` catches it — and neither does `npm run package`, which builds but never launches the app. Only opening the packaged app and checking the bridge detects it. |
| `[HC-VALIDATE-IPC-INPUT]` | Not verified | — | No IPC handler tests exist. |
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

Of 31 bars: 6 automated, 10 partial, 15 not verified.

The shape of that is expected rather than alarming. The verified end is the
Python engine's grounding and attribution logic — the part that is pure
functions over data, and the part where a wrong answer is the product failing at
its main claim. The unverified end is Electron packaging behavior and process
discipline, which need either a packaged app or a human.

Two gaps are worth closing first if this ever grows:

1. `[HC-PRELOAD-CJS]` — a packaged smoke test that launches the app and asserts
   the preload bridge is present. This bug already shipped once and was
   invisible until the app was packaged *and opened*; packaging alone would not
   have caught it either.
2. `[HC-STRICT-SCHEMA-REQUIRED]` — a test asserting the generated schema lists
   every property in `required`. Also already shipped once.

Both are cheap, and both are rules that exist specifically because the failure
already happened.

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
