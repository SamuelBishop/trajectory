import { describe, expect, it } from "vitest";

import type {
  BriefingView,
  IntegrationSummary,
} from "../src/shared/types";
import {
  countLabel,
  greetingLine,
  localDateKey,
  relativeTime,
  sourceState,
  streakDays,
} from "../src/renderer/src/today/derive";

/**
 * Today puts numbers above the fold. Each one is a claim about the user's life,
 * and a confident wrong one is the failure this product exists to avoid — so
 * the reductions behind them are pinned here rather than trusted to a glance at
 * the screen.
 */

function briefing(date: string, ok: boolean): BriefingView {
  return {
    date,
    generatedAt: `${date}T12:00:00.000Z`,
    briefing: ok
      ? {
          headline: "headline",
          body: "body",
          on_track: "yes",
          priorities: ["one"],
          watch_out: "watch",
          goal_ids: ["goal_1"],
          principle_ids: ["principle_1"],
          source_ids: ["source_1"],
          activity_ids: [],
          observations: [],
          inferences: [],
          confidence: 0.8,
          uncertainties: ["something"],
        }
      : null,
    error: ok ? null : "the provider refused",
    staleSources: [],
    notified: false,
  };
}

function integration(
  overrides: Partial<IntegrationSummary> = {},
): IntegrationSummary {
  return {
    id: "github",
    label: "GitHub commits",
    hosts: ["api.github.com"],
    requiresCredential: true,
    policy: {
      enabled: true,
      sync: { on_app_load: true, on_demand: true, timer_minutes: 60 },
      quiet_hours: { start: 0, end: 0 },
      retention_days: 90,
    },
    lastSyncedAt: "2026-08-04T17:00:00.000Z",
    lastError: null,
    signalCount: 12,
    ...overrides,
  };
}

describe("greeting", () => {
  it("drops the name when none is stored rather than inventing one", () => {
    expect(greetingLine(new Date(2026, 7, 4, 14, 0), "")).toBe(
      "Good afternoon",
    );
    expect(greetingLine(new Date(2026, 7, 4, 14, 0), "   ")).toBe(
      "Good afternoon",
    );
  });

  it("uses the stored name and the local hour", () => {
    expect(greetingLine(new Date(2026, 7, 4, 8, 0), "Sam")).toBe(
      "Good morning, Sam",
    );
    expect(greetingLine(new Date(2026, 7, 4, 21, 0), "Sam")).toBe(
      "Good evening, Sam",
    );
  });
});

describe("relative time", () => {
  const now = new Date("2026-08-04T18:00:00.000Z");

  it("says nothing at all when there is no usable timestamp", () => {
    // "never synced" and "synced a long time ago" are different sentences, and
    // only the caller knows which one it is writing.
    expect(relativeTime(null, now)).toBeNull();
    expect(relativeTime("not a date", now)).toBeNull();
  });

  it("reports in the coarsest unit that is still true", () => {
    expect(relativeTime("2026-08-04T17:56:00.000Z", now)).toBe("4m ago");
    expect(relativeTime("2026-08-04T15:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-08-02T18:00:00.000Z", now)).toBe("2d ago");
    expect(relativeTime("2026-08-04T17:59:40.000Z", now)).toBe("just now");
  });
});

describe("day streak", () => {
  it("counts consecutive days that actually produced a briefing", () => {
    const records = [
      briefing("2026-08-04", true),
      briefing("2026-08-03", true),
      briefing("2026-08-02", true),
      briefing("2026-07-31", true),
    ];
    expect(streakDays(records, "2026-08-04")).toBe(3);
  });

  it("does not count a day whose run failed", () => {
    // The record exists so the scheduler stops retrying. It is not evidence the
    // user showed up, and counting it would inflate the only number on this
    // screen that looks like an achievement.
    const records = [
      briefing("2026-08-04", true),
      briefing("2026-08-03", false),
      briefing("2026-08-02", true),
    ];
    expect(streakDays(records, "2026-08-04")).toBe(1);
  });

  it("keeps yesterday's streak visible before today has run", () => {
    const records = [briefing("2026-08-03", true), briefing("2026-08-02", true)];
    expect(streakDays(records, "2026-08-04")).toBe(2);
  });

  it("crosses a month boundary", () => {
    const records = [briefing("2026-08-01", true), briefing("2026-07-31", true)];
    expect(streakDays(records, "2026-08-01")).toBe(2);
  });

  it("is zero when nothing has ever run", () => {
    expect(streakDays([], "2026-08-04")).toBe(0);
  });
});

describe("source state", () => {
  it("reports a failure even when an earlier sync succeeded", () => {
    // The row answers "can I trust today's briefing". A source that threw an
    // hour ago is stale however well it worked yesterday.
    const state = sourceState(
      integration({ lastError: "401 Unauthorized" }),
      false,
    );
    expect(state).toEqual({ health: "bad", label: "Failed" });
  });

  it("distinguishes a source that was never set up from one that is off", () => {
    expect(
      sourceState(integration({ lastSyncedAt: null }), false),
    ).toEqual({ health: "idle", label: "Not set up" });

    expect(
      sourceState(
        integration({
          policy: {
            ...integration().policy,
            enabled: false,
          },
        }),
        false,
      ),
    ).toEqual({ health: "idle", label: "Off" });
  });

  it("shows a healthy source as paused while automatic syncing is off", () => {
    expect(sourceState(integration(), true)).toEqual({
      health: "warn",
      label: "Paused",
    });
  });

  it("surfaces a refresh that chose not to run", () => {
    expect(
      sourceState(integration({ lastSkippedReason: "quiet hours" }), false),
    ).toEqual({ health: "warn", label: "Skipped" });
  });

  it("is healthy only when it synced and nothing went wrong", () => {
    expect(sourceState(integration(), false)).toEqual({
      health: "good",
      label: "Synced",
    });
  });
});

describe("small formatters", () => {
  it("keeps the date key local, so a briefing is not filed a day early", () => {
    // `toISOString().slice(0,10)` on an evening in a western timezone returns
    // tomorrow, which would look up a record that does not exist yet.
    expect(localDateKey(new Date(2026, 7, 4, 22, 30))).toBe("2026-08-04");
  });

  it("agrees with itself about plurals, including the irregular ones", () => {
    expect(countLabel(1)).toBe("1 record");
    expect(countLabel(0)).toBe("0 records");
    expect(countLabel(18, "activity", "activities")).toBe("18 activities");
    expect(countLabel(1, "activity", "activities")).toBe("1 activity");
  });
});
