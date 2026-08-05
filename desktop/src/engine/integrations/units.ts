/**
 * Distances in the units the athlete thinks in, including for records that were
 * stored before that was true.
 *
 * Implements: [SC-NO-PLACEHOLDERS]
 *
 * Strava reports metres. Converting at ingest means the mentor never has to do
 * arithmetic inside a sentence, where a wrong answer looks exactly like a right
 * one. But activity is kept on disk for as long as the retention window allows,
 * so a build that starts converting leaves months of metre-keyed records behind
 * it — and a rollup that spans the change would show `distance_m` beside
 * `distance_mi`, which is not wrong but is unreadable.
 *
 * So old records are brought forward on read. Deleting and re-syncing would
 * also work and needs no code, but it throws away everything older than the
 * adapter's lookback horizon, which is data the user cannot get back.
 */

import type { ActivitySignal } from "../domain";

export const METRES_PER_MILE = 1609.344;
export const METRES_PER_FOOT = 0.3048;

/**
 * Two decimals, not one.
 *
 * A rollup sums these per-signal values. A mile is roughly 1600 times a metre,
 * so the tenth that was a 10cm rounding error on a metre key would be a 160m
 * error on miles, compounding across every activity in the window.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A metre reading in another unit, or undefined when there is no reading.
 *
 * Undefined rather than NaN, so a caller's "is this a finite number" guard drops
 * a metric the record does not carry instead of storing a number that is not
 * one.
 */
export function inUnitsOf(
  value: unknown,
  metresPerUnit: number,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value / metresPerUnit
    : undefined;
}

/**
 * The integrations that ever wrote metre-keyed metrics.
 *
 * Named explicitly rather than migrating any signal that happens to carry
 * `distance_m`. Google Sheets derives its metric keys from the user's own column
 * headers, so a sheet with a "Distance (m)" column produces exactly that key —
 * and silently converting a number the user typed themselves, in a unit they
 * chose, would be corruption rather than migration.
 */
const METRE_KEYED_INTEGRATIONS = new Set(["strava", "fixture"]);

/** The distance in a summary written by the metre-era adapter: "21.1 km". */
const KILOMETRES_IN_SUMMARY = /(\d+(?:\.\d+)?)\s*km\b/;

/**
 * A stored signal, in imperial units.
 *
 * Idempotent: a signal that has already been migrated carries no metre keys and
 * no "km" in its summary, so it is returned untouched and by reference. That
 * matters because this runs on every read of the store, not once.
 */
export function migrateStoredSignal(signal: ActivitySignal): ActivitySignal {
  if (!METRE_KEYED_INTEGRATIONS.has(signal.integration_id)) {
    return signal;
  }

  const metres = signal.metrics["distance_m"];
  const climbMetres = signal.metrics["elevation_gain_m"];
  const summaryMatch = KILOMETRES_IN_SUMMARY.exec(signal.summary);
  if (
    metres === undefined &&
    climbMetres === undefined &&
    summaryMatch === null
  ) {
    return signal;
  }

  const metrics = { ...signal.metrics };
  if (metres !== undefined) {
    delete metrics["distance_m"];
    metrics["distance_mi"] = round2(metres / METRES_PER_MILE);
  }
  if (climbMetres !== undefined) {
    delete metrics["elevation_gain_m"];
    metrics["elevation_gain_ft"] = round2(climbMetres / METRES_PER_FOOT);
  }

  // The metric is the better source: the summary was already rounded to a tenth
  // of a kilometre when it was written, and re-reading that would round twice.
  // The text is only parsed when the record has no distance metric to work from.
  const summary =
    summaryMatch === null
      ? signal.summary
      : signal.summary.replace(KILOMETRES_IN_SUMMARY, (_whole, shown: string) => {
          const source = metres ?? Number(shown) * 1000;
          return `${(source / METRES_PER_MILE).toFixed(1)} mi`;
        });

  return { ...signal, metrics, summary };
}
