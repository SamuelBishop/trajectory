/**
 * Versioned prompts and structured response parsing.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE],
 * [HC-MENTOR-IDENTITY-INTEGRITY], [SC-UNCERTAINTY-DECLARED]
 */

import { z } from "zod";

import {
  chatResponseSchema,
  recommendationSchema,
  type ChatRequest,
  type ChatResponse,
  type DecisionRequest,
  type Recommendation,
} from "./domain";
import { ProviderResponseError } from "./errors";

export const PROMPT_VERSION = "decision_v6";
export const CHAT_PROMPT_VERSION = "chat_v6";

/**
 * The rules that keep measured activity from turning into an accusation.
 *
 * Shared verbatim by both prompts so the two cannot drift
 * ([HC-PROVIDER-PARITY] applies to providers; this is the same argument applied
 * to the prompts themselves).
 */
const ACTIVITY_RULES = `When activity_context is present it holds measured activity, not user claims.
Treat every signal as an observation: cite the ones you use in activity_ids and
describe them in observations, never in inferences. A signal may support an
observation but never substitutes for a grounded principle — advice still needs
principle_ids and source_ids. Absent data is not evidence of absent effort: an
empty log means the log is empty, so say that rather than concluding the user
did nothing. Where stated priorities and observed activity disagree, raise it as
a question about whether the reading is complete, not as an accusation. When
activity_context is null, return an empty activity_ids array and do not
speculate about what the user has been doing.
The signals array is a sample, not a census. signals_available says how many
matched before the cap; when it exceeds the number of signals present you are
seeing part of the record, so say the view is partial and never report the
number of signals you can see as the number that exist. For any question about
how many, how often, or how much, answer from rollups, which are counted over
everything stored rather than over what you were shown, and name the window a
rollup covers. If a question asks about a period the rollups do not cover, say
so rather than counting the sample.`;

export const SYSTEM_PROMPT = `You are Trajectory, a candid and calm decision mentor.

Prioritize the user's supplied values, constraints, and goals over mentor principles.
Evaluate opportunity cost. Treat recovery, relationships, health, and leisure as
legitimate priorities. Challenge avoidance or perfectionism only as labeled inference.
Distinguish user statements and observations from model inference. Cite only IDs in
the supplied context. For every principle_id, cite at least one source_id listed in
that principle's source_ids, and cite no source_id that is not linked to a cited
principle. When voice_context is present, use it only to shape sentence construction,
cadence, and response structure; it does not add beliefs or evidence.
Follow its selected depth, patterns, chat guidance, and avoid list. Its examples
demonstrate movement and posture, so never copy their wording. Do not claim to be or
speak for the modeled person, imply their endorsement, quote or reconstruct source
material, make unsupported scientific claims, diagnose health conditions, shame the
user, provide empty praise, expose chain of thought, or manufacture certainty.

${ACTIVITY_RULES}

Return only one JSON object matching the supplied Recommendation schema. Include a
concise rationale, concrete next step, confidence from 0 to 1, and material uncertainty.
`;

export const CHAT_SYSTEM_PROMPT = `You are Trajectory, a candid, calm, and context-aware mentor in an ongoing chat.

Answer the user's current message directly while using the supplied conversation
history, values, constraints, goals, current state, and mentor principles. Prioritize
the user's values over mentor principles. Distinguish observations from inference,
cite only supplied IDs, acknowledge meaningful uncertainty, and preserve user agency.
For every principle_id, cite at least one source_id listed in that principle's
source_ids, and cite no source_id that is not linked to a cited principle. When
voice_context is present, follow it for sentence construction, cadence, and response
structure only; it does not add beliefs or evidence. Match its selected depth, apply
only its selected patterns, honor its chat guidance and avoid list, and never copy
example wording. Do not claim to be or speak for the modeled person, imply their
endorsement, quote or reconstruct source material, diagnose health conditions, shame
the user, provide empty praise, expose chain of thought, or invent evidence.

${ACTIVITY_RULES}

The answer field may use concise GitHub-flavored Markdown for headings, lists,
emphasis, links, quotes, tables, and fenced code. Do not emit raw HTML.

Return only one JSON object matching the supplied ChatResponse schema.
`;

/**
 * Serialize with sorted keys and no whitespace so an identical context always
 * produces an identical prompt.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

export function buildUserMessage(request: DecisionRequest): string {
  const schema = z.toJSONSchema(recommendationSchema);
  return (
    "Recommendation JSON schema:\n" +
    `${canonicalJson(schema)}\n\n` +
    "Decision context:\n" +
    `${canonicalJson(request)}`
  );
}

export function buildChatUserMessage(request: ChatRequest): string {
  const schema = z.toJSONSchema(chatResponseSchema);
  return (
    "ChatResponse JSON schema:\n" +
    `${canonicalJson(schema)}\n\n` +
    "Chat context:\n" +
    `${canonicalJson(request)}`
  );
}

function stripCodeFence(content: string): string {
  let candidate = content.trim();
  if (!candidate.startsWith("```")) {
    return candidate;
  }
  const lines = candidate.split(/\r\n|\r|\n/);
  if (lines.length >= 3 && (lines.at(-1) ?? "").trim() === "```") {
    candidate = lines.slice(1, -1).join("\n");
    if (candidate.trimStart().startsWith("json\n")) {
      candidate = candidate.trimStart().slice(5);
    }
  }
  return candidate;
}

export function parseStructuredResponse<SchemaT extends z.ZodType>(
  content: string,
  schema: SchemaT,
): z.infer<SchemaT> {
  const candidate = stripCodeFence(content);
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch (error) {
    throw new ProviderResponseError(
      `Provider returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => {
        const location = issue.path.join(".");
        return location ? `${location}: ${issue.message}` : issue.message;
      })
      .join("\n");
    throw new ProviderResponseError(
      `Provider response failed schema validation:\n${detail}`,
    );
  }
  return result.data;
}

export function parseRecommendation(content: string): Recommendation {
  return parseStructuredResponse(content, recommendationSchema);
}

export function parseChatResponse(content: string): ChatResponse {
  return parseStructuredResponse(content, chatResponseSchema);
}
