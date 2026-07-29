# Activity integration prompts

Eight prompts that give the mentor access to what you actually did, rather than
only what you told it in `current_state.yaml`. Each is self-contained and meant
to be handed to a coding agent on its own.

## Why this exists

Trajectory's advice is currently bounded by self-report. `current_state.yaml` is
accurate the day you write it and stale a week later. These prompts add a second
grounding lane: bounded, citable observations about your real activity.

The point is **discrepancy, not reporting**. The mentor already knows your goals.
Activity data earns its context budget only where it contradicts stated
priority — the promotion is goal one but most commits land on a side project, or
recovery is a hard constraint but the training log shows nine days unbroken. A
dashboard that tells you what you already know is not worth an integration.

## Order

```
P0 ──▶ P1 ──▶ P2 ──┬──▶ P3 ──┬──▶ P4
                   │         └──▶ P6
                   └──▶ P5
       └──▶ P7
```

| Prompt | Builds | Needs network |
| --- | --- | --- |
| [P0](P0-integration-network-boundary.md) | The `[HC-NO-EXFILTRATION]` amendment, proposed for human approval | — |
| [P1](P1-activity-signal-substrate.md) | Signal schemas, encrypted store, sync policy, fixture adapter | No |
| [P2](P2-activity-grounding-path.md) | `activity_context` on requests, selection, citation validation | No |
| [P3](P3-github-commits-adapter.md) | GitHub commit history | Yes |
| [P4](P4-notion-tasks-adapter.md) | Notion task database | Yes |
| [P5](P5-manual-import-lane.md) | Reviewed manual import, Azure DevOps PRs first | No |
| [P6](P6-strava-training-adapter.md) | Strava training log | Yes |
| [P7](P7-screen-time-interface.md) | Attention interface, deliberately no adapter | No |

P1 and P2 ship a synthetic fixture adapter on purpose. The entire
ingest → store → select → prompt → attribution path is proven before a single
real network call exists, so when P3 fails you know the fault is in the adapter
and nowhere else.

P5 and P7 never touch the network and do not depend on the amendment landing.
If P0 stalls in review, those two can still proceed.

## Two invariants that are easy to break

**Activity is a separate grounding lane.** Mentor sources are evidence about the
mentor's beliefs. Activity signals are evidence about you. They are cited
through `activity_ids`, never through `source_ids`. Routing a signal ID into
`source_ids` would let the bidirectional attribution check in `validation.ts`
treat a commit as support for a principle, which quietly defeats
`[HC-BIDIRECTIONAL-ATTRIBUTION]`.

**Observed activity is not self-report.** `activity_context` sits beside
`voice_context` on the request and is never merged into `current_state`. That is
`[HC-OBSERVATION-VS-INFERENCE]`: what you claim, what was measured, and what the
model concluded stay in three separate fields, so you can reject the third
without doubting the second.

## What is deliberately not here

Calendar ingestion, Telegram delivery, intervention policy, proactive
notification, and cross-integration correlation. Those remain in
`FUTURE_ITERATIONS.md`. Screen Time adapters of any kind are out — P7 defines the
interface and explains why nothing implements it.
