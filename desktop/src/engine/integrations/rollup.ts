/**
 * Turn a set of signals into the shape of a window.
 *
 * A mentor that can see one run has nothing useful to say. A mentor that can
 * see nine consecutive training days against a stated recovery constraint does.
 * The rollup is what carries that shape into the prompt without spending the
 * context budget on every individual record.
 */

import type { ActivityRollup, ActivitySignal } from "../domain";

/** Days between two ISO dates, treating both as UTC midnight. */
function daysBetween(earlier: string, later: string): number {
  const from = Date.parse(`${earlier}T00:00:00Z`);
  const to = Date.parse(`${later}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function shiftDate(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Consecutive days ending at `windowEnd` that carry at least one signal.
 *
 * Counting backwards from the end of the window rather than finding the longest
 * run anywhere is deliberate: "you have trained nine days in a row" is a
 * statement about now, and a streak that ended three weeks ago is not the same
 * observation.
 */
function streakEndingAt(days: ReadonlySet<string>, windowEnd: string): number {
  let streak = 0;
  let cursor = windowEnd;
  while (days.has(cursor)) {
    streak += 1;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

export function buildRollup(
  integrationId: string,
  signals: readonly ActivitySignal[],
  windowStart: string,
  windowEnd: string,
): ActivityRollup {
  const inWindow = signals.filter(
    (signal) =>
      signal.integration_id === integrationId &&
      signal.occurred_at >= windowStart &&
      signal.occurred_at <= windowEnd,
  );

  const counts = new Map<string, number>();
  const totals: Record<string, number> = {};
  const days = new Set<string>();

  for (const signal of inWindow) {
    counts.set(signal.domain, (counts.get(signal.domain) ?? 0) + 1);
    days.add(signal.occurred_at);
    for (const [metric, value] of Object.entries(signal.metrics)) {
      totals[metric] = (totals[metric] ?? 0) + value;
    }
  }

  const byDomain = [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    // Ties break alphabetically so the rollup is deterministic, which matters
    // because it lands in a prompt and a reordering would look like a change.
    .sort((left, right) =>
      right.count === left.count
        ? left.domain.localeCompare(right.domain)
        : right.count - left.count,
    );

  return {
    integration_id: integrationId,
    window_start: windowStart,
    window_end: windowEnd,
    signal_count: inWindow.length,
    by_domain: byDomain,
    totals,
    streak_days: streakEndingAt(days, windowEnd),
  };
}

/** The window a rollup should cover, given a retention or reporting horizon. */
export function windowEndingToday(
  days: number,
  today: string,
): { start: string; end: string } {
  return { start: shiftDate(today, -(days - 1)), end: today };
}

export { daysBetween, shiftDate };
