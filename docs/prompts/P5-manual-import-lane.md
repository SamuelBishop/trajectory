# P5 — Reviewed manual import lane

You are working in the Trajectory repository. Build a general manual import path
for activity that has no usable API or that should not be fetched
automatically. Azure DevOps pull requests are the first consumer.

Requires P1 and P2. **Does not require P0** — this prompt adds no network code,
so it can proceed while the amendment is still in review.

## Why this is manual on purpose

Azure DevOps has a perfectly good REST API. This adapter deliberately does not
use it.

Pull request data at work is employer data. An automated integration would mean
storing a personal access token scoped to an employer system, authenticating
against that system on a timer, and ingesting titles and repository names that
may be confidential — for a marginal convenience gain over pasting an export
once a week. The organizational risk is real and the technical benefit is small.

So the human stays in the loop: you export, you review what will be stored, and
nothing is written until you approve it. There is no credential to leak, nothing
authenticates against an employer system, and the backlog line "do not add
automatic employer-system ingestion" stays true.

Build it as a **general import lane**, not an Azure-specific one. The same path
later serves any source without a usable API, including manual Screen Time
aggregates.

## What to build

**Input.** Accept a pasted or dropped CSV or JSON file. Parse it into candidate
`ActivitySignal` records using a user-defined column mapping, in the same spirit
as the Notion property mapping in P4. Support the shape an Azure DevOps PR query
exports: PR ID, title, repository, state, created date, closed date, reviewer
count.

**Review screen — the point of the whole prompt.** Before anything is stored,
show a table of every candidate signal and every field that would be written.
Provide per-field redaction toggles, so the user can drop titles and keep
metadata, or drop repository names and keep cycle times. Default titles to
redacted; metadata is the useful signal and titles carry the confidentiality
risk. Show the count of records that will be stored and let the user remove
individual rows.

Nothing reaches the store until the user confirms. A parse failure shows which
row and which column failed, so a broken export is fixable rather than mysterious.

**Provenance.** Set `manually_reviewed: true` and record the import timestamp and
a user-supplied label for the batch. When the mentor cites one of these signals,
the provenance should make clear it was human-approved rather than fetched.

**Idempotency.** Re-importing an overlapping export must not double-count.
Deduplicate on the adapter-scoped signal ID.

## Mapping

- `kind: "pull_request"`
- `occurred_at` — the closed date for completed PRs, the created date otherwise.
- `domain` — user-assigned per import batch, so a work export scores against the
  work goal.
- `metrics` — cycle time in days, reviewer count, revision count. These are the
  fields worth having and the ones with the least confidentiality exposure.
- `url` — omit by default. An internal URL is not useful outside the network and
  identifies internal systems.

## Out of scope

No Azure DevOps API client. No PAT. No `azureDevOpsPat` entry in `SecretName`.
No scheduled or automatic import — this lane is user-initiated by definition, and
its sync policy is on-demand only.

## Constraints

- No network call of any kind. This adapter's declared host list is empty.
- `[HC-NO-PRIVATE-DATA-COMMITS]` — every fixture is an invented export with
  invented PR titles and repository names. Never commit a real export, and never
  paste one into documentation.
- `[SC-NO-PLACEHOLDERS]` — build the review screen for real. An import that
  writes first and shows a summary afterward defeats the entire rationale.

## Verification

Run `./scripts/verify.sh` and show the output.

Tests to add, named for behavior: parses a CSV export into candidate signals,
stores nothing until the import is confirmed, applies per-field redaction before
writing, defaults titles to redacted, deduplicates an overlapping re-import,
reports the failing row and column on a malformed export, and marks stored
signals as manually reviewed.

That second one is the test that matters. Write it first and watch it fail
against an implementation that writes on parse.
