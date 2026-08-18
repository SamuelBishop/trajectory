/**
 * Strict domain schemas for decision review and chat.
 *
 * Implements: [HC-STRICT-SCHEMA-REQUIRED], [HC-OBSERVATION-VS-INFERENCE],
 * [SC-UNCERTAINTY-DECLARED]
 *
 * Response schemas (Recommendation, ChatResponse) are sent to the model through
 * `zodResponseFormat`, which lists every property in `required`. Do not add
 * `.optional()` or `.default()` to a field on those two schemas — under strict
 * structured output that produces a schema the API rejects outright.
 */

import { z } from "zod";

/** Non-empty text, trimmed. */
const text = z.string().trim().min(1);

/** Chat-sized text, bounded so one message cannot blow the context budget. */
const chatText = z.string().trim().min(1).max(12_000);

/** Lowercase slug identifier used for every citable record. */
const identifier = z
  .string()
  .trim()
  .min(1)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "must be lowercase alphanumeric with underscores or hyphens",
  );

/**
 * YAML has no timestamp type in its core schema, so dates arrive as strings.
 * Accept a real ISO calendar date. The shape check alone is not enough:
 * Python's `date` rejected `2026-99-99` and so must this, or an impossible date
 * reaches the provider as grounded context.
 */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [
      number,
      number,
      number,
    ];
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "must be a real calendar date");

/** The same date, where absent is a legitimate answer. */
const isoDate = calendarDate.nullable().default(null);

/**
 * A moment rather than a day. Used for provenance, where "which sync produced
 * this" needs more resolution than a date can carry.
 */
const isoTimestamp = z
  .string()
  .trim()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "must be an ISO timestamp",
  );

const confidence = z.number().min(0).max(1);

export const valuesConfigSchema = z.strictObject({
  core_values: z.array(text).min(1),
  non_negotiables: z.array(text).default([]),
  definitions_of_success: z.array(text).default([]),
  unacceptable_tradeoffs: z.array(text).default([]),
});

export const goalSchema = z.strictObject({
  id: identifier,
  description: text,
  motivation: text,
  priority: z.number().int().min(1).max(5),
  domain: identifier,
  success_criteria: z.array(text).min(1),
  status: z.enum(["active", "paused", "completed", "rejected"]),
  target_date: isoDate,
  tags: z.array(text).default([]),
});

export const goalsConfigSchema = z.strictObject({
  goals: z.array(goalSchema).min(1),
});

export const currentStateConfigSchema = z.strictObject({
  current_role: text,
  responsibilities: z.array(text).default([]),
  current_projects: z.array(text).default([]),
  known_deadlines: z.array(text).default([]),
  current_energy: text,
  recent_progress: z.array(text).default([]),
  unresolved_decisions: z.array(text).default([]),
});

export const constraintsConfigSchema = z.strictObject({
  practical_constraints: z.array(text).default([]),
  protected_commitments: z.array(text).default([]),
});

export const communicationConfigSchema = z.strictObject({
  directness: text,
  warmth: text,
  challenge_level: text,
  tolerance_for_excuses: text,
  uncertainty_style: text,
  verbosity: text,
  use_of_questions: text,
  use_of_evidence: text,
  encourage_when: text,
  critique_when: text,
  prohibited_patterns: z.array(text).min(1),
});

export const userConfigSchema = z.strictObject({
  values: valuesConfigSchema,
  goals: z.array(goalSchema),
  current_state: currentStateConfigSchema,
  constraints: constraintsConfigSchema,
  communication: communicationConfigSchema,
});

export const mentorProfileSchema = z.strictObject({
  id: identifier,
  name: text,
  fictional: z.boolean(),
  description: text,
  domains: z.array(identifier).min(1),
  disclaimer: text,
  body: text,
});

export const sourceRecordSchema = z.strictObject({
  id: identifier,
  title: text,
  creator: text,
  mentor_id: identifier,
  source_type: identifier,
  url: text.nullable().default(null),
  publication_date: isoDate,
  accessed_date: isoDate,
  first_party: z.boolean(),
  approved: z.boolean(),
  copyright_status: identifier,
  synthetic: z.boolean(),
  notes: text,
});

