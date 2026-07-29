# P0 — Propose the integration network boundary

You are working in the Trajectory repository. This prompt **proposes a
constitution amendment**. It does not implement adapters and does not commit
canon.

## The problem

`[HC-NO-EXFILTRATION]` currently says the only outbound network calls live in
`desktop/src/engine/providers/`, and that "adding an outbound call anywhere else
is a constitution change, not an implementation detail."

Trajectory needs to read activity from GitHub, Notion, and Strava. Those require
outbound calls from somewhere that is not a model provider. The bar as written
forbids it, correctly, and the honest response is to amend the bar rather than
to route integration traffic through `providers/` and pretend it is a model call.

## The argument for the amendment

Providers and integrations are not the same risk. A provider **sends your goals,
values, constraints, and journal text to a third party** — that is exfiltration
in the literal sense, accepted because you explicitly configured it. An
integration sends a credential and a query parameter and receives data back. No
user content leaves the machine.

The amendment must encode that asymmetry as a bar rather than leaving it as a
convention someone later forgets. Ingress-only is the whole justification; if a
future adapter starts POSTing user content, the exemption no longer applies to
it.

## What to write

Amend `[HC-NO-EXFILTRATION]` in `docs/methodology/CONSTITUTION.md` so that a
second directory, `desktop/src/engine/integrations/`, may make outbound calls
under all of these conditions:

1. **Ingress-only.** Read-only HTTP methods. An adapter may send credentials,
   query parameters, and pagination cursors. It may not send goals, values,
   constraints, journal text, chat history, mentor content, or any other user
   configuration.
2. **Declared host allowlist.** Each adapter declares the exact hosts it
   contacts. The full list today is `api.github.com`, `api.notion.com`, and
   `www.strava.com`. Adding a fourth host is a visible canon change, not a code
   edit.
3. **User-authorized.** An adapter runs only when the user has enabled it and
   supplied its credential. Disabled means no call.
4. **No telemetry.** The existing prohibition on analytics, crash reporting, and
   update pings is unchanged and applies here too.

State plainly in the bar that employer systems are out of scope for network
adapters, and that such data enters through the reviewed manual import lane
instead. That is a deliberate product decision, not an oversight, and the
constitution is where it stops being re-litigated.

## Also required

Update `docs/methodology/coverage-gaps.md` in the same change. The existing
`[HC-NO-EXFILTRATION]` row already admits "no dependency policy and no network
assertion, so a new outbound call anywhere would pass the suite." Widening the
bar widens that gap. Say so honestly and record what would close it — a test
asserting that no module outside `providers/` and `integrations/` imports a
network client, and that each adapter's host list matches its declared
allowlist.

Update `.github/instructions/` where the path table needs a row for the new
directory, and add the matching path rule to `AGENTS.md`. `AGENTS.md` has a
60-line budget — check `wc -l` after editing.

## Constraints

- `[HC-PROPOSE-NEVER-COMMIT]` — a human approves constitution edits. Present the
  proposed diff and stop. Do not commit.
- `[HC-CITE-SLUG-VERBATIM]` — never paraphrase a rule slug.
- Proposing a rule requires naming the real failure that motivated it. The
  motivating failure here is concrete: the mentor cannot see observed activity,
  so it advises from stale self-report.
- Do not create the `integrations/` directory in this prompt. P1 does that.

## Verification

Run `./scripts/verify.sh`. Documentation changes do not need tests, but the chain
must still pass. Show the output.
