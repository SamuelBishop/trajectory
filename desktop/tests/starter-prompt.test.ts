import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  ActivitySignal,
  StarterPromptsRequest,
  StarterPromptsResponse,
} from "../src/engine/domain";
import { DeterministicProvider } from "../src/engine/providers/deterministic";
import type { MentorProvider } from "../src/engine/providers/types";
import { DEFAULT_SETTINGS, type Settings } from "../src/engine/settings";
import { validateStarterPrompts } from "../src/engine/validation";
import { AttributionError } from "../src/engine/errors";
import { StarterPromptService } from "../src/main/starter-prompt-service";
import {
  EncryptedStarterPromptStore,
  STARTER_PROMPT_TTL_MS,
  type StarterPromptRecord,
} from "../src/main/starter-prompt-store";
import { mentorDirectory, userDirectory } from "./engine/fixtures";

const temporaryDirectories: string[] = [];

const testEncryption = {
  isAvailable: () => true,
  encrypt: (value: string) =>
    Buffer.from(value.split("").reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8").split("").reverse().join(""),
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryStoreWithPath(): Promise<{
  store: EncryptedStarterPromptStore;
  filePath: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-starter-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "starter.enc.json");
  return {
    store: new EncryptedStarterPromptStore(filePath, testEncryption),
    filePath,
  };
}

async function temporaryStore(): Promise<EncryptedStarterPromptStore> {
  return (await temporaryStoreWithPath()).store;
}

const validRecord: StarterPromptRecord = {
  generatedAt: new Date().toISOString(),
  provider: "deterministic",
  model: "",
  prompts: [
    {
      question: "Should I keep polishing this pull request or move on to the design proposal?",
      goal_ids: ["career_001"],
      activity_ids: [],
    },
    {
      question: "Am I spending too much time on low-risk work at the expense of higher-priority goals?",
      goal_ids: ["career_001"],
      activity_ids: [],
    },
    {
      question: "What would I make progress on if I treated the design proposal as the priority?",
      goal_ids: ["career_001"],
      activity_ids: [],
    },
  ],
};

describe("EncryptedStarterPromptStore", () => {
  it("round-trips a record through encryption", async () => {
    const store = await temporaryStore();
    await store.save(validRecord);
    const loaded = await store.get();
    expect(loaded).toEqual(validRecord);
  });

  it("returns null when no record exists", async () => {
    const store = await temporaryStore();
    expect(await store.get()).toBeNull();
  });

  it("writes no readable prompt text to disk", async () => {
    const { store, filePath } = await temporaryStoreWithPath();
    await store.save(validRecord);
    const raw = await readFile(filePath, "utf8");
    for (const item of validRecord.prompts) {
      expect(raw).not.toContain(item.question);
    }
  });

  it("refuses to store when encryption is unavailable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-starter-"));
    temporaryDirectories.push(directory);
    const store = new EncryptedStarterPromptStore(
      path.join(directory, "starter.enc.json"),
      { ...testEncryption, isAvailable: () => false },
    );
    await expect(store.save(validRecord)).rejects.toThrow(/unavailable/);
  });

  it("handles malformed records by returning null", async () => {
    const { store, filePath } = await temporaryStoreWithPath();
    await store.save(validRecord);
    // Corrupt the record by saving something that will decrypt but fail parse.
    const corruptStore = new EncryptedStarterPromptStore(
      filePath,
      {
        ...testEncryption,
        // Decrypt returns something that is valid JSON but not a valid record.
        decrypt: () => JSON.stringify({ invalid: true }),
      },
    );
    expect(await corruptStore.get()).toBeNull();
  });

  it("detects fresh records", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    expect(store.isFresh(validRecord, "deterministic", "")).toBe(true);
  });

  it("detects stale records when provider changes", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    expect(store.isFresh(validRecord, "openai", "")).toBe(false);
  });

  it("detects stale records when model changes", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    expect(store.isFresh(validRecord, "deterministic", "gpt-4")).toBe(false);
  });

  it("detects stale records when older than TTL", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    const old: StarterPromptRecord = {
      ...validRecord,
      generatedAt: new Date(Date.now() - STARTER_PROMPT_TTL_MS - 1).toISOString(),
    };
    expect(store.isFresh(old, "deterministic", "")).toBe(false);
  });

  it("does not treat a future generation time as fresh", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    const future: StarterPromptRecord = {
      ...validRecord,
      generatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    expect(store.isFresh(future, "deterministic", "")).toBe(false);
  });

  it("detects null as not fresh", () => {
    const store = new EncryptedStarterPromptStore("/unused", testEncryption);
    expect(store.isFresh(null, "deterministic", "")).toBe(false);
  });
});

