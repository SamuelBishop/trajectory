/**
 * The arithmetic behind Today.
 *
 * Implements: [SC-NO-PLACEHOLDERS]
 *
 * Pure functions, separated from the components, because every number on the
 * home screen is a claim about the user's life and a wrong one is worse than an
 * absent one. A streak that counts a failed run, or a "synced" dot on a source
 * whose last refresh threw, is exactly the confident-but-wrong output this
 * product exists to avoid — so the derivations are testable on their own.
 *
 * Nothing here is invented. Each function reduces records the app already
 * stores; when the records do not answer the question, the return says so
 * rather than guessing.
 */

import type { BriefingView, IntegrationSummary } from "../../../shared/types";
import type { Health } from "../ui/Card";

export function greetingFor(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** "Good afternoon, Sam" — or just "Good afternoon" when no name is stored. */
export function greetingLine(now: Date, displayName: string): string {
  const name = displayName.trim();
  return name.length === 0 ? greetingFor(now) : `${greetingFor(now)}, ${name}`;
}

/**
 * How long ago something happened, in the coarsest unit that is still true.
 *
 * Returns null rather than a placeholder when there is no usable timestamp:
 * "never synced" is a different statement from "synced a long time ago", and
 * the caller is the only one that knows which sentence it is writing.
 */
export function relativeTime(value: string | null, now: Date): string | null {
  if (value === null) return null;
  const then = Date.parse(value);
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${String(days)}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Local midnight-based date key, matching how briefings are stored. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

function previousDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Consecutive days, most recent first, that produced a briefing.
 *
 * A failed run does not count — it is a record that the app tried, not a record
 * of a day the user showed up. Today not having run yet does not break the
 * streak either: the count starts at yesterday in that case, because zeroing it
 * every morning until noon would make the number meaningless.
 */
export function streakDays(
  records: readonly BriefingView[],
  today: string,
): number {
  const good = new Set(
    records
      .filter((record) => record.briefing !== null && record.error === null)
      .map((record) => record.date),
  );

  let cursor = good.has(today) ? today : previousDay(today);
  let count = 0;
  while (good.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return count;
}

/** Today's record, if there is one. */
export function recordFor(
  records: readonly BriefingView[],
  date: string,
): BriefingView | null {
  return records.find((record) => record.date === date) ?? null;
}

export interface SourceState {
  readonly health: Health;
  readonly label: string;
}

/**
 * What one integration's row says about itself.
 *
 * The order matters. An error outranks a successful earlier sync, because the
 * question the row answers is "can I trust today's briefing", and a source that
 * failed an hour ago is stale no matter how well it worked yesterday.
 */
export function sourceState(
  integration: IntegrationSummary,
  paused: boolean,
): SourceState {
  if (!integration.policy.enabled) {
    return { health: "idle", label: "Off" };
  }
  if (integration.lastError !== null) {
    return { health: "bad", label: "Failed" };
  }
  if (integration.requiresCredential && integration.lastSyncedAt === null) {
    return { health: "idle", label: "Not set up" };
  }
  if (integration.lastSyncedAt === null) {
    return { health: "idle", label: "Never synced" };
  }
  if (paused) {
    return { health: "warn", label: "Paused" };
  }
  if (integration.lastSkippedReason !== undefined) {
    return { health: "warn", label: "Skipped" };
  }
  return { health: "good", label: "Synced" };
}

export function formatConfidence(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

export const ON_TRACK_LABEL: Readonly<Record<string, string>> = {
  yes: "On track",
  partly: "Mostly on track",
  no: "Off track",
  unclear: "Not enough to say",
};

export function onTrackHealth(value: string): Health {
  if (value === "yes") return "good";
  if (value === "partly") return "warn";
  if (value === "no") return "bad";
  return "idle";
}

/**
 * "18 activities" / "1 activity". The plural is passed in rather than derived,
 * because appending "s" turns "activity" into "activitys" and each adapter
 * counts in its own unit.
 */
export function countLabel(
  count: number,
  singular = "record",
  plural = `${singular}s`,
): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

/**
 * A stored date rendered for a human.
 *
 * Constructed as a local date on purpose. `new Date("2026-03-10")` parses as
 * UTC and renders as the 9th for anyone west of Greenwich.
 */
export function formatDate(
  date: string,
  today: string,
  style: "long" | "short" = "long",
): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return date;
  }
  const parsed = new Date(year, month - 1, day);
  const formatted = parsed.toLocaleDateString(
    undefined,
    style === "long"
      ? { weekday: "long", month: "long", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" },
  );
  return date === today ? `Today, ${formatted.replace(/^[^,]+,\s*/, "")}` : formatted;
}

export function formatClock(value: string): string | null {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
