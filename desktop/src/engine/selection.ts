/**
 * Deterministic relevance selection for the small MVP context.
 *
 * Implements: [HC-REFUSE-UNGROUNDED]
 *
 * Ordering is fully deterministic — score descending, then priority, then id —
 * so the same question against the same config always selects the same context.
 */

import type {
  ActivityContext,
  ActivitySignal,
  Goal,
  MentorPrinciple,
  MentorResources,
  SourceRecord,
  UserConfig,
  VoiceConfig,
  VoiceExample,
  VoicePattern,
  VoiceRuntimeContext,
  VoiceSelectionCount,
} from "./domain";
import { InsufficientContextError } from "./errors";
import { buildRollup, windowEndingToday } from "./integrations/rollup";

const TOKEN_PATTERN = /[a-z0-9]+/g;

const STOP_WORDS = new Set([
  "about",
  "another",
  "could",
  "from",
  "have",
  "into",
  "should",
  "spend",
  "that",
  "this",
  "with",
  "would",
]);

function tokens(value: string): Set<string> {
  const matches = value.toLowerCase().replaceAll("_", " ").match(TOKEN_PATTERN);
  return new Set(
    (matches ?? []).filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function score(queryTokens: Set<string>, values: string[]): number {
  const candidate = tokens(values.join(" "));
  let overlap = 0;
  for (const token of queryTokens) {
    if (candidate.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

export function selectGoals(
  question: string,
  user: UserConfig,
  limit = 3,
): Goal[] {
  const queryTokens = tokens(question);
  const relevant = user.goals
    .filter((goal) => goal.status === "active")
    .map((goal) => ({
      score: score(queryTokens, [
        goal.description,
        goal.motivation,
        goal.domain,
        ...goal.tags,
      ]),
      goal,
    }))
    .filter((entry) => entry.score > 0);

  if (relevant.length === 0) {
    throw new InsufficientContextError(
      "No active goal matched the question. Add relevant terms or tags to goals.yaml.",
    );
  }

  relevant.sort(
    (left, right) =>
      right.score - left.score ||
      left.goal.priority - right.goal.priority ||
      left.goal.id.localeCompare(right.goal.id),
  );
  return relevant.slice(0, limit).map((entry) => entry.goal);
}

export function selectPrinciples(
  question: string,
  goals: Goal[],
  resources: MentorResources,
  limit = 3,
): MentorPrinciple[] {
  const queryTokens = tokens(question);
  for (const token of tokens(goals.map((goal) => goal.domain).join(" "))) {
    queryTokens.add(token);
  }

  const relevant = resources.principles
    .map((principle) => ({
      score: score(queryTokens, [
        principle.name,
        principle.description,
        ...principle.domains,
        ...principle.tags,
      ]),
      principle,
    }))
    .filter((entry) => entry.score > 0);

  if (relevant.length === 0) {
    throw new InsufficientContextError(
      "No mentor principle matched the question and selected goals.",
    );
  }

  relevant.sort(
    (left, right) =>
      right.score - left.score ||
      left.principle.id.localeCompare(right.principle.id),
  );
  return relevant.slice(0, limit).map((entry) => entry.principle);
}

export function selectSources(
  principles: MentorPrinciple[],
  resources: MentorResources,
): SourceRecord[] {
  const sourceIds = new Set(
    principles.flatMap((principle) => principle.source_ids),
  );
  const selected = resources.sources
    .filter((source) => sourceIds.has(source.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (selected.length === 0) {
    throw new InsufficientContextError(
      "Selected principles have no approved sources.",
    );
  }
  return selected;
}

export function selectVoiceExamples(
  message: string,
  goals: Goal[],
  principles: MentorPrinciple[],
  voice: VoiceConfig,
  limit = 2,
  minimum = 0,
): VoiceExample[] {
  if (limit <= 0) {
    return [];
  }
  const queryTokens = voiceQueryTokens(message, goals, principles);

  const cappedLimit = Math.min(limit, 2);
  const ranked = voice.examples.items
    .map((example) => ({
      example,
      score: score(queryTokens, [example.purpose, ...example.tags]),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.example.id.localeCompare(right.example.id),
    );
  const relevant = ranked
    .filter((entry) => entry.score > 0)
    .slice(0, cappedLimit)
    .map((entry) => entry.example);

  if (relevant.length >= minimum) {
    return relevant;
  }

  const selectedIds = new Set(relevant.map((example) => example.id));
  return [
    ...relevant,
    ...ranked
      .map((entry) => entry.example)
      .filter((example) => !selectedIds.has(example.id))
      .slice(0, minimum - relevant.length),
  ].slice(0, cappedLimit);
}

export function selectVoiceDepth(
  message: string,
): "brief" | "standard" | "deep" {
  const messageTokens = tokens(message);
  const deepSignals = [
    "architecture",
    "compare",
    "detailed",
    "evidence",
    "research",
    "strategy",
    "tradeoff",
  ];
  if (
    messageTokens.size >= 35 ||
    deepSignals.some((signal) => messageTokens.has(signal))
  ) {
    return "deep";
  }
  if (messageTokens.size <= 12) {
    return "brief";
  }
  return "standard";
}

export function selectVoicePatterns(
  message: string,
  goals: Goal[],
  principles: MentorPrinciple[],
  voice: VoiceConfig,
  examples: VoiceExample[],
  limit: number,
): VoicePattern[] {
  const queryTokens = voiceQueryTokens(message, goals, principles);
  const examplePatternIds = new Set(
    examples.flatMap((example) => example.pattern_ids),
  );
  const strengthScores: Record<VoicePattern["strength"], number> = {
    low: 1,
    moderate: 2,
    high: 3,
    very_high: 4,
  };

  return voice.patterns
    .map((pattern) => ({
      pattern,
      score:
        score(queryTokens, [pattern.id, pattern.instruction]) +
        strengthScores[pattern.strength] +
        (examplePatternIds.has(pattern.id) ? 3 : 0),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.pattern.id.localeCompare(right.pattern.id),
    )
    .slice(0, limit)
    .map((entry) => entry.pattern);
}

export function buildVoiceContext(
  message: string,
  goals: Goal[],
  principles: MentorPrinciple[],
  voice: VoiceConfig,
): VoiceRuntimeContext {
  const depth = selectVoiceDepth(message);
  const tier = voice.selection[depth];
  const patternRange = countBounds(tier.pattern_count);
  const exampleRange = countBounds(tier.example_count);
  const examples = selectVoiceExamples(
    message,
    goals,
    principles,
    voice,
    exampleRange.maximum,
    exampleRange.minimum,
  );
  const patterns = selectVoicePatterns(
    message,
    goals,
    principles,
    voice,
    examples,
    patternRange.maximum,
  );

  return {
    purpose: voice.purpose,
    tone: voice.voice.tone,
    reader_relationship: voice.voice.reader_relationship,
    prose: voice.voice.prose,
    cadence: voice.voice.cadence,
    depth,
    selection_instruction: voice.selection.instruction,
    patterns,
    chat: voice.chat,
    avoid: voice.avoid,
    example_usage: voice.examples.usage,
    examples: examples.map((example) => ({
      purpose: example.purpose,
      text: example.text,
    })),
  };
}

function voiceQueryTokens(
  message: string,
  goals: Goal[],
  principles: MentorPrinciple[],
): Set<string> {
  const queryTokens = tokens(message);
  for (const token of tokens(
    [
      ...goals.flatMap((goal) => [goal.domain, ...goal.tags]),
      ...principles.flatMap((principle) => [
        ...principle.domains,
        ...principle.tags,
      ]),
    ].join(" "),
  )) {
    queryTokens.add(token);
  }
  return queryTokens;
}

function countBounds(value: VoiceSelectionCount): {
  minimum: number;
  maximum: number;
} {
  if (typeof value === "number") {
    return { minimum: value, maximum: value };
  }
  const [minimum, maximum] = value.split("-").map(Number) as [number, number];
  return { minimum, maximum };
}

/**
 * The most signals any one question may carry.
 *
 * A budget, not a starting point. The mentor's own principles and voice share
 * this context window, and a wall of commits would crowd out the reasoning that
 * makes the answer worth reading.
 */
export const ACTIVITY_SIGNAL_LIMIT = 12;

/** How far back a rollup looks. */
const ACTIVITY_WINDOW_DAYS = 30;

/**
 * Pick the signals worth showing for one message.
 *
 * Two ways in, and recency is neither of them. A signal qualifies by sharing a
 * domain with a selected goal, or by overlapping the message's own words.
 * Recency only orders what already qualified — otherwise yesterday's unrelated
 * commit would displace last week's directly relevant one.
 */
export function selectActivitySignals(
  message: string,
  // Only the domain is read. Saying so keeps the function callable without
  // fabricating a whole Goal, and makes the coupling to `Goal.domain` explicit.
  goals: readonly Pick<Goal, "domain">[],
  signals: readonly ActivitySignal[],
  limit = ACTIVITY_SIGNAL_LIMIT,
): ActivitySignal[] {
  if (limit <= 0 || signals.length === 0) {
    return [];
  }
  const queryTokens = tokens(message);
  const goalDomains = new Set(goals.map((goal) => goal.domain));

  return signals
    .map((signal) => ({
      signal,
      score:
        (goalDomains.has(signal.domain) ? 2 : 0) +
        score(queryTokens, [signal.summary, signal.domain, signal.kind]),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.signal.occurred_at.localeCompare(left.signal.occurred_at) ||
        left.signal.id.localeCompare(right.signal.id),
    )
    .slice(0, limit)
    .map((entry) => entry.signal);
}

/**
 * Assemble the activity half of a request, or null when there is nothing to
 * say.
 *
 * Null rather than an empty scaffold is deliberate: `{signals: [], rollups: []}`
 * reads to a model as "we looked and found nothing," which is a claim about the
 * user. Null says only that no activity was supplied.
 */
export function buildActivityContext(
  message: string,
  goals: readonly Pick<Goal, "domain">[],
  signals: readonly ActivitySignal[],
  today: string,
): ActivityContext | null {
  const selected = selectActivitySignals(message, goals, signals);
  if (selected.length === 0) {
    return null;
  }

  // Rollups are computed over everything stored for the contributing
  // integrations, not just the selected signals. The point of a rollup is the
  // shape of the whole window — a streak counted only over what selection
  // admitted would be an artifact of selection.
  const window = windowEndingToday(ACTIVITY_WINDOW_DAYS, today);
  const integrationIds = [
    ...new Set(selected.map((signal) => signal.integration_id)),
  ].sort();

  return {
    signals: selected,
    rollups: integrationIds.map((integrationId) =>
      buildRollup(integrationId, signals, window.start, window.end),
    ),
  };
}
