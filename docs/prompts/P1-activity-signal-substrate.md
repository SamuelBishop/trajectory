# P1 — Activity signal substrate

You are working in the Trajectory repository. Build the storage and sync
substrate for observed activity. **This prompt adds no network code and no real
adapter.** It ends with a working, testable pipeline fed by a synthetic fixture.

Read `AGENTS.md`, `docs/methodology/CONSTITUTION.md`, and
`.github/instructions/engine.instructions.md` before starting.

## Why a substrate first

Five adapters that each invent their own storage, retention, and refresh
behavior would be five places to get privacy wrong. Build the shared shape once,
prove it with a fixture, and let the adapters be thin.

## The core type

Adapters never return raw API payloads. They return normalized signals:

```ts
interface ActivitySignal {
  id: string;              // stable, adapter-scoped, lowercase identifier
  integration_id: string;  // "github", "notion", "strava", "manual"
  kind: "code_commit" | "pull_request" | "task" | "workout" | "attention";
  occurred_at: string;     // ISO date
  summary: string;         // one line, already bounded
  domain: string;          // matches Goal.domain
  metrics: Record<string, number>;
  url: string | null;
  provenance: {
    fetched_at: string;
    adapter_version: string;
    account_label: string;
    manually_reviewed: boolean;
  };
}
```

`domain` is load-bearing. It is what lets P2 connect a workout to a running goal
and a commit to the promotion goal with no semantic model — the same
deterministic approach `selection.ts` already uses for goals and principles.

Also define `ActivityRollup`: per integration, per window, the counts, totals,
streaks, and top domains. The rollup is what lets the model see shape without
receiving every record. Signals are the detail; the rollup is the summary. Both
are bounded.

## What to build

**Schemas in `domain.ts`.** `activitySignalSchema`, `activityRollupSchema`, and
their inferred types. These are config-side schemas, so `.optional()` and
`.default()` are allowed — the prohibition applies only to `recommendationSchema`
and `chatResponseSchema`, which go through `zodResponseFormat`. Do not touch
those two here; P2 does.

**A new `desktop/src/engine/integrations/` directory** containing the adapter
interface and nothing that makes a network call yet:

```ts
interface ActivityAdapter {
  readonly id: string;
  readonly version: string;
  readonly hosts: readonly string[];   // exhaustive; empty for offline adapters
  fetch(since: string, credential?: string): Promise<ActivitySignal[]>;
}
```

**An encrypted signal store.** Activity data is at least as sensitive as chat
history, so it follows the same rule: encrypted at rest through the existing
`EncryptionAdapter`, and **no plaintext fallback** when encryption is
unavailable — refuse the write, exactly as `SecretStore` and the chat store
already do (`[HC-NO-PLAINTEXT-HISTORY]`). Support a bounded retention window and
deletion per integration.

**Sync policy configuration**, per integration, supporting all three modes:

```yaml
integrations:
  github:
    enabled: true
    sync: { on_app_load: true, on_demand: true, timer_minutes: 60 }
    quiet_hours: { start: 22, end: 7 }
```

Plus a global pause. The timer is the mode that could turn this into
surveillance, so quiet hours, the pause, and a visible per-integration
last-synced timestamp are part of this prompt, not a later polish pass. A failed
sync is surfaced to the user and never silently retried into a rate-limit ban.

**IPC handlers** in `desktop/src/main/ipc.ts` for listing integrations,
triggering a refresh, reading sync status, and deleting stored signals. Keep the
preload bridge named and narrow — do not add a generic passthrough. Credentials
are write-only from the renderer's perspective, matching the existing
`SecretStore` pattern: the UI may ask whether a credential exists, never what it
is.

**A Settings pane** listing each integration with its enabled state, last-synced
time, signal count, sync-mode controls, and a delete-my-data button.

**One synthetic fixture adapter** that returns invented signals from a local
file. This is the thing that makes P2 testable without network access. Label it
clearly as a fixture so nobody mistakes it for a real source.

## Out of scope

No GitHub, Notion, Strava, or manual-import adapters. No changes to
`DecisionRequest`, `ChatRequest`, prompts, or `validation.ts` — that is all P2.
No proactive notifications.

## Constraints

- `[HC-NO-PLAINTEXT-HISTORY]` — refuse the write rather than degrade.
- `[HC-SECRETS-ENV-ONLY]` — never log or surface a credential, even redacted.
- `[HC-NO-PRIVATE-DATA-COMMITS]` — every fixture is invented. Never commit a real
  commit message, task title, or workout.
- `[HC-EXPLICIT-CONFIG-PATHS]` — take directories as arguments; resolve nothing.
- `[SC-NO-PLACEHOLDERS]` — no stub adapters "to be filled in later." Deferred
  work goes to `FUTURE_ITERATIONS.md`.

## Verification

Run `./scripts/verify.sh` and show the output. Add tests named for behavior:
that the store refuses to write without encryption, that retention drops records
outside the window, that quiet hours suppress a timer sync, that a disabled
integration is never fetched, and that deletion actually removes the data.

The preload bridge changes here, so also run `cd desktop && npm run package`,
open the packaged app, and confirm `window.trajectory` is defined
(`[HC-PRELOAD-CJS]`).
