# P4 — Notion tasks adapter

You are working in the Trajectory repository. Add the Notion task integration,
following the pattern established by the GitHub adapter in P3.

Requires P0, P1, P2, and P3.

## What Notion gives you

Notion's API is database-shaped rather than feed-shaped, which is convenient: a
task database query returns exactly the records you want with typed properties,
so mapping is mechanical rather than heuristic.

- `POST https://api.notion.com/v1/databases/{database_id}/query`
- Requires the `Notion-Version` header. Pin an explicit version; the API breaks
  across versions and an unpinned client fails at the worst time.
- Auth is an internal integration token, `Bearer`.
- Paginate with `start_cursor` and `has_more`.

**The setup gotcha worth documenting:** creating the integration is not enough.
The user must explicitly share the target database with it through Notion's UI,
or every query returns an empty result with no error explaining why. Surface this
as a specific message when a query succeeds but returns nothing on first sync —
"the database may not be shared with the integration" is far more useful than an
empty list.

## Configuration and mapping

The user supplies the database ID and maps their own property names, because
nobody's task database uses the same schema. At minimum: which property is the
status, which is the due date, which is the completion timestamp, and which
optional property carries the domain.

One signal per task:

- `kind: "task"`
- `summary` — the task title, truncated.
- `occurred_at` — the completion date for finished tasks, the due date for open
  ones.
- `domain` — from the mapped property, defaulting to a user-configured value.
- `metrics` — leave sparse. A task is an event, not a measurement.

Fetch completed tasks by default rather than the whole board. Open tasks are a
to-do list; completed tasks are evidence of what actually happened, which is what
the mentor needs. Let the user opt into open tasks for commitment load.

## Credential

Add `notionToken` to the `SecretName` union in `desktop/src/main/secrets.ts`.
Reuse `SecretStore` unchanged — it is already encrypted, already write-only from
the renderer, and already refuses to store anything when encryption is
unavailable.

## Constraints

- Declare `api.notion.com` as this adapter's exhaustive host list.
- Ingress-only. The query body carries a filter, a sort, and a cursor. It never
  carries goals, values, or message text.
- `[HC-SECRETS-ENV-ONLY]` — no token in logs, errors, or UI strings.
- `[HC-NO-PRIVATE-DATA-COMMITS]` — fixtures are invented tasks. Real task titles
  are personal data.
- Incremental sync from the last `fetched_at`.

## Verification

Run `./scripts/verify.sh` and show the output. Tests against recorded fixtures,
never a live endpoint.

Tests to add, named for behavior: maps a completed task to a signal, resolves
user-configured property names, paginates through a multi-page response, sends
the pinned `Notion-Version` header, reports the unshared-database case
distinguishably from a genuinely empty database, and prefers completion date over
due date when both exist.
