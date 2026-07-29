---
applyTo: "docs/**,README.md,resources/mentors/**,examples/**,*.md"
description: Documentation, mentor content, and attribution
---

> Implements: `[HC-MENTOR-IDENTITY-INTEGRITY]`, `[HC-NO-PRIVATE-DATA-COMMITS]`,
> `[HC-CANON-PRECEDENCE]`, `[HC-ROUTE-DONT-ROOT]`, `[HC-REAL-MISTAKES-ONLY]`,
> `[HC-PROPOSE-NEVER-COMMIT]`, `[SC-NO-PLACEHOLDERS]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

## README

Lines 1 through 479 are the owner's own narrative, supplied verbatim. **Do not
reword, condense, tighten, or "improve" them.** Voice edits there are not a
style preference to be optimized.

Technical content goes in `## Technical appendix` at the end. That is the
section to edit when setup, architecture, or commands change.

## Mentor content

Shipped mentor profiles are fictional and visibly labeled. Principles cite
sources that exist in the approved list; `config.py` rejects the alternative at
load time.

Named living-person communication patterns may be synthesized for an
independently simulated mentor. Ground operational voice guidance in approved
sources, use synthetic non-quoted examples, and keep the profile's disclosure
visible where the output is consumed. Never claim the subject authored the
output, speaks through the app, or endorses the project, and never copy source
material into the profile.

Bundled real-person mentor profiles stay in `FUTURE_ITERATIONS.md` until
independently researched and reviewed. Private local profiles are user data and
must not be committed. Inventing a real person's principles is fabrication
regardless of how plausible it reads.

## Methodology docs

`docs/methodology/CONSTITUTION.md` is canon and supersedes every other file.

- Proposing a rule requires naming the real failure that motivated it. Rules are
  not added for symmetry or completeness.
- A human approves constitution edits. Agents propose.
- Adding or changing a bar means updating `coverage-gaps.md` in the same change,
  honestly — "Not verified" is a legitimate and common answer.
- Loaders and instruction files cite bars; they never define them. If you are
  writing a normative sentence outside the constitution, it belongs in the
  constitution.
- `AGENTS.md` has a 60-line budget. Check `wc -l` after editing it.

## Backlog

`docs/FUTURE_ITERATIONS.md` holds deferred work. Move an item there rather than
deleting it, and rather than leaving a stub in the code (`[SC-NO-PLACEHOLDERS]`).

## Writing

Prose over bullet fragments where an explanation has a shape. Say what a thing
does and what it costs.

Document what exists. A README describing an unimplemented feature is a defect
with a long half-life — it gets believed. When something is a known limitation,
write it down as one.

Never paste real configuration, journal entries, tokens, or personal data into
documentation. Examples are invented.
