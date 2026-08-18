/**
 * GitHub Copilot SDK provider.
 *
 * Implements: [HC-SDK-BOUNDARY], [HC-NO-PROVIDER-FALLBACK],
 * [HC-SECRETS-ENV-ONLY], [HC-PRIVATE-INPUT-STDIN], [HC-NO-EXFILTRATION]
 *
 * The SDK spawns the Copilot runtime and talks JSON-RPC over stdio, so the
 * user's message never appears in a process argument list. Tools are disabled
 * and permission requests are denied: this session may only produce text.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { sep } from "node:path";

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

/**
 * The runtime reports a missing credential as a plain message on a plain
 * `Error`, so there is no type or code to match on. It is still worth
 * detecting: this is the one failure a user can act on, and the generic
 * message lists four possible causes without saying which.
 *
 * Matching text is brittle, so it only ever *upgrades* the message — an
 * unrecognised failure still gets the generic one, and the cause chain is
 * logged either way.
 */
function isAuthenticationFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    const message = current.message.toLowerCase();
    if (
      message.includes("not created with authentication") ||
      message.includes("unauthorized") ||
      message.includes("authentication failed")
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

const RETRY_INSTRUCTION =
  "Your response failed schema or attribution validation. Return only a corrected " +
  "JSON object. Every principle_id must have at least one cited source_id from " +
  "that principle's source_ids, and every source_id must link to a cited principle.";

export interface CopilotSessionLike {
  readonly sessionId: string;
  sendAndWait(options: { prompt: string }): Promise<
    { readonly type?: string; readonly data?: { readonly content?: string } } | undefined
  >;
}

export interface CopilotAuthStatus {
  readonly isAuthenticated: boolean;
  readonly login?: string | undefined;
}

/** The narrow slice of the Copilot SDK client this provider depends on. */
export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(config: Record<string, unknown>): Promise<CopilotSessionLike>;
  deleteSession(sessionId: string): Promise<void>;
  getAuthStatus?(): Promise<CopilotAuthStatus>;
}

export type CopilotClientFactory = (
  options: Record<string, unknown>,
) => CopilotClientLike;

export interface CopilotProviderOptions {
  readonly model: string;
  readonly githubToken?: string | undefined;
  /** Injected in tests so the SDK boundary can be exercised without a runtime. */
  readonly clientFactory?: CopilotClientFactory | undefined;
  /** Environment handed to the spawned Copilot runtime. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  /** True when the host is Electron, whose `process.execPath` is not Node. */
  readonly hostedByElectron?: boolean | undefined;
  /** Injected in tests; locates the native Copilot runtime binary. */
  readonly runtimeBinaryResolver?: RuntimeBinaryResolver | undefined;
  /**
   * Directory the runtime uses for its own state, and the directory it runs in.
   * Required: `mode: "empty"` refuses without it, and the working directory is
   * what the runtime would otherwise scan for ambient instruction files.
   */
  readonly baseDirectory: string;
}

/**
 * `auto` is the only model guaranteed to exist for every entitlement. Naming a
 * specific model as the default makes the provider fail for anyone without
 * access to it.
 */
export const DEFAULT_COPILOT_MODEL = "auto";

/** The platform packages that ship the native Copilot runtime binary. */
export function copilotRuntimePackages(
  platform: string = process.platform,
  arch: string = process.arch,
): string[] {
  const variants = platform === "linux" ? ["linux", "linuxmusl"] : [platform];
  return variants.map((variant) => `@github/copilot-${variant}-${arch}`);
}

/**
 * Resolve the native Copilot runtime binary.
 *
 * The SDK's default entrypoint is a `.js` file that it launches with
 * `process.execPath`. Under Electron that path is the application binary, so
 * the spawn starts a second copy of the app and never speaks JSON-RPC.
 * `ELECTRON_RUN_AS_NODE` fixes the spawn but not the runtime: its argument
 * parser branches on `process.versions.electron`, which Electron still reports
 * in Node mode, and consumes the script path as a positional argument.
 *
 * Each platform package's default export is the native binary itself, so
 * pointing the SDK at it removes the Node hop and both failure modes with it.
 */
export type RuntimeBinaryResolver = () => string | undefined;

/**
 * An executable cannot be spawned from inside an asar archive — the archive is
 * a file, so the kernel reports ENOTDIR. electron-builder unpacks binaries into
 * a sibling directory; module resolution still reports the archive path, so
 * rewrite it. Returns `undefined` when the path is inside an archive and no
 * unpacked copy exists, because the archive path itself can never be run.
 */
