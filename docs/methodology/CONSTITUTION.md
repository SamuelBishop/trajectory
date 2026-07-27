# Trajectory constitution

This is the single source of truth for how agents work in this repository.

`AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/*`, and
`.github/agents/*` are routers. They point at the rules below and never restate
them. When any of them disagrees with this document, this document wins
(`[HC-CANON-PRECEDENCE]`).

## How to read a rule

Each rule has three parts:

- **Bar** — the normative one-liner. This is the thing you must not cross.
- **Pattern** — how the bar is satisfied in this codebase.
- **Verification** — the concrete signal that proves it. Where the verification
  is "manual", the bar is real but nothing catches a violation automatically;
  `coverage-gaps.md` tracks every one of those.

`[HC-*]` rules are hard constraints. Crossing one is a defect, not a tradeoff.
`[SC-*]` rules are strong defaults that may be broken with a stated reason.

Slugs are stable identifiers. Cite them verbatim (`[HC-CITE-SLUG-VERBATIM]`).

This repository has no CI and no hooks. Every bar below is enforced by agent
refusal contracts, by the tests named in the verification lines, and by review.
That is a deliberate choice for a solo project, and it means honesty about
evidence is the only thing holding the system up.

There are 31 rules.

---

## 1. Privacy and data handling

Trajectory reads someone's goals, values, and journal. Every rule in this
section exists because that data must not leak.

### `[HC-NO-PLAINTEXT-HISTORY]`

- **Bar**: Conversation history is never written to disk unencrypted, and the
  app fails loudly rather than falling back to plaintext.
- **Pattern**: Persist through Electron `safeStorage`. Treat encryption as
  unavailable when `isEncryptionAvailable()` is false *and* when the selected
  Linux backend is `basic_text`, which is obfuscation rather than encryption.
  Surface the failure to the user; never degrade silently.
- **Verification**: `desktop/tests/store.test.ts` —
  "persists encrypted conversations without plaintext content" and
  "refuses to persist when OS encryption is unavailable".

### `[HC-PRIVATE-INPUT-STDIN]`

- **Bar**: Private message and history payloads cross a process boundary on
  stdin, never in command-line arguments.
- **Pattern**: The desktop sidecar invokes the CLI in stdin JSON mode. Argv is
  world-readable to any local process listing; stdin is not.
- **Verification**: `tests/test_cli.py::test_chat_cli_accepts_private_history_on_stdin`.

### `[HC-SECRETS-ENV-ONLY]`

- **Bar**: Credentials are read only from the environment or the host's own
  auth, and never appear in output, logs, error messages, or committed files.
- **Pattern**: Read API keys from environment variables. Let the Copilot SDK
  use existing local GitHub authentication. When a credential is missing, name
  the variable, never the value. Do not echo a key back even when redacting.
- **Verification**: `tests/test_cli.py::test_cli_openai_never_prints_fake_secret`,
  `tests/test_providers.py::test_openai_environment_requires_credentials`.

### `[HC-NO-EXFILTRATION]`

- **Bar**: User data leaves the machine only via the model provider the user
  explicitly configured. No telemetry, analytics, crash reporting, or update
  pings.
- **Pattern**: The only outbound network calls live in `src/trajectory/providers/`.
  The desktop app makes no network calls of its own. Adding an outbound call
  anywhere else is a constitution change, not an implementation detail.
- **Verification**: Manual review of new network calls and dependencies.

### `[HC-NO-PRIVATE-DATA-COMMITS]`

- **Bar**: Real user configuration, journals, and credentials are never
  committed. Shipped examples are synthetic and visibly labeled as such.
- **Pattern**: `.trajectory/`, `data/`, and `.env` stay in `.gitignore`.
  Documentation and tests use invented data only.
- **Verification**: `.gitignore`; manual review of every staged file.

### `[HC-EXPLICIT-CONFIG-PATHS]`

- **Bar**: Configuration is read only from an explicitly passed directory or a
  small, declared set of resolution candidates. Never search the filesystem for
  a user's data.
- **Pattern**: `--user-dir` and `--mentor-dir` win when given. Otherwise resolve
  a bounded candidate list (working directory, then the packaged/editable
  install root). Fail with the paths tried rather than widening the search.
