import { describe, expect, it } from "vitest";

import {
  DEFAULT_BRIEFING_MINUTE,
  decideBriefing,
  formatMinuteOfDay,
  minuteOfDay,
} from "../../src/engine/briefing-schedule";

/** Local time, deliberately: the whole feature is defined in the user's day. */
function at(date: string, hours: number, minutes = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!, hours, minutes, 0, 0);
}

describe("briefing schedule", () => {
  const enabled = true;
  const dueMinute = DEFAULT_BRIEFING_MINUTE;

  it("defaults to noon", () => {
    expect(DEFAULT_BRIEFING_MINUTE).toBe(720);
    expect(formatMinuteOfDay(DEFAULT_BRIEFING_MINUTE)).toBe("12:00");
  });

  it("does not run before the due time", () => {
    const decision = decideBriefing({
      now: at("2026-03-10", 11, 59),
      dueMinute,
      lastRunDate: null,
      enabled,
    });

    expect(decision.run).toBe(false);
    expect(decision.reason).toContain("12:00");
  });

  it("runs at exactly the due minute", () => {
    expect(
      decideBriefing({
        now: at("2026-03-10", 12, 0),
        dueMinute,
        lastRunDate: null,
        enabled,
      }).run,
    ).toBe(true);
  });

  it("runs after the due time", () => {
    expect(
      decideBriefing({
        now: at("2026-03-10", 12, 1),
        dueMinute,
        lastRunDate: null,
        enabled,
      }).run,
    ).toBe(true);
  });

  it("does not run twice in one day", () => {
    const decision = decideBriefing({
      now: at("2026-03-10", 15, 0),
      dueMinute,
      lastRunDate: "2026-03-10",
      enabled,
    });

    expect(decision.run).toBe(false);
    expect(decision.reason).toMatch(/already run/);
  });

  it("catches up late in the same day when the app was closed at noon", () => {
    // Decision 2 from the plan: a 16:00 briefing is still useful.
    const decision = decideBriefing({
      now: at("2026-03-10", 16, 0),
      dueMinute,
      lastRunDate: "2026-03-09",
      enabled,
    });

    expect(decision.run).toBe(true);
    expect(decision.reason).toMatch(/Catching up/);
  });

  it("does not deliver yesterday's briefing this morning", () => {
    // The other half of decision 2. Opening the laptop at 09:00 after missing
    // yesterday entirely must produce nothing, not a stale briefing about a day
    // that is over.
    const decision = decideBriefing({
      now: at("2026-03-10", 9, 0),
      dueMinute,
      lastRunDate: "2026-03-08",
      enabled,
    });

    expect(decision.run).toBe(false);
    expect(decision.reason).toContain("12:00");
  });

  it("runs the next day once the due time comes round again", () => {
    expect(
      decideBriefing({
        now: at("2026-03-11", 12, 0),
        dueMinute,
        lastRunDate: "2026-03-10",
        enabled,
      }).run,
    ).toBe(true);
  });

  it("never runs while turned off", () => {
    const decision = decideBriefing({
      now: at("2026-03-10", 12, 30),
      dueMinute,
      lastRunDate: null,
      enabled: false,
    });

    expect(decision.run).toBe(false);
    expect(decision.reason).toMatch(/turned off/);
  });

  it("honours a due time other than noon", () => {
    const early = 8 * 60 + 30;

    expect(
      decideBriefing({
        now: at("2026-03-10", 8, 29),
        dueMinute: early,
        lastRunDate: null,
        enabled,
      }).run,
    ).toBe(false);
    expect(
      decideBriefing({
        now: at("2026-03-10", 8, 30),
        dueMinute: early,
        lastRunDate: null,
        enabled,
      }).run,
    ).toBe(true);
  });

  it("reads the clock in local time, not UTC", () => {
    // This repository has shipped a UTC/local off-by-one four times. A briefing
    // that arrives in the small hours would be the fifth and the most visible,
    // so assert against a moment where the two disagree by a whole day.
    const lateEvening = at("2026-03-10", 23, 30);
    expect(minuteOfDay(lateEvening)).toBe(23 * 60 + 30);

    // Already ran today in *local* terms. Read as UTC this instant may fall on
    // the 11th, which would run a second briefing before midnight.
    expect(
      decideBriefing({
        now: lateEvening,
        dueMinute,
        lastRunDate: "2026-03-10",
        enabled,
      }).run,
    ).toBe(false);
  });

  it("always explains itself", () => {
    for (const now of [at("2026-03-10", 9, 0), at("2026-03-10", 13, 0)]) {
      for (const lastRunDate of [null, "2026-03-10"]) {
        for (const isEnabled of [true, false]) {
          const decision = decideBriefing({
            now,
            dueMinute,
            lastRunDate,
            enabled: isEnabled,
          });
          expect(decision.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("formats a minute of day for display", () => {
    expect(formatMinuteOfDay(0)).toBe("00:00");
    expect(formatMinuteOfDay(9 * 60 + 5)).toBe("09:05");
    expect(formatMinuteOfDay(23 * 60 + 59)).toBe("23:59");
  });
});
