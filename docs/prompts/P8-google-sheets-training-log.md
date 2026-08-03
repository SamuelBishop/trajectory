# P8 — Google Sheets training log

You are working in the Trajectory repository. Add an integration that reads one
spreadsheet: a coach-athlete training log.

Requires P0, P1, and P2. Independent of P3, P4, and P6.

## Why this one is different

Every other adapter observes what happened. GitHub knows about commits you
made, not commits you meant to make; Strava knows about runs you recorded, not
runs you skipped. Absence of a signal is ambiguous — it could mean you did
nothing, or that the tool was not watching.

A coached training log resolves that ambiguity, because it contains both halves
on the same row. One column is what the coach prescribed. The next is what was
actually done. An empty second cell against a filled first one is a session
that was planned and did not happen, recorded by a human at the time.

`ActivitySignal.completed` carries a schema comment saying the value "cannot be
recovered downstream". This is the first source that supplies it from evidence
rather than from an assumption about what a missing record means. That, not the
mileage, is why the integration is worth building.

## Auth: a service account, not "Sign in with Google"

The obvious design is the user OAuth flow. It does not work here. From Google's
own identity documentation:

> A Google Cloud Platform project with an OAuth consent screen configured for
> an external user type and a publishing status of "Testing" is issued a
> refresh token expiring in 7 days

That is weekly re-authorization forever. Escaping it means publishing the app
and submitting `spreadsheets.readonly` — a sensitive scope — for Google's
verification review, which is not something a single-user local app can
reasonably complete.

A service account has no consent screen, no publishing status, and no refresh
token to expire. It signs a JWT locally with RS256 and exchanges it for a
one-hour access token. `node:crypto` does the signing, so **no new dependency**,
and there is no rotation, so no write-back token store — this adapter is
strictly simpler than P6, not harder.

The access model is also better than anything else here. A Strava token can read
every activity in the account; a Notion integration can read every page shared
with it. A service account begins able to see **nothing at all**, and gains
exactly the files a human shares with its email address.

Use `https://www.googleapis.com/auth/spreadsheets.readonly`. Do **not** use a
Drive scope: Drive scopes are *restricted*, require a third-party security
assessment, and grant access to every file in the account.

### Take the whole key file

The user pastes the entire downloaded JSON. Parse it; put `client_email` in
integrations config and `private_key` in `SecretStore`.

Do not ask for the PEM. That key is a multi-line value with escaped `\n`
sequences inside a JSON string, and asking someone to extract it by hand is a
guaranteed support round-trip. `JSON.parse` unescapes it correctly and for free.
Pasting the wrong file is the likely mistake — an OAuth *client* JSON has
`installed` or `web` keys and no `private_key` — so say so by name.

`client_email` is not a secret and must not be buried in the encrypted store.
It is the address the user has to paste into Google's share dialog, and a value
nothing can read back is a setup step nobody can complete.

## Constitution change — do this first

`[HC-NO-EXFILTRATION]` names the outbound host allowlist literally, and states
that a new host is a constitution change rather than an implementation detail.
This adds two: `oauth2.googleapis.com` and `sheets.googleapis.com`.

The same paragraph's ingress-only exception is worded as "client credentials and
an authorization code". A JWT-bearer assertion is neither, so the sentence needs
widening as well — same category of thing, no user content, but the text does
not currently cover it.

`[HC-PROPOSE-NEVER-COMMIT]` applies: propose the diff, a human approves it.
`desktop/tests/engine/integrations/runner.test.ts` asserts the host list
verbatim and will fail until the change lands. That is the enforcement working.

## Reading the sheet

Two requests per sync.

1. `GET /v4/spreadsheets/{id}?fields=sheets.properties.title` — proves the tab
   exists. Without it a mistyped tab name produces zero rows and no explanation.
2. `GET /v4/spreadsheets/{id}/values/{range}` with
   `valueRenderOption=UNFORMATTED_VALUE` and
   `dateTimeRenderOption=SERIAL_NUMBER`.

