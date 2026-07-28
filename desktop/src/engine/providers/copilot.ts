/**
 * GitHub Copilot SDK provider.
 *
 * Implements: [HC-SDK-BOUNDARY], [HC-NO-SILENT-FALLBACK], [HC-SECRETS-FROM-ENV],
 * [HC-PRIVATE-INPUT-STDIN], [HC-NEVER-PRINT-SECRETS]
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
  chatResponseSchema,
  recommendationSchema,
  type ChatRequest,
  type ChatResponse,
  type DecisionRequest,
  type Recommendation,
} from "../domain";
import { ProviderError, ProviderResponseError } from "../errors";
import {
  CHAT_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildChatUserMessage,
  buildUserMessage,
  parseStructuredResponse,
} from "../prompting";
import type { MentorProvider } from "./types";

const RETRY_INSTRUCTION =
  "Your response was not valid against the supplied schema. " +
  "Return only a corrected JSON object.";

export interface CopilotSessionLike {
  readonly sessionId: string;
  sendAndWait(options: { prompt: string }): Promise<
    { readonly type?: string; readonly data?: { readonly content?: string } } | undefined
  >;
}

/** The narrow slice of the Copilot SDK client this provider depends on. */
export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  createSession(config: Record<string, unknown>): Promise<CopilotSessionLike>;
  deleteSession(sessionId: string): Promise<void>;
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

  private async generateStructured<SchemaT extends z.ZodType>(
    systemPrompt: string,
    userMessage: string,
    schema: SchemaT,
  ): Promise<z.infer<SchemaT>> {
    const factory = await this.resolveFactory();
    const client = factory({
      // `copilot-cli` is the SDK default and it is the wrong default here: it
      // loads ambient instruction files (`AGENTS.md`, `.github/copilot-
      // instructions.md`, `CLAUDE.md`) from the working directory into the
      // prompt. Trajectory promises that only the selected user and mentor
      // context leaves the machine, so opt out of ambient behaviour entirely
      // and run in a directory the application owns.
      mode: "empty",
      baseDirectory: this.baseDirectory,
      workingDirectory: this.baseDirectory,
      logLevel: "error",
      useLoggedInUser: this.githubToken === undefined,
      env: this.runtimeEnv(),
      ...(this.githubToken ? { gitHubToken: this.githubToken } : {}),
    });

    let session: CopilotSessionLike | undefined;
    try {
      await client.start();
      session = await client.createSession({
        clientName: "trajectory",
        model: this.model,
        systemMessage: { mode: "append", content: systemPrompt },
        availableTools: [],
        // `no-result` sends no decision at all and leaves the request pending.
        // Refusing is the point: this session may only produce text.
        onPermissionRequest: () => ({
          kind: "reject",
          feedback: "Trajectory does not grant tool permissions.",
        }),
        skipCustomInstructions: true,
        enableSessionTelemetry: false,
        streaming: false,
        infiniteSessions: { enabled: false },
      });

      let prompt = userMessage;
      let lastError: ProviderResponseError | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reply = await session.sendAndWait({ prompt });
        const content = reply?.data?.content;
        if (reply?.type !== "assistant.message" || !content) {
          lastError = new ProviderResponseError(
            "Copilot SDK returned no assistant message",
          );
        } else {
          try {
            return parseStructuredResponse(content, schema);
          } catch (error) {
            if (!(error instanceof ProviderResponseError)) {
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
      if (error instanceof ProviderResponseError) {
        throw error;
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

  async generate(request: DecisionRequest): Promise<Recommendation> {
    return await this.generateStructured(
      SYSTEM_PROMPT,
      buildUserMessage(request),
      recommendationSchema,
    );
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return await this.generateStructured(
      CHAT_SYSTEM_PROMPT,
      buildChatUserMessage(request),
      chatResponseSchema,
    );
  }
}
