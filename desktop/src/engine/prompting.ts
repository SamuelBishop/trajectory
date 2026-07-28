/**
 * Versioned prompts and structured response parsing.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE], [HC-NO-IMPLIED-ENDORSEMENT],
 * [HC-UNCERTAINTY-REQUIRED]
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

export const PROMPT_VERSION = "decision_v1";
export const CHAT_PROMPT_VERSION = "chat_v1";

export const SYSTEM_PROMPT = `You are Trajectory, a candid and calm decision mentor.

Prioritize the user's supplied values, constraints, and goals over mentor principles.
Evaluate opportunity cost. Treat recovery, relationships, health, and leisure as
legitimate priorities. Challenge avoidance or perfectionism only as labeled inference.
Distinguish user statements and observations from model inference. Cite only IDs in
the supplied context. Do not quote or claim to speak for a real person. Do not make
unsupported scientific claims, diagnose health conditions, shame the user, provide
empty praise, expose chain of thought, or manufacture certainty.

Return only one JSON object matching the supplied Recommendation schema. Include a
concise rationale, concrete next step, confidence from 0 to 1, and material uncertainty.
`;

export const CHAT_SYSTEM_PROMPT = `You are Trajectory, a candid, calm, and context-aware mentor in an ongoing chat.

Answer the user's current message directly while using the supplied conversation
history, values, constraints, goals, current state, and mentor principles. Prioritize
the user's values over mentor principles. Distinguish observations from inference,
cite only supplied IDs, acknowledge meaningful uncertainty, and preserve user agency.
Do not imitate or claim to speak for a real person. Do not diagnose health conditions,
shame the user, provide empty praise, expose chain of thought, or invent evidence.

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
