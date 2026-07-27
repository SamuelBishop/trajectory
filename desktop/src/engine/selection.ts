/**
 * Deterministic relevance selection for the small MVP context.
 *
 * Implements: [HC-REFUSE-UNGROUNDED]
 *
 * Ordering is fully deterministic — score descending, then priority, then id —
 * so the same question against the same config always selects the same context.
 */

import type {
  Goal,
  MentorPrinciple,
  MentorResources,
  SourceRecord,
  UserConfig,
} from "./domain";
import { InsufficientContextError } from "./errors";

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