export const sourcesConfigSchema = z.strictObject({
  sources: z.array(sourceRecordSchema).min(1),
});

export const mentorPrincipleSchema = z.strictObject({
  id: identifier,
  mentor_id: identifier,
  name: text,
  description: text,
  domains: z.array(identifier).min(1),
  tags: z.array(text).default([]),
  source_ids: z.array(identifier).min(1),
  support_type: z.enum([
    "explicit",
    "strong_inference",
    "weak_inference",
    "user_defined",
    "synthetic_demo",
  ]),
  confidence,
  interpretation_notes: text,
  possible_limitations: z.array(text).default([]),
  possible_conflicts: z.array(text).default([]),
  review_status: identifier,
});

export const principlesConfigSchema = z.strictObject({
  principles: z.array(mentorPrincipleSchema).min(1),
});

export const voicePatternSchema = z.strictObject({
  id: identifier,
  strength: z.enum(["low", "moderate", "high", "very_high"]),
  instruction: text,
});

export const voiceExampleSchema = z.strictObject({
  id: identifier,
  purpose: identifier,
  tags: z.array(identifier).min(1),
  pattern_ids: z.array(identifier).min(1),
  text,
});

export const voiceSelectionCountSchema = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+-\d+$/, "must be a count or range such as 1-2"),
]);

export const voiceSelectionTierSchema = z.strictObject({
  pattern_count: voiceSelectionCountSchema,
  example_count: voiceSelectionCountSchema,
});

export const voiceConfigSchema = z.strictObject({
  version: z.literal(2),
  mentor_id: identifier,
  purpose: text,
  voice: z.strictObject({
    tone: z.array(text).min(1),
    reader_relationship: text,
    prose: z.array(text).min(1),
    cadence: z.strictObject({
      default_arc: z.array(text).min(1),
      instruction: text,
    }),
  }),
  patterns: z.array(voicePatternSchema).min(1),
  selection: z.strictObject({
    brief: voiceSelectionTierSchema,
    standard: voiceSelectionTierSchema,
    deep: voiceSelectionTierSchema,
    instruction: text,
  }),
  chat: z.array(text).min(1),
  avoid: z.array(text).min(1),
  examples: z.strictObject({
    usage: text,
    items: z.array(voiceExampleSchema).min(1),
  }),
});

export const voiceRuntimePatternSchema = voicePatternSchema;

export const voiceRuntimeExampleSchema = z.strictObject({
  purpose: identifier,
  text,
});

export const voiceRuntimeContextSchema = z.strictObject({
  purpose: text,
  tone: z.array(text).min(1),
  reader_relationship: text,
  prose: z.array(text).min(1),
  cadence: z.strictObject({
    default_arc: z.array(text).min(1),
    instruction: text,
  }),
  depth: z.enum(["brief", "standard", "deep"]),
  selection_instruction: text,
  patterns: z.array(voiceRuntimePatternSchema).min(1),
  chat: z.array(text).min(1),
  avoid: z.array(text).min(1),
  example_usage: text,
  examples: z.array(voiceRuntimeExampleSchema).max(2),
});

export const mentorResourcesSchema = z.strictObject({
  profile: mentorProfileSchema,
  sources: z.array(sourceRecordSchema),
  principles: z.array(mentorPrincipleSchema),
  voice: voiceConfigSchema.optional(),
});

/**
 * Observed activity, normalized by an integration adapter.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE]
 *
 * A signal is evidence about the *user*, which makes it a different kind of
 * record from a `SourceRecord` — that is evidence about the mentor's beliefs.
 * The two are cited through separate fields and must never be merged, or a
 * commit would start counting as support for a principle.
 *
 * Adapters normalize into this shape and never pass raw API payloads outward.
 * `summary` is bounded at the adapter because a commit body or task description
 * is unbounded and occasionally contains a pasted credential.
 */
export const activitySignalKindSchema = z.enum([
  "code_commit",
  "pull_request",
  "task",
  "workout",
  "attention",
]);