- **Verification**: `tests/test_cli.py::test_default_directory_finds_editable_checkout_outside_repository`,
  `tests/test_cli.py::test_cli_reports_missing_configuration`.

---

## 2. Provider contract

### `[HC-NO-PROVIDER-FALLBACK]`

- **Bar**: A failing provider raises. It never silently downgrades to another
  provider or to canned output.
- **Pattern**: The user chose a provider deliberately; substituting a different
  one changes the meaning of the answer without telling them. Surface the error
  with the remedy.
- **Verification**: `tests/test_providers.py::test_openai_provider_does_not_fallback`.

### `[HC-PROVIDER-PARITY]`

- **Bar**: Every provider implements the whole protocol — decision review *and*
  chat — and returns the same validated types.
- **Pattern**: New capabilities are added to the protocol and to all providers
  in the same change, or the gap is declared. A provider that supports half the
  surface makes the provider selector a trap.
- **Verification**: `tests/test_providers.py::test_openai_provider_supports_chat`,
  `tests/test_providers.py::test_copilot_provider_supports_chat`.

### `[HC-STRICT-SCHEMA-REQUIRED]`

- **Bar**: Under strict structured output, every property in the schema must be
  listed in `required`, including properties that have defaults.
- **Pattern**: Pydantic omits fields with `default_factory` from `required`, and
  OpenAI's strict mode rejects the resulting schema. Declare such fields
  required and let validation, not the schema, express optionality.
- **Verification**: `tests/test_providers.py::test_openai_provider_validates_and_retries`.
  This rule exists because that exact schema was rejected at runtime.

### `[HC-SDK-BOUNDARY]`

- **Bar**: Third-party SDK usage stays inside its provider module, runs with the
  least authority the SDK offers, cleans up in `finally`, and wraps SDK
  exceptions in this project's error type.
- **Pattern**: Disable tools, deny permissions, delete the session in a
  guaranteed-cleanup block. No module under `src/trajectory/` outside
  `providers/` imports an SDK, so application code never handles a vendor
  exception type. Tests may import a vendor exception to assert it gets wrapped.
- **Verification**: `tests/test_providers.py::test_copilot_provider_uses_sdk_boundary`,
  `::test_openai_provider_wraps_sdk_errors`, `::test_copilot_provider_wraps_sdk_errors`.

---

## 3. Grounding and attribution

The product's entire claim is that its advice is traceable. These rules are the
claim.

### `[HC-CITATIONS-RESOLVE]`

- **Bar**: Every identifier cited in a response resolves to a record that was
  actually loaded.
- **Pattern**: Validate citations against the loaded configuration after
  generation. An unresolvable ID is a hallucination, so reject the response
  rather than rendering it.
- **Verification**: `tests/test_validation.py::test_rejects_unknown_recommendation_citation`,
  `::test_accepts_resolved_attribution`.

### `[HC-BIDIRECTIONAL-ATTRIBUTION]`

- **Bar**: Principles and sources must link in both directions. A cited
  principle needs a cited source, and a cited source needs a principle that
  links to it.
- **Pattern**: One-directional checks let a model cite an impressive-looking
  source that nothing actually rests on. Check both edges.
- **Verification**: `tests/test_validation.py::test_rejects_principle_without_cited_support`,
  `::test_rejects_source_without_cited_principle_link`,
  `::test_accepts_independently_sourced_principles`.

### `[HC-OBSERVATION-VS-INFERENCE]`

- **Bar**: What the system read and what the system concluded stay in separate
  fields and are never merged into one narrative.
- **Pattern**: Observations quote or reference the user's own configuration.
  Inferences are the model's reasoning about them. The user must be able to
  disagree with the second without doubting the first.
- **Verification**: `tests/test_validation.py::test_preserves_observation_and_inference_fields`.

### `[HC-MENTOR-IDENTITY-INTEGRITY]`

- **Bar**: Mentor sources must be real and pre-approved, demo mentors must be
  visibly fictional, and no output may imitate a living person's voice or imply
  their endorsement.
