# P6 — Strava training adapter

You are working in the Trajectory repository. Add the training log integration,
following the pattern established by the GitHub adapter in P3.

Requires P0, P1, P2, and P3.

## The one hard part

Unlike GitHub and Notion, Strava does not accept a static token. It needs the
OAuth2 authorization code flow with token refresh, which means the app must
receive a redirect. Everything else in this prompt is routine; budget the
complexity here.

- Open the system browser to Strava's authorize URL with scope
  `activity:read_all`. Do not use an embedded webview — an app-controlled window
  asking for third-party credentials is a phishing pattern, and the desktop
  security instructions already forbid the shape.
- Listen on a loopback redirect (`http://127.0.0.1:{port}/callback`) only while
  authorization is pending, and shut the listener down immediately afterward,
  whether it succeeded or failed. A listener that outlives the flow is an open
  local port nobody is thinking about.
- Exchange the code for an access token and a refresh token. Access tokens expire
  in six hours, so store the **refresh** token and rotate. Strava returns a new
  refresh token on some refreshes — persist it when it changes, or the
  integration dies silently weeks later.

Add `stravaRefreshToken` to the `SecretName` union and reuse `SecretStore`.

## Fetching

`GET https://www.strava.com/api/v3/athlete/activities?after={epoch}&per_page=…`

Rate limits are 100 requests per 15 minutes and 1000 per day. Sync incrementally
from the last successful `fetched_at` using `after`, and paginate. A full
refetch on every sync will exhaust the daily budget on a long history and get the
integration throttled.

## Mapping

One signal per activity:

- `kind: "workout"`
- `summary` — the activity type and distance, composed by the adapter. Do not use
  the user's activity title; those are often jokes or place names and carry no
  training signal.
- `occurred_at` — the activity start date, local.
- `domain` — user-configured, defaulting to a single training domain so workouts
  score against a running or fitness goal.
- `metrics` — distance in metres, moving time in seconds, elevation gain, average
  heart rate when present, and perceived exertion when present.

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
polyline data entirely, persists a rotated refresh token, refreshes an expired
access token before fetching, fetches incrementally using `after`, paginates a
multi-page history, shuts down the loopback listener after a failed
authorization, and computes weekly volume and consecutive-day streaks in the
rollup.
