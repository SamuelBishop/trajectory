/**
 * Turn a set of signals into the shape of a window.
 *
 * A mentor that can see one run has nothing useful to say. A mentor that can
 * see nine consecutive training days against a stated recovery constraint does.
 * The rollup is what carries that shape into the prompt without spending the
 * context budget on every individual record.
 */

import type { ActivityRollup, ActivitySignal } from "../domain";

/**
 * The calendar date in the user's own timezone.
 *
 * `toISOString().slice(0, 10)` is UTC, which is a different day from the user's
 * for part of every evening west of Greenwich — six hours a night in Denver.
 * That is exactly when someone reflects on their day, so "today" would name a
 * day they have not lived yet: today's work would look like tomorrow's, and a
 * streak would break on a day that had not ended.
 *
 * Local getters rather than a locale trick, so what it reads is obvious.
 */
export function localDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, "0");
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
  let completedCount = 0;
  let openCount = 0;

  for (const signal of inWindow) {
    counts.set(signal.domain, (counts.get(signal.domain) ?? 0) + 1);
    if (signal.completed === true) {
      completedCount += 1;
    } else if (signal.completed === false) {
      openCount += 1;
    }
    // Only days that carry something other than an unfinished plan. A day whose
    // sole record is a task you wrote down and did not do is not a day you kept
    // the streak, and counting it would reward writing lists.
    if (signal.completed !== false) {
      days.add(signal.occurred_at);
    }
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
    completed_count: completedCount,
    open_count: openCount,
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
