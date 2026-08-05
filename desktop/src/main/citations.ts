/**
 * The cited activity records that travel with an answer.
 *
 * Implements: [HC-BIDIRECTIONAL-ATTRIBUTION], [SC-NO-PLACEHOLDERS],
 * [HC-OBSERVATION-VS-INFERENCE]
 *
 * The mentor cites ids. An id is not evidence — `strava_19599421807` tells the
 * reader nothing they can check, and printing it in the prose was closer to a
 * stack trace than to a citation. What makes it evidence is the record behind
 * it: the day it happened and what it was.
 *
 * That join can only happen here. The renderer has the ids but not the records;
 * the activity store has the records but, after retention, may no longer have
 * these ones. This module runs at the one moment both exist — the request that
 * produced the answer — and copies the record into the message, so the citation
 * keeps working for as long as the answer does.
 */

import type { ActivityContext } from "../engine/domain";
import type { Citation } from "../shared/types";

/**
 * Every cited id that the request can actually account for.
 *
 * An id the mentor cited but the request never carried is dropped, not
 * rendered with an empty tooltip and not filled in with a plausible-looking
 * record. The prose keeps saying whatever the mentor said; this list simply
 * does not vouch for it.
 *
 * Order follows the mentor's citation order rather than the context's, because
 * that is the order the reader meets them in the answer. Duplicates collapse:
 * an id cited twice in one sentence is one record.
 */
export function citationsFor(
  activityIds: readonly string[],
  context: ActivityContext | null,
): Citation[] {
  if (context === null) return [];
  const byId = new Map(context.signals.map((signal) => [signal.id, signal]));
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const id of activityIds) {
    const signal = byId.get(id);
    if (signal === undefined || seen.has(id)) continue;
    seen.add(id);
    citations.push({
      id: signal.id,
      integrationId: signal.integration_id,
      occurredAt: signal.occurred_at,
      summary: signal.summary,
      url: signal.url,
    });
  }
  return citations;
}
