import { afterEach, describe, expect, it } from "vitest";

import type { ActivitySignal } from "../../../src/engine/domain";
import {
  buildRollup,
  localDate,
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
    completed: null,
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

  it("counts finished and unfinished work apart", () => {
    // One total would let a long to-do list read as a productive week.
    const rollup = buildRollup(
      "fixture",
      [
        { ...signal("a", "2026-03-10", "career"), completed: true },
        { ...signal("b", "2026-03-10", "career"), completed: false },
        { ...signal("c", "2026-03-10", "career"), completed: false },
        signal("d", "2026-03-10", "career"),
      ],
      "2026-03-04",
      "2026-03-10",
    );

    expect(rollup.signal_count).toBe(4);
    expect(rollup.completed_count).toBe(1);
    expect(rollup.open_count).toBe(2);
  });

  it("does not let a day of unfinished plans hold a streak", () => {
    // Writing a task down is not doing it. The streak is the number people read
    // as proof of consistency, so listing must not be able to keep it alive.
    const rollup = buildRollup(
      "fixture",
      [
        { ...signal("a", "2026-03-10", "career"), completed: false },
        { ...signal("b", "2026-03-09", "career"), completed: true },
      ],
      "2026-03-04",
      "2026-03-10",
    );

    expect(rollup.streak_days).toBe(0);
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

describe("localDate", () => {
  const original = process.env.TZ;
  afterEach(() => {
    process.env.TZ = original;
  });

  it("names the user's day, not UTC's, on a Denver evening", () => {
    process.env.TZ = "America/Denver";
    // 23:11 UTC is 17:11 the same afternoon in Denver. UTC agrees here.
    expect(localDate(new Date("2026-07-29T23:11:00.000Z"))).toBe("2026-07-29");

    // 01:00 UTC is 19:00 the *previous* evening in Denver. This is the case
    // that matters: someone reflecting on their day after dinner would have
    // been told "today" was a day they had not lived yet.
    const evening = new Date("2026-07-30T01:00:00.000Z");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-07-30");
    expect(localDate(evening)).toBe("2026-07-29");
  });

  it("names the user's day east of Greenwich too", () => {
    process.env.TZ = "Asia/Tokyo";
    // 22:00 UTC is 07:00 the next morning in Tokyo.
    const morning = new Date("2026-07-29T22:00:00.000Z");
    expect(morning.toISOString().slice(0, 10)).toBe("2026-07-29");
    expect(localDate(morning)).toBe("2026-07-30");
  });
});