describe("validateStarterPrompts", () => {
  const request: StarterPromptsRequest = {
    current_state: { current_role: "eng", responsibilities: [], current_projects: [], known_deadlines: [], current_energy: "high", recent_progress: [], unresolved_decisions: [] },
    constraints: { practical_constraints: [], protected_commitments: [] },
    goals: [{ id: "career_001", description: "d", motivation: "m", priority: 1, domain: "career", success_criteria: ["s"], status: "active", target_date: null, tags: [] }],
    activity_context: null,
    provider: "deterministic",
    prompt_version: "starter_v1",
  };

  const validResponse: StarterPromptsResponse = {
    prompts: [
      { question: "Should I keep polishing this PR?", goal_ids: ["career_001"], activity_ids: [] },
      { question: "Am I spending too much time on low-risk work?", goal_ids: ["career_001"], activity_ids: [] },
      { question: "Where am I drifting from priorities?", goal_ids: ["career_001"], activity_ids: [] },
    ],
  };

  it("accepts valid responses", () => {
    expect(() => validateStarterPrompts(validResponse, request)).not.toThrow();
  });

  it("rejects unknown goal IDs", () => {
    const bad: StarterPromptsResponse = {
      prompts: validResponse.prompts.map((p, i) =>
        i === 0 ? { ...p, goal_ids: ["nonexistent"] } : p,
      ),
    };
    expect(() => validateStarterPrompts(bad, request)).toThrow(AttributionError);
  });

  it("rejects unknown activity IDs", () => {
    const bad: StarterPromptsResponse = {
      prompts: validResponse.prompts.map((p, i) =>
        i === 0 ? { ...p, activity_ids: ["ghost"] } : p,
      ),
    };
    expect(() => validateStarterPrompts(bad, request)).toThrow(AttributionError);
  });

  it("rejects duplicate questions", () => {
    const bad: StarterPromptsResponse = {
      prompts: [
        validResponse.prompts[0]!,
        validResponse.prompts[0]!,
        validResponse.prompts[2]!,
      ],
    };
    expect(() => validateStarterPrompts(bad, request)).toThrow(/duplicate/i);
  });
});

