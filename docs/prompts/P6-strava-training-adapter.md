# P6 — Strava training adapter

You are working in the Trajectory repository. Add the training log integration,
following the pattern established by the GitHub adapter in P3.

Requires P0, P1, P2, and P3.

## Credentials — smaller than it looks

An earlier draft of this prompt called OAuth "the one hard part" and priced the
work at roughly twice P4. That was wrong, and the correction is worth recording
because it is the kind of mistake that silently cancels useful work.

Strava's authorization code flow splits cleanly in two, and only the cheap half
has to run inside the app:

| Step | When | Where |
| --- | --- | --- |
| `authorization_code` exchange | once, by hand | browser + `curl` |
| `refresh_token` exchange | every sync | the adapter |
| `GET /athlete/activities` | every sync | the adapter |

`localhost` and `127.0.0.1` are whitelisted redirect targets, so the authorize
redirect can point at `http://localhost/exchange_token`, fail to load, and have
the `code` copied out of the address bar. **No loopback listener is required.**
The refresh token that comes back is a long-lived pasted credential of exactly
the same shape as the GitHub and Notion tokens — so this ships the same way:
three paste fields, no listener, no port allocation, no listener lifecycle.

An in-app authorize helper (`shell.openExternal` plus a pasted redirect URL) is
deferred to `FUTURE_ITERATIONS.md`. It is needed by any user who does not
already hold a refresh token. It must never be an embedded webview: an
app-controlled window asking for third-party credentials is a phishing pattern,
and the desktop security instructions forbid the shape.

**Rotation is the real hazard, and it is not optional.** The docs are explicit
that a refresh token is returned from *every* successful token request and that
"once a new refresh token is returned, the older refresh token is invalidated
immediately". Persist it the moment it arrives and **before** issuing the
activity request, so a later failure cannot lose it. An integration that drops
the rotated token keeps working until the day it doesn't, then dies weeks later
with no signal — and a stale-but-green failure mode is the exact bug species
this repository has now hit four times.

A refresh token belongs to **one specific application**, and the failure when
it does not match is genuinely confusing: the token endpoint returns 200,
because `client_id` and `client_secret` are a valid pair on their own, and then
the activity request returns 401 on the access token it just issued. Anyone
reading only the status codes concludes the stored token is stale and re-mints
it, which changes nothing.

So the three credentials are not three independent fields. The refresh token
has to have been minted under the same `client_id` that is configured here. If
the user has more than one Strava application — one per project is a normal
thing to have — pairing the token from one with the ID of another produces
exactly the sequence above.

Where an application *is* shared with something else, the token lineage is
shared too, and rotating here invalidates the copy held there.

Also true, and not in the earlier draft: creating an API application now
requires a Strava subscription, and new applications start in "single-player
mode" where only the owning athlete can authorize. For Trajectory that is
exactly right.

Credentials split three ways:

- `client_id` → `stravaConfigSchema` in `policy.ts`. Not a secret; it is an
  integer app ID that appears in every authorize URL.
- `client_secret` → a `SecretName` slot, passed through the existing
  `runner.runSync({ credential })` path.
- `refresh_token` → a second `SecretName` slot, reached through an injected
  `{ read(), save(next) }` pair, because it must travel in both directions.
  That keeps the network call in `engine/integrations/` where the ingress
  exemption lives and `SecretStore` in `main/` where it belongs.

## Fetching

`GET https://www.strava.com/api/v3/athlete/activities?after={epoch}&per_page=…`

Rate limits are **200 requests per 15 minutes and 2,000 per day**, per
application — not the 100/1,000 an earlier draft of this prompt claimed. Sync
incrementally from the last successful `fetched_at` using `after`, and paginate.
A full refetch on every sync will exhaust the daily budget on a long history and
get the integration throttled. A 429 must name which of the two budgets was
exhausted, because the wait is fifteen minutes or the rest of the day and the
user cannot tell which from a bare error.

## Mapping

One signal per activity:

- `kind: "workout"`
- `summary` — the activity type and distance, composed by the adapter. Do not use
  the user's activity title; those are often jokes or place names and carry no
  training signal.
- `occurred_at` — the activity start date, local.
- `domain` — user-configured, defaulting to a single training domain so workouts
  score against a running or fitness goal.
- `metrics` — distance in metres, moving time in seconds, elapsed time,
  elevation gain, and average and max heart rate when present. **Not perceived
  exertion**: it is not on the `SummaryActivity` the list endpoint returns, and
  fetching it would cost one extra request per activity against the rate limit
  above. Dropped rather than paid for.

Do **not** store GPS streams, polylines, or start coordinates. They are the most
sensitive data Strava holds, they are large, and the mentor has no use for them.

The rollup is what makes this useful: weekly volume, consecutive training days,
and week-over-week change. A mentor that can see nine consecutive days against a
stated recovery constraint has something worth saying; a mentor that can see one
run does not.

## Constraints

- Declare `www.strava.com` as this adapter's exhaustive host list.
- Ingress-only after authorization. The token exchange necessarily POSTs, which
  is part of the OAuth flow rather than an exfiltration path — it sends the
  client credentials and the authorization code, and no user content. State this
  explicitly in the adapter's comments so a future reader does not read it as a
  violation.
- `[HC-SECRETS-ENV-ONLY]` — no token, code, or client secret in any log, error,
  or UI string.
- `[HC-NO-PRIVATE-DATA-COMMITS]` — fixtures are invented activities.

## Verification

Run `./scripts/verify.sh` and show the output. Tests against recorded fixtures,
never a live endpoint.

Tests to add, named for behavior: maps an activity to a signal, omits GPS and
polyline data entirely, persists a rotated refresh token **before** the activity
request rather than after, reuses a cached access token until it expires,
refreshes an expired one before fetching, fetches incrementally using `after`,
paginates a multi-page history, keeps a credential out of every error message,
distinguishes the fifteen-minute budget from the daily one on a 429, and derives
the lookback horizon from the local calendar rather than from UTC.

That last one is not padding. Deriving a calendar day with
`.toISOString().slice(0, 10)` has produced a real off-by-one bug in this
repository four separate times. Use `localDate` from `rollup.ts`, and write the
test at an hour where UTC and local disagree — a test at 09:00Z passes under
both and catches nothing.

Weekly volume and consecutive training days come from `buildRollup`, which
already sums `metrics` into `totals` and already computes `streak_days` per
integration. What was missing was a short window: rollups covered thirty days
only, so "how did this week go" was answered from a month of data. Selection now
emits both a 7-day and a 30-day rollup per contributing integration. Because the
windows overlap, both prompts must tell the model never to add two rollups
together.
