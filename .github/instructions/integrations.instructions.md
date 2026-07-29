---
applyTo: "desktop/src/engine/integrations/**,desktop/tests/engine/integrations/**"
description: Activity integration adapters and the ingress-only network boundary
---

> Implements: `[HC-NO-EXFILTRATION]`, `[HC-SECRETS-ENV-ONLY]`,
> `[HC-NO-PLAINTEXT-HISTORY]`, `[HC-NO-PRIVATE-DATA-COMMITS]`,
> `[HC-OBSERVATION-VS-INFERENCE]`, `[HC-TEST-WITH-BEHAVIOR]`,
> `[SC-NO-PLACEHOLDERS]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.
> `engine.instructions.md` also applies here; this file adds to it.

## The boundary

This is the second of two directories permitted to make outbound calls, and the
narrower one. Providers send user content to a model. Adapters send a credential
and a query and receive data back. Everything here exists to keep that
asymmetry true, because it is the entire justification for the exemption.

Read-only HTTP methods. The one exception is an OAuth token exchange, which
carries client credentials and an authorization code. If you find yourself
putting a goal, a value, a constraint, a journal entry, a chat message, or
mentor content into a request body, stop — that is no longer an integration.

## Patterns

**Hosts are declared, not discovered.** Every adapter exposes a `hosts` array
that is exhaustive. It matches the list in `[HC-NO-EXFILTRATION]`. A URL built
from a response field — a `next` link, a redirect target — is not covered by the
declaration, so validate it against `hosts` before following it.

**Adapters return signals, never payloads.** The adapter's job is to normalize.
Raw API responses do not leave this directory. A caller that has to know whether
a record came from Notion or Strava means the abstraction failed.

**Summaries are bounded at the source.** Truncate in the adapter, not in the
prompt builder. A commit body, a task description, or an activity title can be
arbitrarily long and occasionally contains a pasted credential; taking the first
line and capping it is both a context-budget decision and a privacy one.

**Fetch incrementally.** Sync from the last successful `fetched_at`. A full
refetch on every run burns rate limit and, on a long history, gets the
integration throttled into uselessness.

**Rate limits are handled, not hoped about.** Back off, surface the state, and
stop. Never spin. A 401 tells the user to re-authorize and never echoes the
credential.

**Disabled means no call.** Check the enabled flag, the global pause, and quiet
hours before any request. This is the difference between a tool and a
surveillance system, and it is checked before the network, not after.

**Credentials come from `SecretStore`.** Never from a config file, never from a
constructor argument the renderer can reach, never in a log line or an error
message — including a redacted one.

## Style

- One file per adapter, named for the service.
- The adapter interface lives in this directory; `domain.ts` owns the signal
  schemas, and the dependency points that way.
- Adapters are classes because they hold configuration and a credential handle.
  Mapping functions are pure and exported separately, because that is what the
  tests exercise.

## Tests

Fixtures only. **Never call a live endpoint from a test** — a suite that needs
network access and a valid token is a suite that quietly stops being run.

Record a real response shape once, strip it of anything personal, and commit
that. Fixtures use invented commits, invented task titles, invented repositories,
and invented workouts. Real activity is personal data and does not belong in the
repository (`[HC-NO-PRIVATE-DATA-COMMITS]`).

Name tests after the behavior the adapter guarantees: "backs off on a rate-limit
response", "reports a 401 without leaking the token", "omits GPS and polyline
data entirely".
