/**
 * The arithmetic behind the conversation list and the evidence panel.
 *
 * Implements: [SC-NO-PLACEHOLDERS]
 *
 * Pure and separated from the components for the same reason as `today/derive`:
 * a wrong timestamp on a conversation ("Yesterday" for something from last
 * month) is a small lie the user has no way to check, and the only defence is a
 * test.
 */

import type { ConversationSummary, Grounding } from "../../../shared/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight, so "yesterday" means the calendar day, not 24 hours ago. */
function startOfDay(value: Date): number {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
  ).getTime();
}

/**
 * How a conversation's last activity reads in the list.
 *
 * Coarsens with age exactly as far as it can while staying unambiguous: a time
 * for today, a name for the last week, a date beyond that. Returns null when
 * the timestamp cannot be parsed, so the row shows nothing rather than
 * "Invalid Date".
 */
export function conversationStamp(value: string, now: Date): string | null {
  const then = Date.parse(value);
  if (Number.isNaN(then)) return null;
  const date = new Date(then);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ConversationGroups {
  readonly recent: readonly ConversationSummary[];
  readonly earlier: readonly ConversationSummary[];
}

/**
 * Split the list into the week just gone and everything before it.
 *
 * Two groups rather than five: the point of the split is to keep this week's
 * threads reachable without scrolling, and a wall of headings defeats that.
 */
export function groupConversations(
  summaries: readonly ConversationSummary[],
  now: Date,
): ConversationGroups {
  const cutoff = startOfDay(now) - 6 * DAY_MS;
  const ordered = [...summaries].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.id.localeCompare(right.id),
  );
  const recent: ConversationSummary[] = [];
  const earlier: ConversationSummary[] = [];
  for (const summary of ordered) {
    const updated = Date.parse(summary.updatedAt);
    // An unparseable timestamp sorts last and lands in "Earlier" rather than
    // claiming the conversation is from this week.
    if (!Number.isNaN(updated) && updated >= cutoff) {
      recent.push(summary);
    } else {
      earlier.push(summary);
    }
  }
  return { recent, earlier };
}

export interface EvidenceCount {
  readonly key: string;
  readonly label: string;
  readonly ids: readonly string[];
}

/**
 * The four counted rows of the evidence panel, in the order they are read.
 *
 * A field the stored message never carried is dropped rather than counted as
 * zero — see `Grounding`. Zero cited activity records is a real answer and is
 * kept; "this message predates activity being recorded" is not.
 */
export function evidenceCounts(grounding: Grounding): EvidenceCount[] {
  const rows: EvidenceCount[] = [
    { key: "goals", label: "Goals", ids: grounding.goalIds },
    { key: "principles", label: "Principles", ids: grounding.principleIds },
  ];
  if (grounding.activityIds !== undefined) {
    rows.push({
      key: "activity",
      label: "Activity records",
      ids: grounding.activityIds,
    });
  }
  rows.push({ key: "sources", label: "Sources", ids: grounding.sourceIds });
  return rows;
}
