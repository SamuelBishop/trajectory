import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import type { ChatRequest, DecisionRequest } from "../../src/engine/domain";
import { ProviderError, ProviderResponseError } from "../../src/engine/errors";
import { chatWithMentor, reviewDecision } from "../../src/engine/mentorship";
import {
  CopilotProvider,
  DEFAULT_COPILOT_MODEL,
  copilotRuntimePackages,
  unpackedRuntimePath,
  type CopilotClientLike,
  type CopilotSessionLike,
} from "../../src/engine/providers/copilot";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import {
  OpenAICompatibleProvider,
  type CompletionClient,
} from "../../src/engine/providers/openai";
import { mentorDirectory, userDirectory } from "./fixtures";

const directories = { userDirectory, mentorDirectory };
const QUESTION =
  "Should I spend another two hours polishing this low-risk pull request?";

async function demoRequest(): Promise<DecisionRequest> {
  const result = await reviewDecision(
    QUESTION,
    new DeterministicProvider(),
    directories,
  );
  return result.request;
}

async function demoChatRequest(): Promise<ChatRequest> {
  const result = await chatWithMentor(
    QUESTION,
    [],
    new DeterministicProvider(),
    directories,
  );
  return result.request;
}

function recommendationJson(request: DecisionRequest): string {
  return JSON.stringify({
    assessment: "redirect",
    response: "Stop after the correctness check.",
    why_now: "The selected career goal has higher opportunity value.",
    goal_ids: [request.goals[0]!.id],
    principle_ids: [request.principles[0]!.id],
    source_ids: [request.sources[0]!.id],
    observations: ["The pull request is described as low risk."],
    inferences: ["More polish may be perfectionism."],
    alternatives_considered: ["Keep polishing.", "Submit after checking."],
    suggested_next_step: "Run a short correctness checklist and submit.",
    confidence: 0.7,
    uncertainties: ["Unreported production risk may exist."],
  });
}

function chatJson(request: ChatRequest): string {
  return JSON.stringify({
    answer: "Focus on the design proposal after a short correctness check.",
    goal_ids: [request.goals[0]!.id],
    principle_ids: [request.principles[0]!.id],
    source_ids: [request.sources[0]!.id],
    observations: ["The pull request is described as complete."],
    inferences: ["Additional polish may have lower opportunity value."],
    confidence: 0.75,
    uncertainties: ["Unreported production risk may exist."],
  });
}

class FakeOpenAIClient implements CompletionClient {
  readonly calls: Record<string, unknown>[] = [];

  constructor(private readonly contents: string[]) {}

  readonly chat = {
    completions: {
      create: async (params: Record<string, unknown>) => {
        this.calls.push(params);
        return { choices: [{ message: { content: this.contents.shift()! } }] };
      },
    },
  };
}

/** The vendor error carries a credential, the way a real SDK error would. */
const LEAKED_SECRET = "sk-live-3f8a2c9d-must-never-be-surfaced";

class FailingOpenAIClient implements CompletionClient {
  readonly chat = {
    completions: {
      create: async () => {
        throw new Error(
          `401 Incorrect API key provided: ${LEAKED_SECRET}. ` +
            "You can find your API key at https://platform.openai.com/account/api-keys",
        );
      },
    },
  };
}

class FakeCopilotSession implements CopilotSessionLike {
  readonly sessionId = "fake-session";
  readonly prompts: string[] = [];

  constructor(private readonly contents: string[]) {}

  async sendAndWait(options: { prompt: string }) {
    this.prompts.push(options.prompt);
    return {
      type: "assistant.message",
      data: { content: this.contents.shift()! },
    };
  }
}

class FakeCopilotClient implements CopilotClientLike {
  readonly deletedSessionIds: string[] = [];
  sessionConfig: Record<string, unknown> | undefined;
  stopped = false;

