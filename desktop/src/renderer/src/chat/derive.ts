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

import type { Citation, ConversationSummary, Grounding } from "../../../shared/types";

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

/**
 * A run of prose, or a bracketed citation that resolved to real records.
 *
 * The mentor writes citations as `[strava_1, strava_2]`. Left as text they are
 * the least readable thing on the screen and the least useful: an id is not
 * evidence, it is a lookup key the reader has no way to look up.
 */
export type ChatSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "citation"; readonly citations: readonly Citation[] };

/**
 * A bracketed group of citation ids: `[strava_1]` or `[strava_1, strava_2]`.
 *
 * Deliberately narrow. Only identifier characters and separators are allowed
 * inside, so ordinary bracketed prose — "[see below]", a markdown link's
 * `[label](url)` — cannot match. The cost of being too eager here is eating
 * text the user wrote; the cost of being too strict is a citation that stays
 * plain, which is what it looks like today.
 */
const CITATION_GROUP = /\[([a-z][a-z0-9_]*(?:\s*,\s*[a-z][a-z0-9_]*)*)\]/gi;

/**
 * Split one run of text into prose and resolved citations.
 *
 * A group becomes a chip only when *every* id in it resolves to a stored
 * record. A partial match would produce a chip that silently drops the ids it
 * could not explain, which reads as though the mentor cited fewer records than
 * it did — so the whole group stays as written instead ([SC-NO-PLACEHOLDERS]).
 *
 * Pure, and separated from the component, because the failure mode is invisible
 * on screen: a splitter that quietly ate a bracket the user typed would look
 * exactly like one that worked.
 */
export function splitCitations(
  text: string,
  citations: readonly Citation[],
): ChatSegment[] {
  if (citations.length === 0) return [{ kind: "text", text }];
  const byId = new Map(citations.map((citation) => [citation.id, citation]));

  const segments: ChatSegment[] = [];
  let cursor = 0;
  // Local, because the regex is stateful and a shared `lastIndex` would make
  // one call's result depend on the previous call's.
  const pattern = new RegExp(CITATION_GROUP.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const ids = (match[1] ?? "").split(",").map((id) => id.trim());
    const resolved = ids.map((id) => byId.get(id));
    if (resolved.some((citation) => citation === undefined)) continue;

    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({
      kind: "citation",
      citations: resolved as Citation[],
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

/**
 * How a citation's date reads on the hover card: "Aug 4, 2026".
 *
 * The year is always shown. A citation can be read months after it was written,
 * and "Aug 4" beside an answer from a different year is a date that looks
 * checkable and is not.
 */
export function citationDate(occurredAt: string): string {
  const parsed = Date.parse(`${occurredAt}T12:00:00`);
  if (Number.isNaN(parsed)) return occurredAt;
  return new Date(parsed).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The cited records that did not appear anywhere in the answer's prose.
 *
 * The mentor's contract is to cite in `activity_ids`, not in the sentence — so
 * an answer that names none of its records inline is correct, not broken, and
 * it is the common case. Making the marks depend on the model choosing to write
 * `[id]` would mean the evidence for an answer appears or vanishes based on
 * phrasing.
 *
 * So whatever the prose did not reference is shown after it instead. Resolution
 * runs through `splitCitations`, the same rule the inline marks use, so a record
 * can never be counted as both referenced and unreferenced.
 */
export function unreferencedCitations(
  content: string,
  citations: readonly Citation[],
): Citation[] {
  const inline = new Set<string>();
  for (const segment of splitCitations(content, citations)) {
    if (segment.kind === "citation") {
      for (const cited of segment.citations) inline.add(cited.id);
    }
  }
  return citations.filter((citation) => !inline.has(citation.id));
}
