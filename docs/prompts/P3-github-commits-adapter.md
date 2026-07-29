# P3 — GitHub commits adapter

You are working in the Trajectory repository. Build the first real activity
adapter. It establishes the pattern P4 and P6 copy, so favor clarity over
cleverness here.

Requires P0 (approved amendment), P1 (substrate), and P2 (grounding path).
Read `.github/instructions/engine.instructions.md` and the amended
`[HC-NO-EXFILTRATION]` before starting.

## Why this one first

The credential already exists. `SecretName` in `desktop/src/main/secrets.ts`
already includes `githubToken`, so this adapter adds no new secret and no new
storage path. It is the shortest distance to a real signal in a real prompt.

## API choices that matter

Do **not** use `GET /users/{username}/events`. It covers only the last 90 days
and only public activity, which makes it useless for exactly the private work
that matters most here. It looks like the obvious endpoint and it is a trap.

Use instead:

- **GraphQL `contributionsCollection`** for aggregate shape — daily contribution
  counts, repository breakdown, private contribution totals. This is what feeds
  `ActivityRollup`.
- **REST commit search** (`GET /search/commits?q=author:{user}+committer-date:>{since}`)
  for individual commits that become `ActivitySignal` records. Note this endpoint
  requires the `cloak` preview media type on older API versions and is rate
  limited more aggressively than the core API — 30 requests per minute.

Both are read-only, which is what the amendment permits.

## Mapping

One signal per commit:

- `kind: "code_commit"`
- `summary` — the first line of the commit message, truncated. Never the body;
  bodies contain issue links, internal identifiers, and occasionally pasted
  secrets.
- `domain` — derived from a user-configured repository-to-domain map, so commits
  to the work repo score against the promotion goal and commits to a side
  project score against the side-project goal. Default to the repository name
  when unmapped.
- `metrics` — additions, deletions, changed files.
- `url` — the commit URL.

The repository-to-domain map is the piece that makes discrepancy detection work.
Without it every commit lands in one undifferentiated bucket and the mentor
cannot tell you that goal one is getting a fifth of your commits.

## Configuration

Let the user choose which repositories or organizations are in scope, and default
to none rather than all. Fetching everything the token can see is a privacy
decision made on the user's behalf, and the wrong one.

Sync incrementally from the last successful `fetched_at`, never a full refetch.

## Constraints

- Declare `api.github.com` as this adapter's exhaustive host list.
- Ingress-only. Read-only methods. Never send user configuration, goals, or
  message text in a request — the query carries an author, a date, and a cursor.
- `[HC-SECRETS-ENV-ONLY]` — the token never appears in a log, an error message,
  or a rendered UI string. Handle a 401 by telling the user to re-authorize,
  without echoing the credential.
- Handle rate limiting by backing off and surfacing the state. Never spin.
- `[HC-NO-PRIVATE-DATA-COMMITS]` — test fixtures are invented commits in invented
  repositories.

## Verification

Run `./scripts/verify.sh` and show the output. Tests run against recorded
fixture payloads, never a live endpoint — a test suite that needs network access
and a valid token is a test suite that stops being run.

Tests to add, named for behavior: maps a commit to a signal, applies the
repository-to-domain map, truncates to the first line of the message, fetches
incrementally from the last sync, backs off on a rate-limit response, reports a
401 without leaking the token, and fetches nothing when no repository is in
scope.

Then confirm by hand that a real question about your recent work produces a
response citing real `activity_ids`, and paste the result.
