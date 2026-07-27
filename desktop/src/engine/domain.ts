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
 * Accept a real ISO calendar date or an explicit null. The shape check alone is
 * not enough: Python's `date` rejected `2026-99-99` and so must this, or an
 * impossible date reaches the provider as grounded context.
 */
const isoDate = z
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
  }, "must be a real calendar date")
  .nullable()
  .default(null);

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

export const mentorResourcesSchema = z.strictObject({
  profile: mentorProfileSchema,
  sources: z.array(sourceRecordSchema),
  principles: z.array(mentorPrincipleSchema),
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
export type MentorResources = z.infer<typeof mentorResourcesSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type DecisionRequest = z.infer<typeof decisionRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type DecisionResult = z.infer<typeof decisionResultSchema>;
export type ChatResult = z.infer<typeof chatResultSchema>;