Serial numbers rather than formatted strings: a date cell comes back as a count
of days since 1899-12-30, which is locale-free. `FORMATTED_VALUE` returns
whatever the display format happens to be, which the user can change.

**A serial is a calendar square, not an instant.** Convert it in UTC —
`Date.UTC(1899, 11, 30) + n * 86_400_000`, read back with `getUTC*` — and only
then hand the calendar date to `localDate()`. Converting through local time is
what produces the off-by-one, which this repository has now hit four times.

**Match columns by name, never by letter.** Headers wrap: a real one reads
`"Running \nMiles"`, with a literal newline. Collapse whitespace, trim, and
lowercase before comparing, or every metric silently fails to match and the
numbers vanish with no error. Matching by letter is worse than wrong — it keeps
working when a column is inserted and starts reading different data.

**Data does not start at `header_row + 1`.** Logs written by a coach usually
carry an explanatory row underneath the headers. Make the first data row a
setting, or that row becomes one undated junk signal on every sync.

## Mapping

**Signal id is `hash(spreadsheet, tab, date, ordinal-within-date)`.**
Deliberately not derived from the row's text. `SignalSink.merge` upserts by id,
and this sheet's defining rhythm is a row written on Monday and filled in on
Wednesday. A content-derived id would store the plan and the achievement as two
separate signals instead of letting the second complete the first. Not the row
number either — inserting a row shifts every id below it.

**Do not resume from `since`.** Every other adapter resumes to save rate limit.
Here the entire range is already paid for in one request, and resuming would
mean an `Actual` cell filled in three days late is never picked up. `since`
only ever *widens* the window.

**Exclude future-dated rows, and count them.** A row for next Saturday with a
plan and no actual is not a failure. Left in, `completed: false` feeds
`open_count` and suppresses `streak_days`, so next month's training block reads
as a backlog of missed sessions.

**Budget the summary per field**, not by truncating the join. Otherwise a long
coach comment crowds out what was actually done — and a long first note eats
the second one entirely.

## Errors must read the body

Google returns two different error shapes: `{error, error_description}` from the
token endpoint, `{error: {code, message, status}}` from the API. Read both.

| Cause | Signal | What the user must do |
| --- | --- | --- |
| Sheet never shared | 403 `PERMISSION_DENIED` | Share it — **the likeliest failure**, so the message names the address |
| Sheets API not enabled | 403 `SERVICE_DISABLED` | Enable it in the console |
| Key does not match account | 400 `invalid_grant`, invalid signature | Re-download the key |
| Machine clock skewed | 400 `invalid_grant`, timing wording | Fix the clock — nothing about the credential is wrong |
| Wrong spreadsheet id | 404 | Re-paste the address |
| Wrong tab name | 400, unparseable range | Correct the tab |
| Rate limited | 429 | Back off |

Check `SERVICE_DISABLED` **before** `PERMISSION_DENIED`: both are 403 and the
fixes are in different places.

Google's clock-skew message does not contain the word "clock". It reads "Token
must be a short-lived token and in a reasonable timeframe". Match on the
wording that is actually sent, and assert that every message in the table is
distinct — byte-identical advice for different causes is how a live debugging
session goes in circles.

## Verification

`./scripts/verify.sh`. Fixtures only, with invented workouts — never a live
endpoint and never a real training record, per `[HC-NO-PRIVATE-DATA-COMMITS]`.
Generate an RSA keypair in-process at import rather than committing key
material.

Bind at least: headers containing newlines; every accepted date format; a
serial converted at an hour where UTC and local disagree; planned-versus-actual
mapping in both directions; future exclusion; per-field summary budgets; id
stability across an `Actual` edit; every error message distinct; no private key
in any message; and the declared host list exhaustive.

Then mutation-test the parsing and error paths. The two most valuable mutants
are removing a per-field summary cap and widening the host guard.
