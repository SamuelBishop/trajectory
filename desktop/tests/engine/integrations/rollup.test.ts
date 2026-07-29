import { describe, expect, it } from "vitest";

import type { ActivitySignal } from "../../../src/engine/domain";
import {
  buildRollup,
  windowEndingToday,
} from "../../../src/engine/integrations/rollup";

function signal(
  id: string,
  occurredAt: string,
  domain: string,
  metrics: Record<string, number> = {},
): ActivitySignal {
  return {
    id,
    integration_id: "fixture",
    kind: "code_commit",
    occurred_at: occurredAt,
    summary: `Invented record ${id}`,
    domain,
    metrics,
    url: null,
    provenance: {
      fetched_at: "2026-03-10T12:00:00.000Z",
      adapter_version: "test-1",
      account_label: "sample",
      manually_reviewed: false,
    },
  };
}

describe("activity rollup", () => {
  it("counts signals by domain, highest first", () => {
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "engineering"),
        signal("b", "2026-03-09", "engineering"),
        signal("c", "2026-03-08", "training"),
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.signal_count).toBe(3);
    expect(rollup.by_domain).toEqual([
      { domain: "engineering", count: 2 },
      { domain: "training", count: 1 },
    ]);
  });

  it("breaks count ties alphabetically so the prompt is stable", () => {
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "training"),
        signal("b", "2026-03-09", "engineering"),
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.by_domain.map((entry) => entry.domain)).toEqual([
      "engineering",
      "training",
    ]);
  });

  it("sums metrics across signals", () => {
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "training", { distance_m: 10_000 }),
        signal("b", "2026-03-09", "training", { distance_m: 8_000 }),
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.totals).toEqual({ distance_m: 18_000 });
  });

  it("counts a streak backwards from the end of the window", () => {
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "training"),
        signal("b", "2026-03-09", "training"),
        signal("c", "2026-03-08", "training"),
        // A gap at 2026-03-07 ends the streak.
        signal("d", "2026-03-06", "training"),
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.streak_days).toBe(3);
  });

  it("reports no streak when the most recent day is empty", () => {
    const rollup = buildRollup(
      "fixture",
      [signal("a", "2026-03-08", "training")],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.streak_days).toBe(0);
  });

  it("counts a day once however many signals it holds", () => {
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "training"),
        signal("b", "2026-03-10", "engineering"),
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.streak_days).toBe(1);
    expect(rollup.signal_count).toBe(2);
  });

  it("ignores signals outside the window and from other integrations", () => {
    const foreign = { ...signal("x", "2026-03-10", "training"), integration_id: "other" };
    const rollup = buildRollup(
      "fixture",
      [
        signal("a", "2026-03-10", "training"),
        signal("b", "2026-02-01", "training"),
        foreign,
      ],
      "2026-03-01",
      "2026-03-10",
    );
    expect(rollup.signal_count).toBe(1);
  });

  it("computes an inclusive window ending today", () => {
    expect(windowEndingToday(7, "2026-03-10")).toEqual({
      start: "2026-03-04",
      end: "2026-03-10",
    });
  });
});
