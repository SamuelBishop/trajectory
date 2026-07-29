# P7 — Screen Time interface, no adapter

You are working in the Trajectory repository. Define the attention-signal
interface and document why nothing implements it.

Requires P1. **Does not require P0** — no network code, so it can proceed while
the amendment is in review.

## Read this before deciding to be clever

Attention data is the most obviously useful signal on the integration list and
the least obtainable. Apple ships no supported export API. The realistic options
were evaluated and all four were rejected for the first pass:

**macOS `knowledgeC.db`.** Screen Time data lives in a SQLite database under
`~/Library/Application Support/Knowledge/`. Reading it requires Full Disk Access,
the schema is undocumented and private, it changes across OS releases, and it
covers only the Mac. An integration that silently breaks on every OS update and
demands the most powerful permission macOS grants is a bad trade for a signal the
user could describe in one sentence.

**iOS Screen Time.** Cannot leave the device. The `DeviceActivity` and
`FamilyControls` frameworks are iOS-only, require a special entitlement, and
deliberately provide no export path to a desktop app. This is not a gap to be
engineered around; it is the design.

**A local tracker such as ActivityWatch.** Technically the best fit — open
source, local-first, localhost REST API. Rejected for now only because it adds a
second application the user must install and keep running, which is a product
dependency rather than a technical one. This is the most likely future adapter.

**Manual aggregate entry.** Already covered. P5's reviewed import lane accepts
manual batches, so a user who wants attention data in the mentor's context can
put it there today without any new code.

## What to build

The interface only, plus honest documentation.

Define the `attention` signal shape as a specialization of `ActivitySignal`:
`kind: "attention"`, with `metrics` carrying duration in minutes, pickup count,
and category. Define what a future adapter would have to return so that the
contract exists and P1's store, P2's selection, and P5's import lane can already
carry attention records.

Write the rationale above into the code as a comment on the interface and into
`docs/FUTURE_ITERATIONS.md` as the condition under which this gets revisited:
either a supported consent-based Apple API appears, or the user decides a local
tracker dependency is acceptable.

## Constraints

- `[SC-NO-PLACEHOLDERS]` — do **not** create a stub adapter that throws or
  returns an empty array. An interface with no implementation is a contract; a
  stub adapter is a lie that shows up in the UI as a working integration. If it
  cannot be built, it should be absent and documented, not present and hollow.
- The constitution's framing holds: attention data is user-controlled reflection,
  never surveillance. Nothing here captures keystrokes, window titles, private
  conversations, or other people's data.
- Do not register an attention integration in the Settings pane. There is nothing
  to enable.

## Verification

Run `./scripts/verify.sh` and show the output.

The meaningful test is that an attention signal produced by P5's manual import
lane flows through storage, selection, and into a prompt exactly like any other
signal. That proves the contract is real rather than decorative, which is the
entire deliverable.
