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

There are 32 rules.

---

## 0. Mode — PROTOTYPE

**This repository is in prototype mode.** It is a single-author app that is not
yet usable end to end, and the goal right now is to get it usable. Gates that
cost minutes are suspended; gates that cost seconds are not.

The line is **reversibility**, not importance. A bug in the renderer can be
fixed next week. A plaintext journal on disk, a secret in git history, or user
data sent to a third party cannot be un-shipped. So:

| Suspended while prototyping | Cost when it ran | Still in force |
| --- | --- | --- |
| Adversarial `review` on every change | ~11.5 min | Run it on demand — before a release, or when touching crypto, IPC, or a provider |
| `npm run package && npm run smoke` on every change | several min | Run before you actually use the app, and after packaging/preload/provider-runtime changes |
| Loop steps 3–4 (signal, then BEFORE evidence) | ~doubles small changes | Still required for **bug fixes**, where the repro *is* the proof |
| `coverage-gaps.md` row-by-row upkeep | — | Update it when you add or remove a bar, not on every diff |
| `[HC-TEST-WITH-BEHAVIOR]` for UI and wiring | — | Engine logic still ships with a test — that is what `verify.sh` protects |
| `[HC-NARROW-DIFF]`, `[SC-NO-PLACEHOLDERS]` | — | Drive-by fixes and stubs are fine; just say what is a stub |

**Never suspended, because they are free and irreversible:**
`[HC-NO-PLAINTEXT-HISTORY]`, `[HC-NO-PRIVATE-DATA-COMMITS]`,
`[HC-SECRETS-ENV-ONLY]`, `[HC-NO-EXFILTRATION]`. These are constraints on what
you write, not gates that run, so they cost nothing to keep — and each one
protects something you cannot repair after the fact.

**Always required, because it takes 2.7 seconds:** `./scripts/verify.sh`.
`[HC-VERIFY-BEFORE-DONE]` and `[HC-EVIDENCE]` still apply to it. Never report
something as working without having run it.

### Leaving prototype mode

Delete this section and work through **Deferred quality gates** in
`docs/FUTURE_ITERATIONS.md`, which records what was skipped while it was in
force. Do that before anyone other than the author uses this.

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
- **Pattern**: The engine runs in the Electron main process, so most work crosses
  no process boundary at all. Where one remains — the Copilot SDK spawning the
  Copilot runtime — the payload travels over JSON-RPC on stdio. Argv is
  world-readable to any local process listing; stdin is not.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "disables tools, denies permissions, and cleans up the session" asserts the
  prompt is passed through `sendAndWait`, never as a spawn argument.

### `[HC-SECRETS-ENV-ONLY]`

- **Bar**: Credentials are read only from the environment, the host's own auth,
  or an encrypted local store the user typed into deliberately. A credential
  never appears in output, logs, error messages, committed files, or any value
  returned to the renderer.
- **Pattern**: Read API keys from environment variables. Let the Copilot SDK
  use existing local GitHub authentication. When a credential is missing, name
  the variable, never the value. Do not echo a key back even when redacting.
  A key the user types into the app is permitted only under all four of:
  encrypted at rest with the same backend as chat history; **refused** rather
  than written when that backend is unavailable, with no plaintext fallback;
  write-only across IPC, so the bridge exposes set, clear, and a boolean `has`
  but no getter; and never logged. A GUI app inherits no shell environment, so
  the in-app value takes precedence over the variable when both are present.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "requires credentials from the environment" and
  "wraps SDK errors without leaking the underlying message";
  `desktop/tests/secrets.test.ts` — "never writes the credential in a readable
  form", "refuses to store anything when encryption is unavailable", and
  "exposes no channel that returns a credential";
  `desktop/scripts/smoke-packaged.mjs` — "a credential can be stored and
  removed but never read back" and "the credential was never written in the
  clear".

### `[HC-NO-EXFILTRATION]`

- **Bar**: User data leaves the machine only via the model provider the user
  explicitly configured. No telemetry, analytics, crash reporting, or update
  pings.
- **Pattern**: The only outbound network calls live in
  `desktop/src/engine/providers/`. Nothing else in the app makes a network call.
  Adding an outbound call anywhere else is a constitution change, not an
  implementation detail. An SDK's *defaults* count as outbound behaviour: the
  Copilot SDK's default mode reads `AGENTS.md`, `.github/copilot-instructions.md`
  and `CLAUDE.md` from its working directory — which defaults to
  `process.cwd()` — into every prompt. Providers therefore opt out explicitly
  (`mode: "empty"`, `skipCustomInstructions`, `enableSessionTelemetry: false`)
  and run in an application-owned directory chosen by the main process.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "gives the runtime no ambient context to read". Manual review of new network
  calls and dependencies.

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
- **Pattern**: The engine takes `userDirectory` and `mentorDirectory` as
  arguments and resolves nothing itself. The main process derives them from
  `app.getPath("userData")`, seeding once from bundled read-only demo data when
  they are absent. Seeding never overwrites an existing file.