- **Pattern**: Configuration loading rejects principles pointing at unapproved
  or unknown sources. Shipped mentor content is synthetic and labeled. Writing
  in a named living person's style is a refusal, even when asked directly —
  unless the person supplies the text themselves, in which case use it verbatim
  and attribute it.
- **Verification**: `tests/test_config.py::test_rejects_unapproved_source`,
  `::test_rejects_unknown_principle_source`. The voice and endorsement clauses
  are manual.

### `[HC-REFUSE-UNGROUNDED]`

- **Bar**: When nothing relevant is grounded, refuse. Do not answer from general
  knowledge and present it as mentorship.
- **Pattern**: Selection fails loudly when no goal matches. The deterministic
  provider refuses questions outside its demo scenario instead of reusing
  scenario advice out of context.
- **Verification**: `tests/test_selection.py::test_fails_when_no_goal_matches`,
  `tests/test_providers.py::test_deterministic_provider_rejects_non_demo_question`,
  `::test_deterministic_provider_does_not_treat_proposal_as_pr`.

### `[SC-UNCERTAINTY-DECLARED]`

- **Bar**: Responses carry a calibrated confidence and name what they are
  uncertain about.
- **Pattern**: Confidence is range-validated. An empty uncertainty list on a
  consequential decision is a smell, not a strength.
- **Verification**: `tests/test_prompting.py::test_rejects_out_of_range_confidence`.

---

## 4. Desktop security

Five of the six real defects found in the desktop build were in this area. These
rules are transcribed from those failures.

### `[HC-RENDERER-LEAST-PRIVILEGE]`

- **Bar**: The renderer runs with `contextIsolation: true`, `sandbox: true`, and
  `nodeIntegration: false`, and reaches the system only through named preload
  operations. It never chooses executable paths, working directories, or
  filesystem locations.
- **Pattern**: The preload exposes a fixed verb list. The main process decides
  *where* things run; the renderer only asks *what* to do.
- **Verification**: `desktop/src/main/index.ts` window options and
  `desktop/src/preload/index.ts` surface; manual review.

### `[HC-PRELOAD-CJS]`

- **Bar**: A sandboxed preload script must be built as CommonJS, and the main
  process must reference the filename that is actually emitted.
- **Pattern**: `electron.vite.config.ts` forces `format: "cjs"` and
  `entryFileNames: "[name].cjs"` for the preload bundle, and main loads
  `index.cjs`. Without this the bundler emits `.mjs`, the sandboxed preload
  silently fails to load, and `window.trajectory` is `undefined` in the packaged
  app while dev mode looks fine.
- **Verification**: `desktop/electron.vite.config.ts`; manual packaged smoke
  test — package the app, launch it, and confirm `window.trajectory` is defined.
  Packaging alone is not enough: `electron-builder --dir` never runs the app, so
  a successful package still reports nothing about the bridge.

### `[HC-VALIDATE-IPC-INPUT]`

- **Bar**: Every IPC payload is validated in the main process before use.
  Renderer input is untrusted input.
- **Pattern**: Check types, shapes, and identifiers at the handler boundary and
  reject rather than coerce. Renderer-side validation is a convenience, never a
  control.
- **Verification**: `desktop/src/main/ipc.ts`; manual review.

### `[HC-NO-RENDERER-URL-FROM-ENV]`

- **Bar**: An environment-supplied renderer URL is honored only when the app is
  not packaged, and only for local HTTP.
- **Pattern**: Gate on `!app.isPackaged` and check the parsed origin. Otherwise
  anyone able to set an environment variable can point a packaged, privileged
  window with a preload bridge at a remote page.
- **Verification**: `desktop/src/main/index.ts`; manual review.

### `[HC-ATOMIC-SERIALIZED-WRITES]`

- **Bar**: Store writes are atomic, and concurrent mutations are serialized.
- **Pattern**: Write to a temp file, `fsync`, then `rename`. Chain mutations
  through a single promise queue so two concurrent creates cannot read the same
  state and clobber each other.
- **Verification**: `desktop/tests/store.test.ts` —
  "serializes concurrent mutations without losing conversations".

---

## 5. Engineering process

### The loop

1. **Read** the canon and the path-scoped rules for the files being touched.
2. **Specify** intent, scope boundary, affected paths, and applicable slugs.
3. **Signal** — define the observable proof: a failing test or a reproduction
   command.