  constructor(
    private readonly contents: string[],
    readonly options: Record<string, unknown>,
  ) {
    // Mirror the real client's constructor-time contract. A fake that accepts
    // option combinations `CopilotClient` rejects will happily prove a
    // configuration correct that cannot start in the packaged app — which is
    // exactly how a client that never launched once shipped.
    if (
      options.mode === "empty" &&
      options.baseDirectory === undefined &&
      options.sessionFs === undefined
    ) {
      throw new Error(
        "CopilotClient was created with mode: 'empty' but neither 'baseDirectory' nor 'sessionFs' was set.",
      );
    }
  }

  async start(): Promise<void> {}

  async stop(): Promise<unknown> {
    this.stopped = true;
    return [];
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.deletedSessionIds.push(sessionId);
  }

  async createSession(
    config: Record<string, unknown>,
  ): Promise<CopilotSessionLike> {
    this.sessionConfig = config;
    return new FakeCopilotSession(this.contents);
  }
}

class FailingCopilotClient extends FakeCopilotClient {
  override async start(): Promise<void> {
    throw new Error("authentication unavailable");
  }
}

describe("OpenAI-compatible provider", () => {
  it("validates and retries once", async () => {
    const request = await demoRequest();
    const client = new FakeOpenAIClient(["not json", recommendationJson(request)]);

    const recommendation = await new OpenAICompatibleProvider({
      model: "test-model",
      client,
    }).generate(request);

    expect(recommendation.goal_ids).toEqual(["career_001"]);
    expect(client.calls).toHaveLength(2);
  });

  it("requests a strict schema in which every property is required", async () => {
    const request = await demoChatRequest();
    const client = new FakeOpenAIClient([chatJson(request)]);

    const response = await new OpenAICompatibleProvider({
      model: "test-model",
      client,
    }).chat(request);

    expect(response.goal_ids).toEqual(["career_001"]);
    const format = client.calls[0]!.response_format as {
      json_schema: { name: string; strict: boolean; schema: Record<string, any> };
    };
    expect(format.json_schema.name).toBe("trajectory_chat_response");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.required).toEqual(
      Object.keys(format.json_schema.schema.properties),
    );
  });

  it("does not fall back after a second invalid response", async () => {
    const request = await demoRequest();

    await expect(
      new OpenAICompatibleProvider({
        model: "test-model",
        client: new FakeOpenAIClient(["bad", "still bad"]),
      }).generate(request),
    ).rejects.toThrow(ProviderResponseError);
  });

  it("wraps SDK errors without leaking the underlying message", async () => {
    const request = await demoRequest();

    const error = await new OpenAICompatibleProvider({
      model: "test-model",
      client: new FailingOpenAIClient(),
    })
      .generate(request)
      .then(
        () => undefined,
        (thrown: unknown) => thrown as Error,
      );

    expect(error?.message).toMatch(/OpenAI-compatible request failed/);
    // The whole point of wrapping: the vendor's text, and the credential inside
    // it, must not reach anything that might display or log this message.
    expect(error?.message).not.toContain(LEAKED_SECRET);
    expect(error?.message).not.toContain("Incorrect API key");
  });

  it("requires credentials from the environment", () => {
    expect(() =>
      OpenAICompatibleProvider.fromEnvironment({ OPENAI_MODEL: "test-model" }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      OpenAICompatibleProvider.fromEnvironment({ OPENAI_API_KEY: "secret" }),
    ).toThrow(/OPENAI_MODEL/);
  });
});

/** Stands in for the application-owned directory the main process creates. */
const RUNTIME_DIRECTORY = join(sep, "userdata", "runtime");

