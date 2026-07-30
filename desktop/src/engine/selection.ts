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
 *
 * Raised from twelve once the cost was measured rather than guessed: a signal
 * serializes to about 118 tokens, so this is roughly 4.7k — affordable beside
 * the principles and voice, and enough that an ordinary week of commits arrives
 * whole. Twelve silently cut a real week of thirty-six down to a third, and the
 * model counted what it was given. The cap still exists, so `signals_available`
 * still has to travel with the signals.
 */
export const ACTIVITY_SIGNAL_LIMIT = 40;

/**
 * How far back a rollup looks.
 *
 * Two windows rather than one. A month is the right frame for "is this project
 * getting the effort I said it would"; a week is the right frame for "how did
 * this week go", which is the question people actually ask, and the one a
 * training block turns on. With only the month, a week that collapsed was
 * invisible inside four that did not — and a mentor answering a question about
 * this week from a thirty-day count is answering a different question.
 *
 * The short window comes first so the model reads the near frame before the
 * broad one.
 */
const ACTIVITY_WINDOW_DAYS = [7, 30] as const;

/**
 * How recent a signal must be to be shown without matching the question.
 *
 * Recent activity is admitted on its own. Relevance still decides the order,
 * and the cap still decides how many survive, but matching is no longer the
 * price of being seen at all.
 *
 * The earlier rule required a domain or word match to get in, which meant an
 * unmapped repository was not merely hard to interpret — it was absent, and a
 * model cannot reason about what it was never shown. That put the burden of
 * classifying work on the user, in advance, via a hand-written domain map. The
 * model reads the repository name and the commit message and can do that
 * itself. Showing an unrelated commit costs a hundred tokens and is sometimes
 * the point: asking about running while a week of commits sits in view is
 * exactly the discrepancy this app exists to notice.
 */
const ACTIVITY_RECENT_DAYS = 14;

/**
 * Pick the signals worth showing for one message.
 *
 * Three ways in: sharing a domain with a selected goal, overlapping the
 * message's own words, or simply being recent. Score orders them, so a directly
 * relevant older signal still outranks yesterday's unrelated one.
 */
function qualifyingSignals(
  message: string,
  goals: readonly Pick<Goal, "domain">[],
  signals: readonly ActivitySignal[],
  today: string | undefined,
): ActivitySignal[] {
  const queryTokens = tokens(message);
  const goalDomains = new Set(goals.map((goal) => goal.domain));
  // Without a date there is no way to tell recent from old, so fall back to the
  // stricter match-only rule rather than admitting everything.
  const recentFrom =
    today === undefined
      ? null
      : windowEndingToday(ACTIVITY_RECENT_DAYS, today).start;

  return signals
    .map((signal) => ({
      signal,
      score:
        (goalDomains.has(signal.domain) ? 2 : 0) +
        score(queryTokens, [signal.summary, signal.domain, signal.kind]),
      recent: recentFrom !== null && signal.occurred_at >= recentFrom,
    }))
    .filter((entry) => entry.score > 0 || entry.recent)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.signal.occurred_at.localeCompare(left.signal.occurred_at) ||
        left.signal.id.localeCompare(right.signal.id),
    )
    .map((entry) => entry.signal);
}

export function selectActivitySignals(
  message: string,
  // Only the domain is read. Saying so keeps the function callable without
  // fabricating a whole Goal, and makes the coupling to `Goal.domain` explicit.
  goals: readonly Pick<Goal, "domain">[],
  signals: readonly ActivitySignal[],
  options: { readonly today?: string; readonly limit?: number } = {},
): ActivitySignal[] {
  const limit = options.limit ?? ACTIVITY_SIGNAL_LIMIT;
  if (limit <= 0 || signals.length === 0) {
    return [];
  }
  return qualifyingSignals(message, goals, signals, options.today).slice(
    0,
    limit,
  );
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
  const selected = selectActivitySignals(message, goals, signals, { today });
  if (selected.length === 0) {
    return null;
  }

  // Rollups are computed over everything stored for the contributing
  // integrations, not just the selected signals. The point of a rollup is the
  // shape of the whole window — a streak counted only over what selection
  // admitted would be an artifact of selection.
  const integrationIds = [
    ...new Set(selected.map((signal) => signal.integration_id)),
  ].sort();

  return {
    signals: selected,
    // Everything that qualified, not everything stored: the gap this reports is
    // the one between what selection admitted and what the model was handed.
    signals_available: qualifyingSignals(message, goals, signals, today).length,
    // Grouped by integration rather than by window, so the two windows for one
    // integration stay adjacent and a reader compares like with like.
    rollups: integrationIds.flatMap((integrationId) =>
      ACTIVITY_WINDOW_DAYS.map((days) => {
        const window = windowEndingToday(days, today);
        return buildRollup(integrationId, signals, window.start, window.end);
      }),
    ),
  };
}