- **Verification**: `desktop/tests/engine/paths.test.ts` —
  "reads from resources when packaged", "reads from the repository in
  development", "never overwrites configuration the user has edited", and
  "fails loudly when bundled configuration is missing".

---

## 2. Provider contract

### `[HC-NO-PROVIDER-FALLBACK]`

- **Bar**: A failing provider raises. It never silently downgrades to another
  provider or to canned output.
- **Pattern**: The user chose a provider deliberately; substituting a different
  one changes the meaning of the answer without telling them. Surface the error
  with the remedy.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "does not fall back after a second invalid response".

### `[HC-PROVIDER-PARITY]`

- **Bar**: Every provider implements the whole protocol — decision review *and*
  chat — and returns the same validated types.
- **Pattern**: New capabilities are added to the protocol and to all providers
  in the same change, or the gap is declared. A provider that supports half the
  surface makes the provider selector a trap.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "requests a strict schema in which every property is required" (OpenAI chat)
  and "supports chat" (Copilot).

### `[HC-STRICT-SCHEMA-REQUIRED]`

- **Bar**: Under strict structured output, every property in the schema must be
  listed in `required`, including properties that have defaults.
- **Pattern**: This rule exists because a Pydantic schema that omitted
  `default_factory` fields from `required` was rejected at runtime. Zod's
  `zodResponseFormat` lists every property, so the defect is now structurally
  hard to reintroduce — but only while the response schemas stay free of
  `.optional()` and `.default()`. `desktop/src/engine/domain.ts` says so at the
  top of the file.
- **Verification**: `desktop/tests/engine/domain.test.ts` —
  "lists every recommendation property in required" and "lists every chat
  response property in required", plus
  `desktop/tests/engine/providers.test.ts` —
  "requests a strict schema in which every property is required", which asserts
  the shape actually sent to the API rather than the schema in isolation.

### `[HC-SDK-BOUNDARY]`

- **Bar**: Third-party SDK usage stays inside its provider module, runs with the
  least authority the SDK offers, cleans up in `finally`, and wraps SDK
  exceptions in this project's error type.
- **Pattern**: Disable tools, deny permissions, delete the session in a
  guaranteed-cleanup block. Denial must be the SDK's actual refusal decision:
  the Copilot SDK's `{ kind: "no-result" }` sends *no* decision and leaves the
  request pending, so the provider returns `{ kind: "reject" }`. Cleanup must not
  mask the original failure — a throw from teardown replaces the error the
  caller needed to see. No module under `desktop/src/engine/` outside
  `providers/` imports an SDK, so application code never handles a vendor
  exception type. Tests may import a vendor type to assert it gets wrapped.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "disables tools, denies permissions, and cleans up the session",
  "rejects permission requests rather than declining to answer them",
  "wraps SDK errors without leaking the underlying message" (OpenAI, which
  asserts a credential in the vendor message is not surfaced), and
  "wraps SDK errors" (Copilot).

### `[HC-PACKAGED-RUNTIME]`

- **Bar**: A provider must work in the packaged application, not only in
  development. An SDK's assumptions about its host are the application's problem
  to solve, and a provider that cannot run is a defect, not a limitation.
- **Pattern**: This rule exists because the Copilot SDK launches its runtime
  with `process.execPath`, which under Electron is the application binary rather
  than Node — so `start()` hung forever with no error and no log. Forcing Node
  mode did not fix it either: the runtime's argument parser branches on
  `process.versions.electron`, which Electron still reports. The provider now
  points the SDK at the platform package's native binary, rewritten from
  `app.asar` to `app.asar.unpacked` because executables cannot be spawned from
  inside an archive. Each of those three failures was silent or misattributed in
  development. Assume the packaged environment differs and prove otherwise.
- **Verification**: `desktop/tests/engine/providers.test.ts` —
  "spawns the native runtime binary when hosted by Electron",
  "spawns the unpacked binary rather than one inside the asar",
  "refuses rather than hanging when the runtime is missing"; and
  `npm run smoke --prefix desktop` — "the OpenAI SDK ships inside the build".
  The Copilot runtime needs a signed-in account and stays a manual check.

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
- **Verification**: `desktop/tests/engine/validation.test.ts` —
  "rejects an unknown citation" and "accepts resolved attribution".

### `[HC-BIDIRECTIONAL-ATTRIBUTION]`

- **Bar**: Principles and sources must link in both directions. A cited
  principle needs a cited source, and a cited source needs a principle that
  links to it.
- **Pattern**: One-directional checks let a model cite an impressive-looking
  source that nothing actually rests on. Check both edges.
- **Verification**: `desktop/tests/engine/validation.test.ts` —
  "rejects a principle with no cited support",
  "rejects a source not linked to a cited principle", and
  "accepts independently sourced principles".

### `[HC-OBSERVATION-VS-INFERENCE]`