export const activityProvenanceSchema = z.strictObject({
  fetched_at: isoTimestamp,
  adapter_version: text,
  account_label: text,
  /** True when a human approved this record through the manual import lane. */
  manually_reviewed: z.boolean().default(false),
});

export const activitySignalSchema = z.strictObject({
  id: identifier,
  integration_id: identifier,
  kind: activitySignalKindSchema,
  occurred_at: calendarDate,
  summary: z.string().trim().min(1).max(280),
  /** Matches `Goal.domain`, which is how selection connects the two. */
  domain: identifier,
  metrics: z.record(z.string(), z.number()).default({}),
  /**
   * Whether the thing this signal describes was finished.
   *
   * `true` was done, `false` was written down and not done, `null` means the
   * question does not apply — a commit is an event, and asking whether it was
   * completed is a category error.
   *
   * Implements: [HC-OBSERVATION-VS-INFERENCE]. Without this field an unfinished
   * task and a finished one are the same record, so storing intent alongside
   * achievement would let "I planned to" be read as "I did". That is the exact
   * confusion `activity_context` exists to prevent, and it cannot be recovered
   * downstream: nothing else in the signal says which one it was.
   */
  completed: z.boolean().nullable().default(null),
  url: text.nullable().default(null),
  provenance: activityProvenanceSchema,
});

/**
 * The shape of a window of activity, so the model can see volume and streaks
 * without receiving every record. Signals are the detail; this is the summary.
 */
export const activityRollupSchema = z.strictObject({
  integration_id: identifier,
  window_start: calendarDate,
  window_end: calendarDate,
  signal_count: z.number().int().min(0),
  /**
   * How many of `signal_count` were finished, and how many were written down
   * and not finished. Counted separately because a plan is not an achievement,
   * and a single total would let a long to-do list read as a productive week.
   */
  completed_count: z.number().int().min(0),
  open_count: z.number().int().min(0),
  /** Signal counts by domain, highest first. */
  by_domain: z.array(
    z.strictObject({ domain: identifier, count: z.number().int().min(0) }),
  ),
  totals: z.record(z.string(), z.number()).default({}),
  /**
   * Consecutive days ending at `window_end` that carry at least one signal
   * which was not merely planned. Writing a task down on a day does not make it
   * a day you did something, and counting it would make the streak — the one
   * number people read as proof of consistency — reward listing over doing.
   */
  streak_days: z.number().int().min(0),
});

/**
 * The activity the model is allowed to see for one question.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE]
 *
 * A sibling of `voice_context` on the request, never merged into
 * `current_state`. `current_state` is what the user claims about themselves;
 * this is what was measured. Keeping them apart is what lets the user reject a
 * conclusion without having to doubt the reading underneath it.
 *
 * Both halves are already bounded by selection. This never carries the store.
 */
export const activityContextSchema = z.strictObject({
  signals: z.array(activitySignalSchema),
  /**
   * How many signals qualified before the cap was applied.
   *
   * Sent always, not only when truncated, because a field that appears only on
   * truncation teaches the model to read its absence as a census — and silence
   * is exactly what went wrong. A model shown twelve of thirty-six commits
   * reported the twelve as the total, then, asked to explain a missing one,
   * offered three causes without knowing that "I was shown a third of them"
   * was among them. A count asserted from a sample is a false statement about
   * the user's own behavior, which is the one thing this context must never
   * produce.
   */
  signals_available: z.number().int().min(0),
  /** One per integration that contributed a selected signal. */
  rollups: z.array(activityRollupSchema),
});

export const chatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: chatText,
});

export const decisionRequestSchema = z.strictObject({
  question: text,
  values: valuesConfigSchema,
  current_state: currentStateConfigSchema,
  constraints: constraintsConfigSchema,
  communication: communicationConfigSchema,
  goals: z.array(goalSchema).min(1),
  mentor_profile: mentorProfileSchema,
  principles: z.array(mentorPrincipleSchema).min(1),
  sources: z.array(sourceRecordSchema).min(1),
  voice_context: voiceRuntimeContextSchema.nullable(),
  activity_context: activityContextSchema.nullable(),
  provider: identifier,
  prompt_version: identifier,
});