export function unpackedRuntimePath(
  resolved: string,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  const packed = `${sep}app.asar${sep}`;
  if (!resolved.includes(packed)) {
    return resolved;
  }
  const candidate = resolved.replace(packed, `${sep}app.asar.unpacked${sep}`);
  return exists(candidate) ? candidate : undefined;
}

export const resolveBundledRuntimeBinary: RuntimeBinaryResolver = () => {
  const requireFrom = createRequire(import.meta.url);
  for (const packageName of copilotRuntimePackages()) {
    try {
      const spawnable = unpackedRuntimePath(requireFrom.resolve(packageName));
      if (spawnable) {
        return spawnable;
      }
    } catch {
      continue;
    }
  }
  return undefined;
};

export class CopilotProvider implements MentorProvider {
  readonly name = "copilot";

  private readonly model: string;
  private readonly githubToken: string | undefined;
  private readonly clientFactory: CopilotClientFactory | undefined;
  private readonly env: NodeJS.ProcessEnv;
  private readonly hostedByElectron: boolean;
  private readonly runtimeBinaryResolver: RuntimeBinaryResolver;
  private readonly baseDirectory: string;

  constructor(options: CopilotProviderOptions) {
    this.model = options.model;
    this.githubToken = options.githubToken;
    this.clientFactory = options.clientFactory;
    this.env = options.env ?? process.env;
    this.hostedByElectron =
      options.hostedByElectron ?? process.versions.electron !== undefined;
    this.runtimeBinaryResolver =
      options.runtimeBinaryResolver ?? resolveBundledRuntimeBinary;
    this.baseDirectory = options.baseDirectory;
  }

  static fromEnvironment(
    baseDirectory: string,
    env: NodeJS.ProcessEnv = process.env,
  ): CopilotProvider {
    // `??` would let an exported-but-empty COPILOT_MODEL through as a real
    // model name, which the SDK then rejects with an opaque error.
    const model = env.COPILOT_MODEL?.trim();
    return new CopilotProvider({
      model: model ? model : DEFAULT_COPILOT_MODEL,
      githubToken: env.COPILOT_GITHUB_TOKEN,
      baseDirectory,
      env,
    });
  }

  /**
   * Outside Electron the SDK's own runtime resolution is correct, so leave it
   * alone. Inside Electron it is not, and there is no safe fallback: refuse
   * loudly rather than hang.
   */
  private runtimeEnv(): NodeJS.ProcessEnv {
    if (!this.hostedByElectron || this.env.COPILOT_CLI_PATH) {
      return this.env;
    }
    const binary = this.runtimeBinaryResolver();
    if (!binary) {
      throw new ProviderError(
        "The Copilot runtime is missing from this installation. " +
          "Reinstall the application, or set COPILOT_CLI_PATH to a Copilot CLI binary.",
      );
    }
    return { ...this.env, COPILOT_CLI_PATH: binary };
  }

  private async resolveFactory(): Promise<CopilotClientFactory> {
    if (this.clientFactory) {
      return this.clientFactory;
    }
    let sdk: typeof import("@github/copilot-sdk");
    try {
      sdk = await import("@github/copilot-sdk");
    } catch (error) {
      throw new ProviderError(
        "The Copilot SDK could not be loaded. Reinstall the application dependencies.",
        { cause: error },
      );
    }
    return (options) =>
      new sdk.CopilotClient(options) as unknown as CopilotClientLike;
  }

  private clientOptions(): Record<string, unknown> {
    const usesStoredLogin = this.githubToken === undefined;
    return {
      // Empty mode disables the OS credential store inside the SDK. Keep its
      // safer defaults for explicit tokens, but permit Keychain access when a
      // device login is the selected authentication path.
      mode: usesStoredLogin ? "copilot-cli" : "empty",
      baseDirectory: this.baseDirectory,
      workingDirectory: this.baseDirectory,
      logLevel: "error",
      useLoggedInUser: usesStoredLogin,
      env: this.runtimeEnv(),
      ...(this.githubToken ? { gitHubToken: this.githubToken } : {}),
    };
  }

