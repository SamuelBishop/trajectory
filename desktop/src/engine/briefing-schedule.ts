/**
 * When the daily briefing is due.
 *
 * The decision is a pure function of the clock, the configured time, and the
 * date of the last attempt — deliberately, so that every awkward case is a unit
 * test with no timers in it. `decideSync` in `integrations/policy.ts` has the
 * same shape for the same reason.
 *
 * The caller polls this once a minute rather than arming a single
 * `setTimeout(due - now)`. A long timer is wrong in three ordinary situations:
 * the laptop sleeps through noon and the timer fires late or not at all, the
 * user crosses a timezone, or the system clock is corrected. A poll that asks
 * "is it past the due time, and have I already run today?" is correct through
 * all three, and costs nothing.
 */

import { localDate } from "./integrations/rollup";

/** Noon: the middle of the working day, which is the point of the feature. */
export const DEFAULT_BRIEFING_MINUTE = 12 * 60;

export interface BriefingDecision {
  run: boolean;
  /** Always populated, so the pane can say why nothing has appeared. */
  reason: string;
}

export function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Minutes since local midnight.
 *
 * Local, not UTC. This repository has shipped a UTC/local off-by-one four
 * times; a briefing scheduled for "noon" that arrives at 04:00 would be the
 * fifth, and the most visible.
 */
export function minuteOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function decideBriefing(input: {
  now: Date;
  dueMinute: number;
  lastRunDate: string | null;
  enabled: boolean;
}): BriefingDecision {
  const { now, dueMinute, lastRunDate, enabled } = input;

  if (!enabled) {
    return { run: false, reason: "The daily briefing is turned off." };
  }

  const today = localDate(now);

  // A failed attempt counts as an attempt. Treating it as "not yet run" would
  // make a provider outage retry every sixty seconds until midnight.
  if (lastRunDate === today) {
    return { run: false, reason: "Today's briefing has already run." };
  }

  const current = minuteOfDay(now);
  if (current < dueMinute) {
    return {
      run: false,
      reason: `Not due until ${formatMinuteOfDay(dueMinute)}.`,
    };
  }

  // Deliberately no upper bound on lateness within the day. A briefing at 16:00
  // is still worth having; the same briefing tomorrow morning is not, and that
  // case is already excluded because tomorrow is a different local date and the
  // clock is back before the due time.
  const late = current >= dueMinute + 60;
  return {
    run: true,
    reason: late
      ? `Catching up on the ${formatMinuteOfDay(dueMinute)} briefing.`
      : `Due at ${formatMinuteOfDay(dueMinute)}.`,
  };
}
