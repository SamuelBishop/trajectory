/**
 * Joining the mentor's cited ids to the records it was given.
 *
 * Every signal here is invented ([HC-NO-PRIVATE-DATA-COMMITS]).
 *
 * Under test because this is the only moment both halves of a citation exist.
 * If it drops a record the chip never appears; if it invents one the chip shows
 * evidence that was never in the request.
 */

import { describe, expect, it } from "vitest";

import { citationsFor } from "../src/main/citations";
import type { ActivityContext } from "../src/engine/domain";
import { activitySignalSchema } from "../src/engine/domain";

function signal(overrides: Record<string, unknown> = {}) {
  return activitySignalSchema.parse({
    id: "strava_1",
    integration_id: "strava",
    kind: "workout",
    occurred_at: "2026-08-04",
    summary: "Easy run, 4 mi",
    domain: "training",
    metrics: { distance_mi: 4 },
    url: null,
    provenance: {
      fetched_at: "2026-08-05T12:00:00.000Z",
      adapter_version: "strava-1",
      account_label: "invented athlete",
      manually_reviewed: false,
    },
    ...overrides,
  });
}

function context(...signals: ReturnType<typeof signal>[]): ActivityContext {
  return { signals, signals_available: signals.length, rollups: [] };
}

describe("citationsFor", () => {
  it("copies the record the mentor cited", () => {
    expect(citationsFor(["strava_1"], context(signal()))).toEqual([
      {
        id: "strava_1",
        integrationId: "strava",
        occurredAt: "2026-08-04",
        summary: "Easy run, 4 mi",
        url: null,
      },
    ]);
  });

  it("drops an id the request cannot account for", () => {
    // The prose keeps whatever the mentor wrote. This list simply declines to
    // vouch for an id that was never in the request, rather than rendering a
    // control that opens onto nothing.
    expect(citationsFor(["strava_1", "strava_ghost"], context(signal()))).toHaveLength(
      1,
    );
  });

  it("follows the order the reader meets the ids in, not the context's", () => {
    const ids = citationsFor(
      ["strava_2", "strava_1"],
      context(signal(), signal({ id: "strava_2", occurred_at: "2026-08-01" })),
    ).map((citation) => citation.id);

    expect(ids).toEqual(["strava_2", "strava_1"]);
  });

  it("collapses an id cited twice into one record", () => {
    expect(citationsFor(["strava_1", "strava_1"], context(signal()))).toHaveLength(1);
  });

  it("returns nothing when the request carried no activity at all", () => {
    // Null context means no activity was supplied, which is not the same as
    // looking and finding none — so there is nothing here to cite.
    expect(citationsFor(["strava_1"], null)).toEqual([]);
  });

  it("keeps the record's own link", () => {
    const [citation] = citationsFor(
      ["strava_1"],
      context(signal({ url: "https://example.invalid/activities/1" })),
    );

    expect(citation?.url).toBe("https://example.invalid/activities/1");
  });
});
