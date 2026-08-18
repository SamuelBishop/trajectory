/**
 * End-to-end decision-review and chat orchestration.
 *
 * Implements: [HC-CITATIONS-RESOLVE], [HC-BIDIRECTIONAL-ATTRIBUTION],
 * [HC-REFUSE-UNGROUNDED], [HC-NO-SILENT-FALLBACK]
 */

import { loadMentorResources, loadUserConfig } from "./config";
import type {
  ActivitySignal,
  BriefingRequest,
  BriefingResult,
  ChatMessage,
  ChatRequest,
  ChatResult,
  DecisionRequest,
  DecisionResult,
  Goal,
  MentorPrinciple,
  StarterPromptsRequest,
  StarterPromptsResult,
} from "./domain";
import { InsufficientContextError } from "./errors";
import {
  BRIEFING_PROMPT_VERSION,
  CHAT_PROMPT_VERSION,
  PROMPT_VERSION,
  STARTER_PROMPT_VERSION,
} from "./prompting";
import type { MentorProvider } from "./providers/types";
import {
  buildActivityContext,
  buildVoiceContext,
  selectGoals,
  selectPrinciples,
  selectSources,
} from "./selection";
import {
  validateBriefing,
  validateChatResponse,
  validateDemoGrounding,
  validateRecommendation,
  validateStarterPrompts,
} from "./validation";

export interface EngineDirectories {
  readonly userDirectory: string;
  readonly mentorDirectory: string;
}

/**
 * Observed activity, supplied by the caller rather than read here.
 *
 * The engine takes no clock and opens no encrypted store — both belong to the
 * main process, exactly as chat history does. Absent options mean no
 * integration is enabled, which is the normal case.
 */
export interface ActivityInput {
  readonly signals: readonly ActivitySignal[];
  /** ISO calendar date the rollup window ends on. */
  readonly today: string;
}

const HISTORY_LIMIT = 20;
const FALLBACK_LIMIT = 3;

/**
 * A briefing looks at the whole day, but the whole day is not the whole life.
 * More than a handful of goals turns "what should I prioritise" into a list
 * with no priority in it.
 */
const BRIEFING_GOAL_LIMIT = 5;

export async function reviewDecision(
  question: string,
  provider: MentorProvider,
  directories: EngineDirectories,
  activity?: ActivityInput,
): Promise<DecisionResult> {
  const user = await loadUserConfig(directories.userDirectory);
  const resources = await loadMentorResources(directories.mentorDirectory);
  const goals = selectGoals(question, user);
  const principles = selectPrinciples(question, goals, resources);
  const sources = selectSources(principles, resources);
  const voiceContext = resources.voice
    ? buildVoiceContext(question, goals, principles, resources.voice)
    : null;
  const activityContext = activity
    ? buildActivityContext(question, goals, activity.signals, activity.today)
    : null;

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
    voice_context: voiceContext,
    activity_context: activityContext,
    provider: provider.name,
    prompt_version: PROMPT_VERSION,
  };
  validateDemoGrounding(request);
  const recommendation = await provider.generate(request);
  validateRecommendation(recommendation, request);
  return { recommendation, request };
}

/**
 * An unprompted midday check-in.
 *
 * Nobody typed a question, so there is no text to match goals against. Chat
 * falls back to top-priority active goals when a message matches nothing; a
 * briefing starts there, because the whole point is to look at the day as a
 * whole rather than at one topic. Principles are selected against the goals'
 * own text for the same reason.
 *
 * `staleSources` names integrations whose sync failed. They are passed to the
 * model rather than dropped: silence from a broken adapter must not read as
 * evidence that the user did nothing.
 */
export async function dailyBriefing(
  provider: MentorProvider,
  directories: EngineDirectories,
  activity: ActivityInput,
  staleSources: readonly string[] = [],
): Promise<BriefingResult> {
  const user = await loadUserConfig(directories.userDirectory);
  const resources = await loadMentorResources(directories.mentorDirectory);

  const goals = user.goals
    .filter((goal) => goal.status === "active")
    .sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    )
    .slice(0, BRIEFING_GOAL_LIMIT);
  if (goals.length === 0) {
    throw new InsufficientContextError(
      "A briefing requires at least one active goal.",
    );
  }

  // Selection wants a query string. The goals themselves are the subject of a
  // briefing, so their descriptions are the honest query — not an invented
  // sentence.
  const query = goals.map((goal) => goal.description).join(" ");

  let principles: MentorPrinciple[];
  try {
    principles = selectPrinciples(query, goals, resources);
  } catch (error) {
    if (!(error instanceof InsufficientContextError)) {
      throw error;
    }
    principles = [...resources.principles]
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, FALLBACK_LIMIT);
  }
  const sources = selectSources(principles, resources);
  const voiceContext = resources.voice
    ? buildVoiceContext(query, goals, principles, resources.voice)
    : null;
  const activityContext = buildActivityContext(
    query,
    goals,
    activity.signals,
    activity.today,
  );

  const request: BriefingRequest = {
    today: activity.today,
    values: user.values,
    current_state: user.current_state,
    constraints: user.constraints,
    communication: user.communication,
    goals,
    mentor_profile: resources.profile,
    principles,
    sources,
    voice_context: voiceContext,
    activity_context: activityContext,
    stale_sources: [...staleSources],
    provider: provider.name,
    prompt_version: BRIEFING_PROMPT_VERSION,
  };
  validateDemoGrounding(request);
  const briefing = await provider.briefing(request);
  validateBriefing(briefing, request);
  return { briefing, request };
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
  activity?: ActivityInput,
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
  const voiceContext = resources.voice
    ? buildVoiceContext(message, goals, principles, resources.voice)
    : null;
  const activityContext = activity
    ? buildActivityContext(message, goals, activity.signals, activity.today)
    : null;

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
    voice_context: voiceContext,
    activity_context: activityContext,
    provider: provider.name,
    prompt_version: CHAT_PROMPT_VERSION,
  };
  validateDemoGrounding(request);
  const response = await provider.chat(request);
  validateChatResponse(response, request);
  return { response, request };
}

/** How many top-priority active goals to include in starter prompts. */
const STARTER_GOAL_LIMIT = 5;

/**
 * Generate three personalized first-person questions for the Chat starter
 * screen, grounded in the user's goals and recent activity.
 *
 * Deliberately excludes conversation history, mentor prose, and principles —
 * these are questions, not answers, and the model must not shape them from
 * previous assistant output.
 */
export async function generateStarterPrompts(
  provider: MentorProvider,
  directories: EngineDirectories,
  activity?: ActivityInput,
): Promise<StarterPromptsResult> {
  const user = await loadUserConfig(directories.userDirectory);

  const goals = user.goals
    .filter((goal) => goal.status === "active")
    .sort(
      (left, right) =>
        left.priority - right.priority || left.id.localeCompare(right.id),
    )
    .slice(0, STARTER_GOAL_LIMIT);
  if (goals.length === 0) {
    throw new InsufficientContextError(
      "Starter prompts require at least one active goal.",
    );
  }

  const query = goals.map((goal) => goal.description).join(" ");
  const activityContext = activity
    ? buildActivityContext(query, goals, activity.signals, activity.today)
    : null;

  const request: StarterPromptsRequest = {
    current_state: user.current_state,
    constraints: user.constraints,
    goals,
    activity_context: activityContext,
    provider: provider.name,
    prompt_version: STARTER_PROMPT_VERSION,
  };
  const prompts = await provider.starterPrompts(request);
  validateStarterPrompts(prompts, request);
  return { prompts, request };
}
