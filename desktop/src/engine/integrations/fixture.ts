/**
 * A synthetic adapter that makes the substrate testable with no network.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * This exists so the whole path — ingest, store, retention, selection, prompt,
 * attribution — can be proven before a single real adapter exists. When the
 * GitHub adapter later returns something wrong, the fault is in the adapter and
 * nowhere else, because everything downstream already has a passing test.
 *
 * Every record here is invented. It declares no hosts and makes no call.
 */

import type { ActivitySignal } from "../domain";
import type { ActivityAdapter } from "./types";

export const FIXTURE_INTEGRATION_ID = "fixture";

interface Seed {
  offsetDays: number;
  kind: ActivitySignal["kind"];
  summary: string;
  domain: string;
  metrics: Record<string, number>;
}

/**
 * Shaped to exercise the parts that matter rather than to look realistic: two
 * domains so selection has something to discriminate, a run of consecutive days
 * so the streak calculation has something to find, and metrics on some records
 * but not all.
 */
const SEEDS: readonly Seed[] = [
  {
    offsetDays: 0,
    kind: "code_commit",
    summary: "Add retry handling to the sample importer",
    domain: "engineering",
    metrics: { additions: 120, deletions: 40, files: 3 },
  },
  {
    offsetDays: 1,
    kind: "code_commit",
    summary: "Extract the sample parser into its own module",
    domain: "engineering",
    metrics: { additions: 64, deletions: 88, files: 2 },
  },
  {
    offsetDays: 2,
    kind: "task",
    summary: "Draft the quarterly planning note",
    domain: "engineering",
    metrics: {},
  },
  {
    offsetDays: 3,
    kind: "workout",
    summary: "Easy run, 6.2 mi",
    domain: "training",
    metrics: { distance_mi: 6.21, moving_time_s: 3_180 },
  },
  {
    offsetDays: 4,
    kind: "workout",
    summary: "Interval session, 5 mi",
    domain: "training",
    metrics: { distance_mi: 4.97, moving_time_s: 2_460 },
  },
];

function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

// Not `implements ActivityAdapter`: that type is a union pairing
// `requiresCredential` with `credentialHint`, and a class cannot implement a
// union. `createAdapters` returns `ActivityAdapter[]`, so the pairing is still
// checked — at registration, which is where the registry actually forms.
export class FixtureAdapter {
  readonly id = FIXTURE_INTEGRATION_ID;
  readonly version = "fixture-1";
  readonly hosts: readonly string[] = [];
  readonly label = "Sample data (offline)";
  readonly requiresCredential = false;

  /** Injectable so tests are not coupled to the clock. */
  constructor(private readonly today: () => Date = () => new Date()) {}

  fetch(since: string | null): Promise<ActivitySignal[]> {
    const anchor = this.today().toISOString().slice(0, 10);
    const fetchedAt = this.today().toISOString();

    const signals = SEEDS.map((seed, index) => {
      const occurredAt = shiftDate(anchor, -seed.offsetDays);
      const signal: ActivitySignal = {
        id: `${FIXTURE_INTEGRATION_ID}_${occurredAt.replace(/-/g, "")}_${String(index)}`,
        integration_id: FIXTURE_INTEGRATION_ID,
        kind: seed.kind,
        completed: seed.kind === "task" ? true : null,
        occurred_at: occurredAt,
        summary: seed.summary,
        domain: seed.domain,
        metrics: seed.metrics,
        url: null,
        provenance: {
          fetched_at: fetchedAt,
          adapter_version: this.version,
          account_label: "sample",
          manually_reviewed: false,
        },
      };
      return signal;
    });

    // Honour `since` exactly as a real adapter must, so the incremental-sync
    // path is exercised by the fixture rather than first met in production.
    return Promise.resolve(
      since === null
        ? signals
        : signals.filter((signal) => signal.occurred_at >= since),
    );
  }
}
