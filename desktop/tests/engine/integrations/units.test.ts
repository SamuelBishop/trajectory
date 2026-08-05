/**
 * Every signal here is invented ([HC-NO-PRIVATE-DATA-COMMITS]). The point of
 * the file is the read-time migration: a record written by the metre-era
 * adapter has to come back in the same units as one written today, or a rollup
 * spanning the change is unreadable.
 */

import { describe, expect, it } from "vitest";

import { migrateStoredSignal } from "../../../src/engine/integrations/units";
import { activitySignalSchema, type ActivitySignal } from "../../../src/engine/domain";

function stored(overrides: Partial<ActivitySignal> = {}): ActivitySignal {
  return activitySignalSchema.parse({
    id: "strava_9001",
    integration_id: "strava",
    kind: "workout",
    occurred_at: "2026-03-09",
    summary: "Run — 21.1 km in 1h 45m",
    domain: "training",
    completed: null,
    metrics: { distance_m: 21_097.5, elevation_gain_m: 152.4, moving_time_s: 6300 },
    url: null,
    provenance: {
      fetched_at: "2026-03-10T12:00:00.000Z",
      adapter_version: "strava-1",
      account_label: "invented athlete",
      manually_reviewed: false,
    },
    ...overrides,
  });
}

describe("migrateStoredSignal", () => {
  it("brings a metre-era Strava record forward to miles and feet", () => {
    const migrated = migrateStoredSignal(stored());

    expect(migrated.metrics["distance_mi"]).toBe(13.11);
    expect(migrated.metrics["elevation_gain_ft"]).toBe(500);
    expect(migrated.summary).toBe("Run — 13.1 mi in 1h 45m");
  });

  it("removes the metre keys rather than keeping both", () => {
    // Leaving `distance_m` in place would let `buildRollup` sum metres and miles
    // under two headings in the same window, which reads as two workouts' worth
    // of distance for one workout.
    const migrated = migrateStoredSignal(stored());

    expect(migrated.metrics["distance_m"]).toBeUndefined();
    expect(migrated.metrics["elevation_gain_m"]).toBeUndefined();
  });

  it("leaves metrics it does not convert exactly as they were", () => {
    expect(migrateStoredSignal(stored()).metrics["moving_time_s"]).toBe(6300);
  });

  it("is idempotent, because it runs on every read and not once", () => {
    const once = migrateStoredSignal(stored());
    const twice = migrateStoredSignal(once);

    expect(twice).toEqual(once);
    expect(twice).toBe(once);
  });

  it("leaves a Google Sheets record alone even when it carries distance_m", () => {
    // Sheets derives metric keys from the user's own column headers, so a
    // "Distance (m)" column produces `distance_m` legitimately. Converting a
    // number the user typed, in the unit they chose, is corruption.
    const sheet = stored({
      id: "google_sheets_7",
      integration_id: "google_sheets",
      summary: "Row 7 — 5 km tempo",
      metrics: { distance_m: 5000 },
    });

    expect(migrateStoredSignal(sheet)).toBe(sheet);
  });

  it("falls back to the summary text when there is no distance metric", () => {
    const textOnly = stored({ metrics: {}, summary: "Trail run — 10 km" });

    expect(migrateStoredSignal(textOnly).summary).toBe("Trail run — 6.2 mi");
  });

  it("prefers the metric over the rounded text, so it does not round twice", () => {
    // The summary was already rounded to a tenth of a kilometre when it was
    // written. Re-reading that number would compound the error the metric does
    // not have.
    const migrated = migrateStoredSignal(
      stored({ summary: "Run — 21.1 km", metrics: { distance_m: 21_097.5 } }),
    );

    expect(migrated.summary).toBe("Run — 13.1 mi");
  });

  it("returns an untouched record unchanged and by reference", () => {
    const already = stored({
      summary: "Run — 13.1 mi",
      metrics: { distance_mi: 13.11, elevation_gain_ft: 500 },
    });

    expect(migrateStoredSignal(already)).toBe(already);
  });
});