export const chatRequestSchema = z.strictObject({
  message: chatText,
  history: z.array(chatMessageSchema).max(20).default([]),
  values: valuesConfigSchema,
  current_state: currentStateConfigSchema,
  constraints: constraintsConfigSchema,
  communication: communicationConfigSchema,
  goals: z.array(goalSchema).min(1),
  mentor_profile: mentorProfileSchema,
  principles: z.array(mentorPrincipleSchema).min(1),
  sources: z.array(sourceRecordSchema).min(1),
  voice_context: voiceRuntimeContextSchema.nullable(),
  activity_context: activityContextSchema.nullable(),
  provider: identifier,
  prompt_version: identifier,
});

/**
 * Sent to the model as a strict response schema. Every field is required by
 * design — see the note at the top of this file.
 */
export const recommendationSchema = z.strictObject({
  assessment: text,
  response: text,
  why_now: text,
  goal_ids: z.array(identifier).min(1),
  principle_ids: z.array(identifier).min(1),
  source_ids: z.array(identifier).min(1),
  /**
   * Signals cited as observations. Required but may be empty — every property
   * of this schema is listed in `required` ([HC-STRICT-SCHEMA-REQUIRED]), and
   * the normal case is that no integration is enabled. A separate lane from
   * `source_ids` on purpose: a commit is evidence about the user, not support
   * for a mentor's principle.
   */
  activity_ids: z.array(identifier),
  observations: z.array(text).min(1),
  inferences: z.array(text).min(1),
  alternatives_considered: z.array(text).min(2),
  suggested_next_step: text,
  confidence,
  uncertainties: z.array(text).min(1),
});

/** Sent to the model as a strict response schema. Every field is required. */
export const chatResponseSchema = z.strictObject({
  answer: chatText,
  goal_ids: z.array(identifier).min(1),
  principle_ids: z.array(identifier).min(1),
  source_ids: z.array(identifier).min(1),
  /** See `recommendationSchema.activity_ids`. Required, may be empty. */
  activity_ids: z.array(identifier),
  observations: z.array(text),
  inferences: z.array(text),
  confidence,
  uncertainties: z.array(text).min(1),
});

export const briefingRequestSchema = z.strictObject({
  /** Local calendar date the briefing covers. */
  today: calendarDate,
  values: valuesConfigSchema,
  current_state: currentStateConfigSchema,
  constraints: constraintsConfigSchema,
  communication: communicationConfigSchema,
  goals: z.array(goalSchema).min(1),
  mentor_profile: mentorProfileSchema,
  principles: z.array(mentorPrincipleSchema).min(1),
  sources: z.array(sourceRecordSchema).min(1),
  voice_context: voiceRuntimeContextSchema.nullable(),
  activity_context: activityContextSchema.nullable(),
  /**
   * Integrations whose sync failed before this briefing was composed. The
   * model is told to treat their absence as unknown rather than as evidence
   * of inactivity, so a failed Strava sync cannot become "you have not
   * trained this week".
   */
  stale_sources: z.array(text),
  provider: identifier,
  prompt_version: identifier,
});

/**
 * Sent to the model as a strict response schema. Every field is required.
 *
 * `headline` is displayed by the operating system, outside this application's
 * encrypted store and potentially on a lock screen. It is a first-class field
 * rather than a slice of `body` because truncating prose would put whatever
 * happened to fall in the first hundred characters onto that screen. Asking
 * for it explicitly lets the prompt constrain what may appear there.
 */
export const briefingSchema = z.strictObject({
  headline: z.string().trim().min(1).max(120),
  body: chatText,
  on_track: z.enum(["yes", "partly", "no", "unclear"]),
  priorities: z.array(text).min(1).max(3),
  watch_out: text,
  goal_ids: z.array(identifier).min(1),
  principle_ids: z.array(identifier).min(1),
  source_ids: z.array(identifier).min(1),
  /** See `recommendationSchema.activity_ids`. Required, may be empty. */
  activity_ids: z.array(identifier),
  observations: z.array(text),
  inferences: z.array(text),
  confidence,
  uncertainties: z.array(text).min(1),
});