  private async generateStructured<SchemaT extends z.ZodType>(
    systemPrompt: string,
    userMessage: string,
    schema: SchemaT,
    validate: (value: z.infer<SchemaT>) => void,
  ): Promise<z.infer<SchemaT>> {
    const factory = await this.resolveFactory();
    const client = factory(this.clientOptions());

    let session: CopilotSessionLike | undefined;
    try {
      await client.start();
      session = await client.createSession({
        clientName: "trajectory",
        model: this.model,
        // CLI mode is required to read a device-login credential from the OS
        // store. Reproduce empty mode's privacy defaults explicitly so that
        // enabling authentication does not enable ambient context.
        systemMessage: {
          mode: "customize",
          content: systemPrompt,
          sections: { environment_context: { action: "remove" } },
        },
        availableTools: [],
        // `no-result` sends no decision at all and leaves the request pending.
        // Refusing is the point: this session may only produce text.
        onPermissionRequest: () => ({
          kind: "reject",
          feedback: "Trajectory does not grant tool permissions.",
        }),
        skipCustomInstructions: true,
        enableSessionTelemetry: false,
        mcpOAuthTokenStorage: "in-memory",
        skipEmbeddingRetrieval: true,
        embeddingCacheStorage: "in-memory",
        enableOnDemandInstructionDiscovery: false,
        enableFileHooks: false,
        enableHostGitOperations: false,
        enableSessionStore: false,
        enableSkills: false,
        memory: { enabled: false },
        customAgentsLocalOnly: true,
        coauthorEnabled: false,
        manageScheduleEnabled: false,
        streaming: false,
        infiniteSessions: { enabled: false },
      });

      let prompt = userMessage;
      let lastError: ProviderResponseError | AttributionError | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reply = await session.sendAndWait({ prompt });
        const content = reply?.data?.content;
        if (reply?.type !== "assistant.message" || !content) {
          lastError = new ProviderResponseError(
            "Copilot SDK returned no assistant message",
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
        prompt = RETRY_INSTRUCTION;
      }
      throw (
        lastError ??
        new ProviderResponseError("Copilot SDK did not return a recommendation")
      );
    } catch (error) {
      if (
        error instanceof ProviderResponseError ||
        error instanceof AttributionError
      ) {
        throw error;
      }
      if (isAuthenticationFailure(error)) {
        throw new ProviderError(
          "Copilot could not authenticate. Open Settings and sign in with " +
            "GitHub, or store a token there — an app launched from Finder " +
            "inherits no shell environment, so an exported token is invisible " +
            "to it.",
          { cause: error },
        );
      }
      const label =
        error instanceof Error ? error.constructor.name : "UnknownError";
      throw new ProviderError(
        `Copilot SDK request failed (${label}). ` +
          "Check local GitHub authentication, entitlement, model access, " +
          "and organization policy.",
        { cause: error },
      );
    } finally {
      // Cleanup must not replace the error that brought us here — a masked
      // auth or schema failure is much harder to diagnose than a leaked
      // session. Both steps always run, and both failures are swallowed.
      if (session) {
        await client
          .deleteSession(session.sessionId)
          .catch(() => undefined);
      }
      await client.stop().catch(() => undefined);
    }
  }

  /**
   * Ask the runtime whether it can authenticate.
   *
   * Settings needs a truthful answer, and the only authority is the runtime
   * itself: the credential may sit in the system keychain, in COPILOT_HOME, or
   * in an environment variable, and a flag we stored ourselves would go stale
   * the moment any of those changed elsewhere. Costs a runtime start, so call
   * it on demand rather than on every render.
   */
  async authStatus(): Promise<CopilotAuthStatus> {
    const factory = await this.resolveFactory();
    const client = factory(this.clientOptions());
    try {
      await client.start();
      const status = await client.getAuthStatus?.();
      return status ?? { isAuthenticated: false };
    } catch {
      // A runtime that will not start cannot authenticate either, and this is
      // a status probe: report the fact rather than propagating a failure the
      // caller can do nothing with.
      return { isAuthenticated: false };
    } finally {
      await client.stop().catch(() => undefined);
    }
  }

  async generate(request: DecisionRequest): Promise<Recommendation> {
    return await this.generateStructured(
      SYSTEM_PROMPT,
      buildUserMessage(request),
      recommendationSchema,
      (recommendation) => validateRecommendation(recommendation, request),
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return await this.generateStructured(
      CHAT_SYSTEM_PROMPT,
      buildChatUserMessage(request),
      chatResponseSchema,
      (response) => validateChatResponse(response, request),
    );
  }

  async briefing(request: BriefingRequest): Promise<Briefing> {
    return await this.generateStructured(
      BRIEFING_SYSTEM_PROMPT,
      buildBriefingUserMessage(request),
      briefingSchema,
      (briefing) => validateBriefing(briefing, request),
    );
  }

  async starterPrompts(request: StarterPromptsRequest): Promise<StarterPromptsResponse> {
    return await this.generateStructured(
      STARTER_SYSTEM_PROMPT,
      buildStarterPromptsUserMessage(request),
      starterPromptsResponseSchema,
      (response) => validateStarterPrompts(response, request),
    );
  }
}
