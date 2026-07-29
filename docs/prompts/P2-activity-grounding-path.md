# P2 — Activity grounding path

You are working in the Trajectory repository. Wire the signals built in P1 into
the mentor's reasoning. **This prompt still adds no network code** — it is proven
end to end against P1's synthetic fixture adapter.

Read `.github/instructions/engine.instructions.md` and the "Grounding and
attribution" section of `docs/methodology/CONSTITUTION.md` first.

## The two mistakes to avoid

**Do not merge activity into `current_state`.** `current_state` is what the user
claims about themselves. Activity is what was measured. Merging them destroys
`[HC-OBSERVATION-VS-INFERENCE]`, which exists so the user can reject the model's
conclusion without doubting the underlying reading. Three separate fields: what
you claim, what was measured, what the model concluded.

**Do not route signal IDs through `source_ids`.** Mentor sources are evidence
about the mentor's beliefs; activity signals are evidence about the user. They
are different lanes. `validation.ts` enforces bidirectional attribution — every
cited principle needs a cited source from its `source_ids`, and every cited
source must link back to a cited principle. Putting a commit ID into
`source_ids` would make a commit count as support for a principle, which silently
guts `[HC-BIDIRECTIONAL-ATTRIBUTION]`.

## Request side

Add `activity_context` to `decisionRequestSchema` and `chatRequestSchema` as a
sibling of `voice_context`. It is nullable, and null is the normal case when no
integration is enabled. Request schemas are not sent through `zodResponseFormat`,
so `.nullable()` is safe here — `voice_context` already proves the pattern.

The context carries the selected signals plus the relevant rollups, both already
bounded. It does not carry the whole store.

## Selection

Extend `selection.ts` with deterministic signal selection, matching the existing
token-overlap approach:

- Match `ActivitySignal.domain` against the domains of the already-selected
  goals.
- Score remaining candidates by token overlap with the message.
- Cap hard. A dozen signals plus one rollup per domain is a budget, not a
  starting point; the mentor's own principles must not get crowded out.
- Prefer recent signals, but do not let recency alone admit an irrelevant one.

Selecting nothing is a valid outcome and must produce `activity_context: null`
rather than an empty scaffold.

## Response side

Add `activity_ids: z.array(identifier)` to `recommendationSchema` and
`chatResponseSchema`. It is **required but may be empty** — required because
`[HC-STRICT-SCHEMA-REQUIRED]` means every property of those two schemas is listed
in `required`, and `.optional()` produces a schema the API rejects outright.
Follow the existing `observations: z.array(text)` precedent, which has no
minimum.

Add one-directional validation in `validation.ts`: every cited `activity_id` must
exist in the request's `activity_context`. Unlike sources, there is no reverse
requirement — the model is not obliged to cite every signal it was shown, because
signals are context rather than support.

## Prompts

Bump `PROMPT_VERSION` and `CHAT_PROMPT_VERSION` to `decision_v5` and `chat_v5`.
The system prompts must state:

- Activity signals are observations. Cite them in `activity_ids` and describe
  them in `observations`, never in `inferences`.
- A signal may support an observation but never substitutes for a grounded
  principle. Advice still needs `principle_ids` and `source_ids`.
- Absent data is not evidence of absent effort. An empty training log means the
  log is empty, not that the user did nothing — say so rather than inferring.
- Discrepancy between stated priority and observed activity is worth raising,
  but as a question about the reading, not as an accusation.

## Out of scope

No real adapters. No proactive notification when a discrepancy appears — the
first pass is pull-only.

## Constraints

- `[HC-OBSERVATION-VS-INFERENCE]`, `[HC-BIDIRECTIONAL-ATTRIBUTION]`,
  `[HC-CITATIONS-RESOLVE]`, `[HC-STRICT-SCHEMA-REQUIRED]`,
  `[HC-REFUSE-UNGROUNDED]`.
- `[HC-PROVIDER-PARITY]` — the Copilot and OpenAI providers change in lockstep.
  The deterministic provider must keep working with `activity_context: null`.
- Never use real activity in a fixture (`[HC-NO-PRIVATE-DATA-COMMITS]`).

## Verification

Run `./scripts/verify.sh` and show the output. Tests to add, named for behavior:

- selects no signals when nothing matches, and sends null
- caps the number of signals sent
- rejects a response citing an activity ID that was not in the request
- accepts a response citing no activity IDs at all
- keeps observations and inferences in separate fields when activity is present
- still answers correctly with every integration disabled

That last one matters most. Every existing test must pass unchanged with
`activity_context: null`, because most users will have no integrations enabled.