describe("StarterPromptService", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, provider: "deterministic" };

  async function buildService(overrides: {
    store?: EncryptedStarterPromptStore;
    provider?: MentorProvider;
    settings?: Partial<Settings>;
    now?: Date;
    signals?: ActivitySignal[];
  } = {}) {
    const store = overrides.store ?? (await temporaryStore());
    const service = new StarterPromptService({
      store,
      loadSettings: () => Promise.resolve({ ...settings, ...overrides.settings }),
      createProvider: () =>
        Promise.resolve(overrides.provider ?? new DeterministicProvider()),
      directories: () => Promise.resolve({ userDirectory, mentorDirectory }),
      signalsForPrompt: () => Promise.resolve(overrides.signals ?? []),
      now: () => overrides.now ?? new Date(),
    });
    return { service, store };
  }

  it("returns null when cache is empty", async () => {
    const { service } = await buildService();
    const result = await service.getCached();
    expect(result.record).toBeNull();
    expect(result.fresh).toBe(false);
  });

  it("surfaces an unavailable encrypted cache instead of treating it as empty", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-starter-"));
    temporaryDirectories.push(directory);
    const store = new EncryptedStarterPromptStore(
      path.join(directory, "starter.enc.json"),
      { ...testEncryption, isAvailable: () => false },
    );
    const { service } = await buildService({ store });

    await expect(service.getCached()).rejects.toThrow(/unavailable/);
  });

  it("refresh generates and stores three prompts", async () => {
    const { service, store } = await buildService();
    const record = await service.refresh();
    expect(record.prompts).toHaveLength(3);
    expect(record.provider).toBe("deterministic");

    const cached = await store.get();
    expect(cached).toEqual(record);
  });

  it("uses goals, current state, constraints, and stored activity without conversation text", async () => {
    const captured: StarterPromptsRequest[] = [];
    const inner = new DeterministicProvider();
    const provider: MentorProvider = {
      name: "deterministic",
      generate: (request) => inner.generate(request),
      chat: (request) => inner.chat(request),
      briefing: (request) => inner.briefing(request),
      starterPrompts: async (request) => {
        captured.push(request);
        return await inner.starterPrompts(request);
      },
    };
    const signal: ActivitySignal = {
      id: "fixture_recent",
      integration_id: "fixture",
      kind: "code_commit",
      occurred_at: "2026-03-10",
      summary: "Drafted the architecture proposal",
      domain: "career",
      completed: true,
      metrics: {},
      url: null,
      provenance: {
        fetched_at: "2026-03-10T12:00:00.000Z",
        adapter_version: "fixture-1",
        account_label: "sample",
        manually_reviewed: false,
      },
    };
    const { service } = await buildService({
      provider,
      signals: [signal],
      now: new Date("2026-03-10T12:00:00.000Z"),
    });

    await service.refresh();

    const request = captured[0];
    expect(request).toBeDefined();
    if (!request) {
      throw new Error("Starter prompt provider did not receive a request.");
    }
    expect(request.goals.length).toBeGreaterThan(0);
    expect(request.current_state.current_projects.length).toBeGreaterThan(0);
    expect(request.constraints).toBeDefined();
    expect(request.activity_context?.signals.map((item) => item.id)).toContain(
      signal.id,
    );
    expect(request).not.toHaveProperty("history");
    expect(request).not.toHaveProperty("message");
  });

  it("getCached returns fresh after a successful refresh", async () => {
    const { service } = await buildService();
    await service.refresh();
    const result = await service.getCached();
    expect(result.fresh).toBe(true);
    expect(result.record?.prompts).toHaveLength(3);
  });

  it("deduplicates concurrent refresh calls", async () => {
    let callCount = 0;
    const inner = new DeterministicProvider();
    const counting: MentorProvider = {
      name: "deterministic",
      generate: (r) => inner.generate(r),
      chat: (r) => inner.chat(r),
      briefing: (r) => inner.briefing(r),
      starterPrompts: async (r) => {
        callCount += 1;
        return await inner.starterPrompts(r);
      },
    };
    const { service } = await buildService({ provider: counting });

    await Promise.all([service.refresh(), service.refresh()]);
    expect(callCount).toBe(1);
  });

  it("preserves prior cache on refresh failure", async () => {
    const { service, store } = await buildService();
    await service.refresh();
    const first = await store.get();

    const failing: MentorProvider = {
      name: "deterministic",
      generate: () => Promise.reject(new Error("unused")),
      chat: () => Promise.reject(new Error("unused")),
      briefing: () => Promise.reject(new Error("unused")),
      starterPrompts: () => Promise.reject(new Error("provider down")),
    };
    const { service: failService } = await buildService({ store, provider: failing });
    await expect(failService.refresh()).rejects.toThrow("provider down");

    const preserved = await store.get();
    expect(preserved).toEqual(first);
  });

  it("detects provider change as stale", async () => {
    const { service, store } = await buildService();
    await service.refresh();

    const { service: otherService } = await buildService({
      store,
      settings: { provider: "openai" },
    });
    const result = await otherService.getCached();
    expect(result.fresh).toBe(false);
    expect(result.record).not.toBeNull();
  });
});