- **Bar**: What the system read and what the system concluded stay in separate
  fields and are never merged into one narrative.
- **Pattern**: Observations quote or reference the user's own configuration.
  Inferences are the model's reasoning about them. The user must be able to
  disagree with the second without doubting the first.
- **Verification**: `desktop/tests/engine/validation.test.ts` —
  "preserves observation and inference fields".

### `[HC-MENTOR-IDENTITY-INTEGRITY]`

- **Bar**: Mentor sources must be real and pre-approved, demo mentors must be
  visibly fictional, and no output may imitate a living person's voice or imply
  their endorsement.
- **Pattern**: Configuration loading rejects principles pointing at unapproved
  or unknown sources. Shipped mentor content is synthetic and labeled. Writing
  in a named living person's style is a refusal, even when asked directly —
  unless the person supplies the text themselves, in which case use it verbatim
  and attribute it.
- **Verification**: `desktop/tests/engine/config.test.ts` —
  "rejects an unapproved source", "rejects an unknown principle source", and
  "rejects a non-synthetic source on a fictional profile". The voice and
  endorsement clauses are manual.

### `[HC-REFUSE-UNGROUNDED]`

- **Bar**: When nothing relevant is grounded, refuse. Do not answer from general
  knowledge and present it as mentorship.
- **Pattern**: Selection fails loudly when no goal matches. The deterministic
  provider refuses questions outside its demo scenario instead of reusing
  scenario advice out of context.
- **Verification**: `desktop/tests/engine/selection.test.ts` —
  "fails when no goal matches"; `desktop/tests/engine/providers.test.ts` —
  "rejects a question outside the committed demo" and
  "does not treat a design proposal as a pull request".

### `[SC-UNCERTAINTY-DECLARED]`

- **Bar**: Responses carry a calibrated confidence and name what they are
  uncertain about.
- **Pattern**: Confidence is range-validated. An empty uncertainty list on a
  consequential decision is a smell, not a strength.
- **Verification**: `desktop/tests/engine/prompting.test.ts` —
  "rejects out-of-range confidence" and "rejects a response with no uncertainty".

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
  `desktop/src/preload/index.ts` surface; `npm run smoke --prefix desktop` —
  "the renderer has no Node access", which asserts `require`, `process`, and
  `module` are all undefined in the launched packaged renderer. The
  `webPreferences` flags themselves are still review-only.

### `[HC-PRELOAD-CJS]`

- **Bar**: A sandboxed preload script must be built as CommonJS, and the main
  process must reference the filename that is actually emitted.
- **Pattern**: `electron.vite.config.ts` forces `format: "cjs"` and
  `entryFileNames: "[name].cjs"` for the preload bundle, and main loads
  `index.cjs`. Without this the bundler emits `.mjs`, the sandboxed preload
  silently fails to load, and `window.trajectory` is `undefined` in the packaged
  app while dev mode looks fine.
- **Verification**: `npm run smoke --prefix desktop` — "the preload bridge is
  exposed". Packaging alone is not enough: `electron-builder --dir` never runs
  the app, so a successful package reports nothing about the bridge. The smoke
  test launches the packaged app and reads `window.trajectory` from the real
  renderer.

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

Steps 3 and 4 are relaxed in prototype mode — see section 0. They remain
required for bug fixes, where the reproduction is the whole proof.

1. **Read** the canon and the path-scoped rules for the files being touched.
2. **Specify** intent, scope boundary, affected paths, and applicable slugs.
3. **Signal** — define the observable proof: a failing test or a reproduction
   command.
4. **BEFORE evidence** — run it and capture the output. This step cannot be
   repaired after the fact.
5. **Implement** narrowly.
6. **AFTER evidence** — rerun and run the verification chain, citing slugs.
   Adversarial review is on demand while prototyping, not automatic.

### `[HC-EVIDENCE]`

- **Bar**: Before/after evidence is real captured output. "I verified this
  manually" without output is not evidence, and neither is a description of what
  the output would have said.
- **Pattern**: If step 4 was skipped, say so plainly instead of reconstructing
  it. A missing baseline is recoverable; a fabricated one is not.
- **Verification**: `./scripts/verify.sh` output in the report. Adversarial
  review when it is run — this is the bar the `review` agent assumes is being
  violated until output proves otherwise.

### `[HC-VERIFY-BEFORE-DONE]`

- **Bar**: Nothing is reported as done until the relevant verification has run
  and its output has been shown.
- **Pattern**: `scripts/verify.sh` runs the whole chain fail-fast in about three
  seconds. There is no excuse for skipping it. Running a targeted subset is fine
  when the diff is narrow; saying which subset ran, and why it covers the
  change, is not optional. `npm run package && npm run smoke` from `desktop/`
  covers what the chain cannot see — packaging, the preload, and provider
  runtimes. In prototype mode that is on demand rather than per-change (section
  0), but it is the only thing that catches a build which is green everywhere
  else and broken once installed, so run it before you actually use the app.
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
