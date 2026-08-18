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
  Briefing,
  BriefingRequest,
  ChatRequest,
  ChatResponse,
  DecisionRequest,
  Recommendation,
  StarterPromptsRequest,
  StarterPromptsResponse,
} from "./domain";
import { AttributionError } from "./errors";

function unknown(cited: string[], available: Set<string>): string[] {
  return [...new Set(cited)].filter((id) => !available.has(id)).sort();
}

function validateCitations(
  goalIds: string[],
  principleIds: string[],
  sourceIds: string[],
  request: DecisionRequest | ChatRequest | BriefingRequest,
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

/**
 * Cited signals must exist in the context that was sent.
 *
 * Implements: [HC-CITATIONS-RESOLVE]
 *
 * One direction only, unlike sources. A model is not obliged to cite every
 * signal it was shown, because signals are context rather than support — being
 * told about six commits and mentioning one is normal. The reverse check that
 * `[HC-BIDIRECTIONAL-ATTRIBUTION]` applies to sources would be wrong here, and
 * routing signals through `source_ids` to inherit it would be worse: a commit
 * would start counting as evidence for a principle.
 */
function validateActivityCitations(
  activityIds: string[],
  request: DecisionRequest | ChatRequest | BriefingRequest,
): void {
  if (activityIds.length === 0) {
    return;
  }
  const available = new Set(
    (request.activity_context?.signals ?? []).map((signal) => signal.id),
  );
  const unknownSignals = unknown(activityIds, available);
  if (unknownSignals.length > 0) {
    throw new AttributionError(
      `Recommendation cites unknown activity signals: ${unknownSignals.join(", ")}`,
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
  validateActivityCitations(recommendation.activity_ids, request);
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
  validateActivityCitations(response.activity_ids, request);
}

export function validateBriefing(
  briefing: Briefing,
  request: BriefingRequest,
): void {
  validateCitations(
    briefing.goal_ids,
    briefing.principle_ids,
    briefing.source_ids,
    request,
  );
  validateActivityCitations(briefing.activity_ids, request);
}

/**
 * Starter prompts cite goals and optionally activity, but never principles or
 * sources — they are questions, not answers. Uniqueness is also enforced: three
 * identical suggestions would waste the screen.
 */
export function validateStarterPrompts(
  response: StarterPromptsResponse,
  request: StarterPromptsRequest,
): void {
  const goalSet = new Set(request.goals.map((goal) => goal.id));
  const activitySet = new Set(
    (request.activity_context?.signals ?? []).map((signal) => signal.id),
  );
  for (const item of response.prompts) {
    const unknownGoals = unknown(item.goal_ids, goalSet);
    if (unknownGoals.length > 0) {
      throw new AttributionError(
        `Starter prompt cites unknown goals: ${unknownGoals.join(", ")}`,
      );
    }
    const unknownActivity = unknown(item.activity_ids, activitySet);
    if (unknownActivity.length > 0) {
      throw new AttributionError(
        `Starter prompt cites unknown activity signals: ${unknownActivity.join(", ")}`,
      );
    }
  }
  const questions = response.prompts.map((item) => item.question.toLowerCase());
  if (new Set(questions).size !== questions.length) {
    throw new AttributionError("Starter prompts contain duplicate questions.");
  }
}

export function validateDemoGrounding(
  request: DecisionRequest | ChatRequest | BriefingRequest,
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