export const decisionResultSchema = z.strictObject({
  recommendation: recommendationSchema,
  request: decisionRequestSchema,
});

export const chatResultSchema = z.strictObject({
  response: chatResponseSchema,
  request: chatRequestSchema,
});

export const briefingResultSchema = z.strictObject({
  briefing: briefingSchema,
  request: briefingRequestSchema,
});

/**
 * Starter prompt: a first-person question the user might ask, grounded in
 * their goals and optionally in recent activity. Three are generated each time.
 *
 * Sent to the model as a strict response schema. Every field is required.
 */
export const starterPromptItemSchema = z.strictObject({
  question: z
    .string()
    .trim()
    .min(10)
    .max(200)
    .regex(/\b(?:I|me|my)\b/i, "Starter prompt must be first-person.")
    .endsWith("?"),
  goal_ids: z.array(identifier).min(1),
  activity_ids: z.array(identifier),
});

export const starterPromptsResponseSchema = z.strictObject({
  prompts: z.array(starterPromptItemSchema).length(3),
});

export const starterPromptsRequestSchema = z.strictObject({
  current_state: currentStateConfigSchema,
  constraints: constraintsConfigSchema,
  goals: z.array(goalSchema).min(1),
  activity_context: activityContextSchema.nullable(),
  provider: identifier,
  prompt_version: identifier,
});

export const starterPromptsResultSchema = z.strictObject({
  prompts: starterPromptsResponseSchema,
  request: starterPromptsRequestSchema,
});

export const providerNameSchema = z.enum([
  "deterministic",
  "copilot",
  "openai",
]);

export type ProviderName = z.infer<typeof providerNameSchema>;
export type ValuesConfig = z.infer<typeof valuesConfigSchema>;export type Goal = z.infer<typeof goalSchema>;
export type GoalsConfig = z.infer<typeof goalsConfigSchema>;
export type CurrentStateConfig = z.infer<typeof currentStateConfigSchema>;
export type ConstraintsConfig = z.infer<typeof constraintsConfigSchema>;
export type CommunicationConfig = z.infer<typeof communicationConfigSchema>;
export type UserConfig = z.infer<typeof userConfigSchema>;
export type MentorProfile = z.infer<typeof mentorProfileSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type SourcesConfig = z.infer<typeof sourcesConfigSchema>;
export type MentorPrinciple = z.infer<typeof mentorPrincipleSchema>;
export type PrinciplesConfig = z.infer<typeof principlesConfigSchema>;
export type VoicePattern = z.infer<typeof voicePatternSchema>;
export type VoiceExample = z.infer<typeof voiceExampleSchema>;
export type VoiceSelectionCount = z.infer<typeof voiceSelectionCountSchema>;
export type VoiceSelectionTier = z.infer<typeof voiceSelectionTierSchema>;
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;
export type VoiceRuntimeContext = z.infer<typeof voiceRuntimeContextSchema>;
export type MentorResources = z.infer<typeof mentorResourcesSchema>;
export type ActivitySignalKind = z.infer<typeof activitySignalKindSchema>;
export type ActivityProvenance = z.infer<typeof activityProvenanceSchema>;
export type ActivitySignal = z.infer<typeof activitySignalSchema>;
export type ActivityRollup = z.infer<typeof activityRollupSchema>;
export type ActivityContext = z.infer<typeof activityContextSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type BriefingRequest = z.infer<typeof briefingRequestSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type Briefing = z.infer<typeof briefingSchema>;
export type DecisionResult = z.infer<typeof decisionResultSchema>;
export type ChatResult = z.infer<typeof chatResultSchema>;
export type BriefingResult = z.infer<typeof briefingResultSchema>;
export type StarterPromptItem = z.infer<typeof starterPromptItemSchema>;
export type StarterPromptsResponse = z.infer<typeof starterPromptsResponseSchema>;
export type StarterPromptsRequest = z.infer<typeof starterPromptsRequestSchema>;
export type StarterPromptsResult = z.infer<typeof starterPromptsResultSchema>;