describe("Copilot provider", () => {
  it("keeps the macOS credential store enabled for a device-login session", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    // The SDK's empty mode forces COPILOT_DISABLE_KEYTAR=1. Device login stores
    // its OAuth credential in Keychain, so logged-in auth must use CLI mode.
    expect(created[0]!.options.mode).toBe("copilot-cli");
  });

  it("disables tools, denies permissions, and cleans up the session", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    const recommendation = await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    expect(recommendation.principle_ids).toEqual(["demo_opportunity_cost_001"]);
    const client = created[0]!;
    expect(client.deletedSessionIds).toEqual(["fake-session"]);
    expect(client.stopped).toBe(true);
    expect(client.sessionConfig?.availableTools).toEqual([]);
    expect(client.sessionConfig?.systemMessage).toMatchObject({
      mode: "customize",
      sections: { environment_context: { action: "remove" } },
    });
    expect(typeof client.sessionConfig?.onPermissionRequest).toBe("function");
  });

  it("gives the runtime no ambient context to read", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      githubToken: "test-token",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const options = created[0]!.options;
    // Explicit-token requests can retain empty mode's deny-by-default
    // behavior because they do not need the OS credential store.
    expect(options.mode).toBe("empty");
    expect(options.workingDirectory).toBe(RUNTIME_DIRECTORY);
    // Also the persistence location `mode: "empty"` refuses to start without,
    // and the COPILOT_HOME the runtime stores a login under.
    expect(options.baseDirectory).toBe(RUNTIME_DIRECTORY);
    const session = created[0]!.sessionConfig;
    expect(session?.skipCustomInstructions).toBe(true);
    expect(session?.enableSessionTelemetry).toBe(false);
    expect(session).toMatchObject({
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
    });
  });

  it("keeps COPILOT_HOME isolated once a token makes the stored login moot", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      githubToken: "test-token",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const options = created[0]!.options;
    expect(options.gitHubToken).toBe("test-token");
    expect(options.useLoggedInUser).toBe(false);
    expect(options.mode).toBe("empty");
    expect(options.baseDirectory).toBe(RUNTIME_DIRECTORY);
  });

  it("always gives the client a persistence location it will start with", async () => {
    const request = await demoRequest();

    // `mode: "empty"` throws at construction without `baseDirectory` or
    // `sessionFs`, and both authentication paths must clear that bar.
    for (const githubToken of [undefined, "test-token"]) {
      const created: FakeCopilotClient[] = [];
      await new CopilotProvider({
        model: "test-model",
        githubToken,
        baseDirectory: RUNTIME_DIRECTORY,
        clientFactory: (options) => {
          const client = new FakeCopilotClient(
            [recommendationJson(request)],
            options,
          );
          created.push(client);
          return client;
        },
      }).generate(request);

      const options = created[0]!.options;
      expect(
        options.baseDirectory !== undefined || options.sessionFs !== undefined,
      ).toBe(true);
    }
  });

  it("explains an authentication failure instead of listing four guesses", async () => {
    const request = await demoRequest();

    await expect(
      new CopilotProvider({
        model: "test-model",
        baseDirectory: RUNTIME_DIRECTORY,
        clientFactory: () => ({
          sessionId: "x",
          async start() {
            throw new Error(
              "Execution failed: Error: Session was not created with authentication info or custom provider",
            );
          },
          async stop() {
            return undefined;
          },
          async createSession() {
            throw new Error("unreachable");
          },
          async deleteSession() {
            return undefined;
          },
        }),
      }).generate(request),
    ).rejects.toThrow(/could not authenticate.*sign in with GitHub/is);
  });

  it("rejects permission requests rather than declining to answer them", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const onPermissionRequest = created[0]!.sessionConfig
      ?.onPermissionRequest as () => { kind: string };
    // `no-result` sends no decision at all and leaves the runtime waiting;
    // only an explicit reject actually denies the request.
    expect(await onPermissionRequest()).toMatchObject({ kind: "reject" });
  });

  it("supports chat", async () => {
    const request = await demoChatRequest();

    const response = await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      clientFactory: (options) =>
        new FakeCopilotClient([chatJson(request)], options),
    }).chat(request);

    expect(response.answer).toMatch(/^Focus on the design proposal/);
  });

  it("wraps SDK errors", async () => {
    const request = await demoRequest();

    await expect(
      new CopilotProvider({
        model: "test-model",
        baseDirectory: RUNTIME_DIRECTORY,
        clientFactory: (options) => new FailingCopilotClient([], options),
      }).generate(request),
    ).rejects.toThrow(/Copilot SDK request failed/);
  });

  it("spawns the native runtime binary when hosted by Electron", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      hostedByElectron: true,
      env: { PATH: "/usr/bin" },
      runtimeBinaryResolver: () => "/opt/trajectory/copilot",
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const env = created[0]!.options.env as NodeJS.ProcessEnv;
    expect(env.COPILOT_CLI_PATH).toBe("/opt/trajectory/copilot");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("refuses rather than hanging when the runtime is missing", async () => {
    const request = await demoRequest();

    await expect(
      new CopilotProvider({
        model: "test-model",
        baseDirectory: RUNTIME_DIRECTORY,
        hostedByElectron: true,
        env: {},
        runtimeBinaryResolver: () => undefined,
        clientFactory: (options) => new FakeCopilotClient([], options),
      }).generate(request),
    ).rejects.toThrow(/Copilot runtime is missing/);
  });

  it("leaves runtime resolution to the SDK outside Electron", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      hostedByElectron: false,
      env: { PATH: "/usr/bin" },
      runtimeBinaryResolver: () => "/opt/trajectory/copilot",
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const env = created[0]!.options.env as NodeJS.ProcessEnv;
    expect(env.COPILOT_CLI_PATH).toBeUndefined();
  });

  it("honours an explicit COPILOT_CLI_PATH", async () => {
    const request = await demoRequest();
    const created: FakeCopilotClient[] = [];

    await new CopilotProvider({
      model: "test-model",
      baseDirectory: RUNTIME_DIRECTORY,
      hostedByElectron: true,
      env: { COPILOT_CLI_PATH: "/usr/local/bin/copilot" },
      runtimeBinaryResolver: () => "/opt/trajectory/copilot",
      clientFactory: (options) => {
        const client = new FakeCopilotClient(
          [recommendationJson(request)],
          options,
        );
        created.push(client);
        return client;
      },
    }).generate(request);

    const env = created[0]!.options.env as NodeJS.ProcessEnv;
    expect(env.COPILOT_CLI_PATH).toBe("/usr/local/bin/copilot");
  });

  it("names the platform runtime packages the SDK ships", () => {
    expect(copilotRuntimePackages("darwin", "arm64")).toEqual([
      "@github/copilot-darwin-arm64",
    ]);
    expect(copilotRuntimePackages("linux", "x64")).toEqual([
      "@github/copilot-linux-x64",
      "@github/copilot-linuxmusl-x64",
    ]);
  });

  it("spawns the unpacked binary rather than one inside the asar", () => {
    const packed = join(sep, "App", "Resources", "app.asar", "node_modules", "copilot");
    const unpacked = join(
      sep,
      "App",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "copilot",
    );

    expect(unpackedRuntimePath(packed, (c) => c === unpacked)).toBe(unpacked);
    // Nothing was unpacked. The archive path can never be spawned, so report
    // no runtime rather than handing back a path that fails with ENOTDIR.
    expect(unpackedRuntimePath(packed, () => false)).toBeUndefined();
    const plain = join(sep, "repo", "node_modules", "copilot");
    expect(unpackedRuntimePath(plain, () => false)).toBe(plain);
  });

  it("defaults to a model every entitlement can reach", () => {
    expect(DEFAULT_COPILOT_MODEL).toBe("auto");
    const provider = CopilotProvider.fromEnvironment(RUNTIME_DIRECTORY, {});
    expect(provider).toBeInstanceOf(CopilotProvider);
  });
});

describe("deterministic provider", () => {
  it("rejects a question outside the committed demo", async () => {
    const request = await demoRequest();

    await expect(
      new DeterministicProvider().generate({
        ...request,
        question: "Should I write the design proposal now?",
      }),
    ).rejects.toThrow(ProviderError);
  });

  it("does not treat a design proposal as a pull request", async () => {
    const request = await demoRequest();

    await expect(
      new DeterministicProvider().generate({
        ...request,
        question: "Should I polish the design proposal?",
      }),
    ).rejects.toThrow(/supports only the committed/);
  });
});
