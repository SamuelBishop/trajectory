/**
 * Cross-record validation for generated recommendations.
 *
 * Implements: [HC-CITATIONS-RESOLVE], [HC-BIDIRECTIONAL-ATTRIBUTION],
 * [HC-MENTOR-IDENTITY-INTEGRITY]
 *
 * Attribution is checked in both directions on purpose. A one-directional check
 * lets a model cite an impressive-looking source that nothing actually rests on.
 */

import type {
  ChatRequest,
  ChatResponse,
  DecisionRequest,
  Recommendation,
} from "./domain";
import { AttributionError } from "./errors";

function unknown(cited: string[], available: Set<string>): string[] {
  return [...new Set(cited)].filter((id) => !available.has(id)).sort();
}

function validateCitations(
  goalIds: string[],
  principleIds: string[],
  sourceIds: string[],
  request: DecisionRequest | ChatRequest,
): void {
  const unknownGoals = unknown(
    goalIds,
    new Set(request.goals.map((goal) => goal.id)),
  );
  if (unknownGoals.length > 0) {
    throw new AttributionError(
      `Recommendation cites unknown goals: ${unknownGoals.join(", ")}`,
    );
  }

  const principleById = new Map(
    request.principles.map((principle) => [principle.id, principle]),
  );
  const unknownPrinciples = unknown(principleIds, new Set(principleById.keys()));
  if (unknownPrinciples.length > 0) {
    throw new AttributionError(
      `Recommendation cites unknown principles: ${unknownPrinciples.join(", ")}`,
    );
  }

  const unknownSources = unknown(
    sourceIds,
    new Set(request.sources.map((source) => source.id)),
  );
  if (unknownSources.length > 0) {
    throw new AttributionError(
      `Recommendation cites unknown sources: ${unknownSources.join(", ")}`,
    );
  }

  const citedSources = new Set(sourceIds);
  const uncoveredPrinciples = principleIds
    .filter((principleId) => {
      const principle = principleById.get(principleId);
      return !principle?.source_ids.some((id) => citedSources.has(id));
    })
    .sort();
  if (uncoveredPrinciples.length > 0) {
    throw new AttributionError(
      "Recommendation principles have no cited supporting source: " +
        uncoveredPrinciples.join(", "),
    );
  }

  const linkedSources = new Set<string>();
  for (const principleId of principleIds) {
    for (const id of principleById.get(principleId)?.source_ids ?? []) {
      linkedSources.add(id);
    }
  }
  const unlinkedSources = [...citedSources]
    .filter((id) => !linkedSources.has(id))
    .sort();
  if (unlinkedSources.length > 0) {
    throw new AttributionError(
      "Recommendation sources are not linked to a cited principle: " +
        unlinkedSources.join(", "),
    );
  }
}

export function validateRecommendation(
  recommendation: Recommendation,
  request: DecisionRequest,
): void {
  validateCitations(
    recommendation.goal_ids,
    recommendation.principle_ids,
    recommendation.source_ids,
    request,
  );
}

export function validateChatResponse(
  response: ChatResponse,
  request: ChatRequest,
): void {
  validateCitations(
    response.goal_ids,
    response.principle_ids,
    response.source_ids,
    request,
  );
}

export function validateDemoGrounding(
  request: DecisionRequest | ChatRequest,
): void {
  if (!request.mentor_profile.fictional) {
    return;
  }
  if (request.sources.some((source) => !source.synthetic)) {
    throw new AttributionError(
      "Fictional demo mentor may cite only synthetic sources",
    );
  }
  if (
    request.principles.some(
      (principle) => principle.support_type !== "synthetic_demo",
    )
  ) {
    throw new AttributionError(
      "Fictional demo mentor may use only synthetic principles",
    );
  }
}
