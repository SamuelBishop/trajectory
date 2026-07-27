/**
 * End-to-end decision-review and chat orchestration.
 *
 * Implements: [HC-CITATIONS-RESOLVE], [HC-BIDIRECTIONAL-ATTRIBUTION],
 * [HC-REFUSE-UNGROUNDED], [HC-NO-SILENT-FALLBACK]
 */

import { loadMentorResources, loadUserConfig } from "./config";
import type {
  ChatMessage,
  ChatRequest,
  ChatResult,
  DecisionRequest,
  DecisionResult,
  Goal,
  MentorPrinciple,
} from "./domain";
import { InsufficientContextError } from "./errors";
import { CHAT_PROMPT_VERSION, PROMPT_VERSION } from "./prompting";
import type { MentorProvider } from "./providers/types";
import { selectGoals, selectPrinciples, selectSources } from "./selection";
import {
  validateChatResponse,
  validateDemoGrounding,
  validateRecommendation,
} from "./validation";

export interface EngineDirectories {
  readonly userDirectory: string;
  readonly mentorDirectory: string;
}

const HISTORY_LIMIT = 20;
const FALLBACK_LIMIT = 3;

export async function reviewDecision(
  question: string,
  provider: MentorProvider,
  directories: EngineDirectories,
): Promise<DecisionResult> {
  const user = await loadUserConfig(directories.userDirectory);
  const resources = await loadMentorResources(directories.mentorDirectory);
  const goals = selectGoals(question, user);
  const principles = selectPrinciples(question, goals, resources);
  const sources = selectSources(principles, resources);

  const request: DecisionRequest = {
    question,
    values: user.values,
    current_state: user.current_state,
    constraints: user.constraints,
    communication: user.communication,
    goals,
    mentor_profile: resources.profile,
    principles,
    sources,
    provider: provider.name,
    prompt_version: PROMPT_VERSION,
  };
  validateDemoGrounding(request);
  const recommendation = await provider.generate(request);
  validateRecommendation(recommendation, request);
  return { recommendation, request };
}

/**
 * Chat is conversational, so a message that matches no goal keyword falls back to
 * the highest-priority active goals rather than refusing. Decision review does not:
 * a formal recommendation must be grounded in a goal the user actually named.
 */
export async function chatWithMentor(
  message: string,
  history: ChatMessage[],
  provider: MentorProvider,
  directories: EngineDirectories,
): Promise<ChatResult> {
  const user = await loadUserConfig(directories.userDirectory);
  const resources = await loadMentorResources(directories.mentorDirectory);

  let goals: Goal[];
  try {
    goals = selectGoals(message, user);
  } catch (error) {
    if (!(error instanceof InsufficientContextError)) {
      throw error;
    }
    goals = user.goals
      .filter((goal) => goal.status === "active")
      .sort(
        (left, right) =>
          left.priority - right.priority || left.id.localeCompare(right.id),
      )
      .slice(0, FALLBACK_LIMIT);
  }
  if (goals.length === 0) {
    throw new InsufficientContextError(
      "Chat requires at least one active goal.",
    );
  }

  let principles: MentorPrinciple[];
  try {
    principles = selectPrinciples(message, goals, resources);
  } catch (error) {
    if (!(error instanceof InsufficientContextError)) {
      throw error;
    }
    principles = [...resources.principles]
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, FALLBACK_LIMIT);
  }
  const sources = selectSources(principles, resources);

  const request: ChatRequest = {
    message,
    history: history.slice(-HISTORY_LIMIT),
    values: user.values,
    current_state: user.current_state,
    constraints: user.constraints,
    communication: user.communication,
    goals,
    mentor_profile: resources.profile,
    principles,
    sources,
    provider: provider.name,
    prompt_version: CHAT_PROMPT_VERSION,
  };
  validateDemoGrounding(request);
  const response = await provider.chat(request);
  validateChatResponse(response, request);
  return { response, request };
}
