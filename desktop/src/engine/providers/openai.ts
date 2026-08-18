/**
 * OpenAI and OpenAI-compatible structured recommendation provider.
 *
 * Implements: [HC-SDK-BOUNDARY], [HC-NO-SILENT-FALLBACK], [HC-SECRETS-FROM-ENV],
 * [HC-STRICT-SCHEMA-REQUIRED], [HC-NEVER-PRINT-SECRETS]
 */

import type { z } from "zod";

import {
  briefingSchema,
  chatResponseSchema,
  recommendationSchema,
  starterPromptsResponseSchema,
  type Briefing,
  type BriefingRequest,
  type ChatRequest,
  type ChatResponse,
  type DecisionRequest,
  type Recommendation,
  type StarterPromptsRequest,
  type StarterPromptsResponse,
} from "../domain";
import {
  AttributionError,
  ProviderError,
  ProviderResponseError,
} from "../errors";
import {
  BRIEFING_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  STARTER_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildBriefingUserMessage,
  buildChatUserMessage,
  buildStarterPromptsUserMessage,
  buildUserMessage,
  parseStructuredResponse,
} from "../prompting";
import {
  validateBriefing,
  validateChatResponse,
  validateRecommendation,
  validateStarterPrompts,
} from "../validation";
import type { MentorProvider } from "./types";

const RETRY_INSTRUCTION =
  "Your response failed schema or attribution validation. Return only a corrected " +
  "JSON object. Every principle_id must have at least one cited source_id from " +
  "that principle's source_ids, and every source_id must link to a cited principle.";

interface Message {
  readonly role: "system" | "user";
  readonly content: string;
}

interface CompletionChoice {
  readonly message?: { readonly content?: string | null } | null;
}

/** The narrow slice of the OpenAI client this provider depends on. */
export interface CompletionClient {
  readonly chat: {
    readonly completions: {
      create(params: Record<string, unknown>): Promise<{
        readonly choices: readonly CompletionChoice[];
      }>;
    };
  };
}

export interface OpenAIProviderOptions {
  readonly model: string;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  /** Injected in tests so the SDK boundary can be exercised without network access. */
  readonly client?: CompletionClient | undefined;
}

export class OpenAICompatibleProvider implements MentorProvider {
  readonly name = "openai";

  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string | undefined;
  private client: CompletionClient | undefined;

  constructor(options: OpenAIProviderOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.client = options.client;
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
  ): OpenAICompatibleProvider {
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL;
    if (!apiKey) {
      throw new ProviderError(
        "OPENAI_API_KEY is required for the OpenAI provider",
      );
    }
    if (!model) {
      throw new ProviderError(
        "OPENAI_MODEL is required for the OpenAI provider",
      );
    }
    return new OpenAICompatibleProvider({
      model,
      apiKey,
      baseUrl: env.OPENAI_BASE_URL,
    });
  }

  private async resolveClient(): Promise<CompletionClient> {
    if (this.client) {
      return this.client;
    }
    let sdk: typeof import("openai");
    try {
      sdk = await import("openai");
    } catch (error) {
      throw new ProviderError(
        "The OpenAI SDK could not be loaded. Reinstall the application dependencies.",
        { cause: error },
      );
    }
    this.client = new sdk.OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    }) as unknown as CompletionClient;
    return this.client;
  }

  /**
   * Non-OpenAI endpoints frequently reject `json_schema`, so they get plain JSON
   * mode. The response is validated identically either way.
   */
  private async responseFormat(
    schema: z.ZodType,
    schemaName: string,
  ): Promise<unknown> {
    if (this.baseUrl && !this.baseUrl.includes("api.openai.com")) {
      return { type: "json_object" };
    }
    const { zodResponseFormat } = await import("openai/helpers/zod");
    return zodResponseFormat(schema as never, schemaName);
  }

  private async generateStructured<SchemaT extends z.ZodType>(
    systemPrompt: string,
    userMessage: string,
    schema: SchemaT,
    schemaName: string,
    validate: (value: z.infer<SchemaT>) => void,
  ): Promise<z.infer<SchemaT>> {
    const client = await this.resolveClient();
    const responseFormat = await this.responseFormat(schema, schemaName);

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
    let lastError: ProviderResponseError | AttributionError | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: { readonly choices: readonly CompletionChoice[] };
      try {
        response = await client.chat.completions.create({
          model: this.model,
          messages: [...messages],
          response_format: responseFormat,
          temperature: 0,
        });
      } catch (error) {
        const label =
          error instanceof Error ? error.constructor.name : "UnknownError";
        throw new ProviderError(
          `OpenAI-compatible request failed (${label}). ` +
            "Check the API key, model, endpoint, and account access.",
          { cause: error },
        );
      }

      const content = response.choices[0]?.message?.content;
      if (response.choices.length === 0) {
        lastError = new ProviderResponseError(
          "OpenAI provider returned no completion choices",
        );
      } else if (!content) {
        lastError = new ProviderResponseError(
          "OpenAI provider returned no content",
        );
      } else {
        try {
          const parsed = parseStructuredResponse(content, schema);
          validate(parsed);
          return parsed;
        } catch (error) {
          if (
            !(error instanceof ProviderResponseError) &&
            !(error instanceof AttributionError)
          ) {
            throw error;
          }
          lastError = error;
        }
      }
      if (attempt === 0) {
        messages.push({ role: "user", content: RETRY_INSTRUCTION });
      }
    }

    throw (
      lastError ??
      new ProviderResponseError(
        "OpenAI provider did not return structured output",
      )
    );
  }

  async generate(request: DecisionRequest): Promise<Recommendation> {
    return await this.generateStructured(
      SYSTEM_PROMPT,
      buildUserMessage(request),
      recommendationSchema,
      "trajectory_recommendation",
      (recommendation) => validateRecommendation(recommendation, request),
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return await this.generateStructured(
      CHAT_SYSTEM_PROMPT,
      buildChatUserMessage(request),
      chatResponseSchema,
      "trajectory_chat_response",
      (response) => validateChatResponse(response, request),
    );
  }

  async briefing(request: BriefingRequest): Promise<Briefing> {
    return await this.generateStructured(
      BRIEFING_SYSTEM_PROMPT,
      buildBriefingUserMessage(request),
      briefingSchema,
      "trajectory_briefing",
      (briefing) => validateBriefing(briefing, request),
    );
  }

  async starterPrompts(request: StarterPromptsRequest): Promise<StarterPromptsResponse> {
    return await this.generateStructured(
      STARTER_SYSTEM_PROMPT,
      buildStarterPromptsUserMessage(request),
      starterPromptsResponseSchema,
      "trajectory_starter_prompts",
      (response) => validateStarterPrompts(response, request),
    );
  }
}