4. **BEFORE evidence** — run it and capture the output. This step cannot be
   repaired after the fact.
5. **Implement** narrowly.
6. **AFTER evidence** — rerun, run the verification chain, get an adversarial
   review, and report citing slugs.

### `[HC-EVIDENCE]`

- **Bar**: Before/after evidence is real captured output. "I verified this
  manually" without output is not evidence, and neither is a description of what
  the output would have said.
- **Pattern**: If step 4 was skipped, say so plainly instead of reconstructing
  it. A missing baseline is recoverable; a fabricated one is not.
- **Verification**: Adversarial review. This is the bar the `review` agent
  assumes is being violated until output proves otherwise.

### `[HC-VERIFY-BEFORE-DONE]`

- **Bar**: Nothing is reported as done until the relevant verification has run
  and its output has been shown.
- **Pattern**: `scripts/verify.sh` runs the whole chain fail-fast. Running a
  targeted subset is fine when the diff is narrow; saying which subset ran, and
  why it covers the change, is not optional.
- **Verification**: The command output in the report.

### `[HC-TEST-WITH-BEHAVIOR]`

- **Bar**: A behavior change ships with a test, or the missing coverage is
  declared explicitly in the report.
- **Pattern**: Prefer the smallest test that would have failed before the
  change. When a change genuinely cannot be tested here — packaged Electron
  behavior, for instance — record it in `coverage-gaps.md` rather than letting
  it pass silently.
- **Verification**: Review of the diff against the test files it touches.

### `[HC-NARROW-DIFF]`

- **Bar**: The diff contains the change and nothing else. No drive-by
  refactoring, reformatting, dependency bumps, or unrelated fixes.
- **Pattern**: Bugs discovered adjacent to the work get reported, not silently
  swept in — unless they are caused by the change itself.
- **Verification**: `git diff --stat`; review.

### `[HC-CITE-SLUG-VERBATIM]`

- **Bar**: When an agent claims a rule is satisfied, it cites the slug exactly
  as written here.
- **Pattern**: `[HC-PRELOAD-CJS]`, not "the preload rule". A paraphrased slug
  usually means the rule was recalled rather than read, which is exactly when
  the claim is least trustworthy.
- **Verification**: Review. A slug that does not appear in this file is a failed
  claim.

### `[SC-NO-PLACEHOLDERS]`

- **Bar**: No stub functions, TODO bodies, or empty features presented as
  complete.
- **Pattern**: Ship a smaller working thing rather than a larger hollow one.
- **Verification**: Review.

---

## 6. Meta — how this document changes

### `[HC-CANON-PRECEDENCE]`

- **Bar**: This document supersedes every loader, instruction file, agent
  definition, skill, and README.
- **Pattern**: On conflict, follow this file and report the divergence so the
  other file gets fixed.
- **Verification**: Review.

### `[HC-ROUTE-DONT-ROOT]`

- **Bar**: Loaders and path-scoped instruction files never define a bar. They
  cite one.
- **Pattern**: Instruction files open with `> Implements: [HC-…]` and carry only
  operational patterns and examples. `AGENTS.md` stays a router within its line
  budget. If a loader starts to read like a rulebook, it has drifted, and the
  rule belongs here instead.
- **Verification**: Review; `AGENTS.md` line count.

### `[HC-REAL-MISTAKES-ONLY]`

- **Bar**: A new rule requires a real failure in this repository. Rules are not
  added for completeness or symmetry.
- **Pattern**: Every rule above traces to a shipped defect or an explicit
  product decision. A speculative rule costs context on every task and protects
  against nothing observed.
- **Verification**: Review of the justification accompanying any proposed rule.

### `[HC-PROPOSE-NEVER-COMMIT]`

- **Bar**: An agent proposes changes to this document; a human approves them.
- **Pattern**: Constitution edits arrive as a proposal with the failure that
  motivated them. Code changes may go straight to `main` via `/cap`, which is
  sanctioned for this repository — `[HC-VERIFY-BEFORE-DONE]` is what protects
  that branch, not a gate.
- **Verification**: Review.
