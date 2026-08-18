import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ActivitySignal } from "../src/engine/domain";
import { InsufficientContextError } from "../src/engine/errors";
import { GENERIC_NOTIFICATION_BODY } from "../src/engine/notification-text";
import { DeterministicProvider } from "../src/engine/providers/deterministic";
import type { MentorProvider } from "../src/engine/providers/types";
import { DEFAULT_SETTINGS, type Settings } from "../src/engine/settings";
import { BriefingService } from "../src/main/briefing-service";
import { EncryptedBriefingStore } from "../src/main/briefing-store";
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

async function temporaryStore(): Promise<EncryptedBriefingStore> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-brief-"));
  temporaryDirectories.push(directory);
  return new EncryptedBriefingStore(
    path.join(directory, "briefings.enc.json"),
    testEncryption,
  );
}

class RecordingNotifier {
  readonly posted: { title: string; body: string }[] = [];

  constructor(private readonly supported = true) {}

  isSupported(): boolean {
    return this.supported;
  }

  notify(options: { title: string; body: string }): void {
    this.posted.push(options);
  }
}

/** Midday on a fixed local day, so the schedule is satisfied by default. */
function noon(day = 10): Date {
  return new Date(2026, 2, day, 12, 0, 0, 0);
}

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  briefingEnabled: true,
  briefingMinute: 12 * 60,
  briefingHeadlineInNotification: true,
};

async function build(
  overrides: {
    store?: EncryptedBriefingStore;
    settings?: Partial<Settings>;
    provider?: MentorProvider;
    notifier?: RecordingNotifier;
    stale?: string[];
    signals?: ActivitySignal[];
    now?: () => Date;
    syncThrows?: boolean;
  } = {},
) {
  const store = overrides.store ?? (await temporaryStore());
  const notifier = overrides.notifier ?? new RecordingNotifier();
  const syncCalls: number[] = [];
  const service = new BriefingService({
    store,
    loadSettings: () =>
      Promise.resolve({ ...settings, ...overrides.settings }),
    createProvider: () =>
      Promise.resolve(overrides.provider ?? new DeterministicProvider()),
    directories: () => Promise.resolve({ userDirectory, mentorDirectory }),
    syncForBriefing: () => {
      syncCalls.push(Date.now());
      return overrides.syncThrows
        ? Promise.reject(new Error("the network is down"))
        : Promise.resolve(overrides.stale ?? []);
    },
    signalsForPrompt: () => Promise.resolve(overrides.signals ?? []),
    notifier,
    now: overrides.now ?? (() => noon()),
  });
  return { service, store, notifier, syncCalls };
}

describe("briefing service", () => {
  it("composes, stores, and notifies", async () => {
    const { service, store, notifier } = await build();

    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("completed");
    const record = await store.forDate("2026-03-10");
    expect(record?.briefing?.headline).toBeTruthy();
    expect(record?.notified).toBe(true);
    expect(notifier.posted).toHaveLength(1);
    expect(notifier.posted[0]?.body).toBe(record?.briefing?.headline);
  });

  it("syncs before composing", async () => {
    // A briefing that reads yesterday's data is not worth interrupting anyone
    // for.
    const { service, syncCalls } = await build();

    await service.runIfDue();

    expect(syncCalls).toHaveLength(1);
  });

  it("records stale sources rather than reading them as silence", async () => {
    const { service, store } = await build({ stale: ["Strava"] });

    await service.runIfDue();

    const record = await store.forDate("2026-03-10");
    expect(record?.staleSources).toEqual(["Strava"]);
    // The model is told too, not just the pane.
    expect(record?.briefing?.body).toContain("Strava");
  });

  it("still briefs when the sync throws outright", async () => {
    // Previously stored signals remain usable; what must not happen is
    // composing as though everything were fresh.
    const { service, store } = await build({ syncThrows: true });

    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("completed");
    expect(await store.forDate("2026-03-10")).toMatchObject({
      staleSources: ["every source"],
    });
  });

  it("never notifies when the provider fails", async () => {
    // Rule 2: a daily alert that says "briefing failed" is how a feature gets
    // muted.
    const failing: MentorProvider = {
      name: "openai",
      generate: () => Promise.reject(new Error("unused")),
      chat: () => Promise.reject(new Error("unused")),
      briefing: () => Promise.reject(new Error("The provider was unreachable.")),
      starterPrompts: () => Promise.reject(new Error("unused")),
    };
    const { service, store, notifier } = await build({ provider: failing });

    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("failed");
    expect(notifier.posted).toEqual([]);
    const record = await store.forDate("2026-03-10");
    expect(record?.error).toBe("The provider was unreachable.");
    expect(record?.notified).toBe(false);
  });

  it("never notifies when there are no active goals", async () => {
    const empty: MentorProvider = {
      name: "openai",
      generate: () => Promise.reject(new Error("unused")),
      chat: () => Promise.reject(new Error("unused")),
      briefing: () =>
        Promise.reject(new InsufficientContextError("No active goals.")),
      starterPrompts: () => Promise.reject(new Error("unused")),
    };
    const { service, notifier } = await build({ provider: empty });

    expect((await service.runIfDue()).status).toBe("failed");
    expect(notifier.posted).toEqual([]);
  });

  it("counts a failed run as the day's attempt", async () => {
    // Otherwise the sixty-second poll retries an outage until midnight.
    const failing: MentorProvider = {
      name: "openai",
      generate: () => Promise.reject(new Error("unused")),
      chat: () => Promise.reject(new Error("unused")),
      briefing: () => Promise.reject(new Error("Still down.")),
      starterPrompts: () => Promise.reject(new Error("unused")),
    };
    const { service, syncCalls } = await build({ provider: failing });

    await service.runIfDue();
    const second = await service.runIfDue();

    expect(second.status).toBe("skipped");
    expect(second.reason).toMatch(/already run/);
    expect(syncCalls).toHaveLength(1);
  });

  it("does not run before the due time", async () => {
    const { service, notifier, syncCalls } = await build({
      now: () => new Date(2026, 2, 10, 11, 0, 0, 0),
    });

    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("skipped");
    expect(syncCalls).toEqual([]);
    expect(notifier.posted).toEqual([]);
  });

  it("does not run while disabled", async () => {
    const { service, syncCalls } = await build({
      settings: { briefingEnabled: false },
    });

    expect((await service.runIfDue()).reason).toMatch(/turned off/);
    expect(syncCalls).toEqual([]);
  });

  it("sends a generic body when the headline is opted out", async () => {
    const { service, store, notifier } = await build({
      settings: { briefingHeadlineInNotification: false },
    });

    await service.runIfDue();

    expect(notifier.posted[0]?.body).toBe(GENERIC_NOTIFICATION_BODY);
    // The headline still exists — it is just kept behind the encrypted store.
    expect(await store.forDate("2026-03-10")).toMatchObject({
      briefing: { headline: expect.stringContaining("Design proposal") },
    });
  });

  it("stores the briefing even when notifications are unsupported", async () => {
    const { service, store, notifier } = await build({
      notifier: new RecordingNotifier(false),
    });

    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("completed");
    expect(notifier.posted).toEqual([]);
    expect(await store.forDate("2026-03-10")).toMatchObject({ notified: false });
  });

  it("runs on demand regardless of the clock", async () => {
    const { service, store } = await build({
      now: () => new Date(2026, 2, 10, 8, 0, 0, 0),
      settings: { briefingEnabled: false },
    });

    const outcome = await service.runNow();

    expect(outcome.status).toBe("completed");
    expect(await store.forDate("2026-03-10")).toBeTruthy();
  });

  it("lets a manual run stand in for the scheduled one", async () => {
    const { service, syncCalls } = await build({
      now: () => new Date(2026, 2, 10, 11, 0, 0, 0),
    });

    await service.runNow();
    // Now past noon on the same day.
    const scheduled = await service.runIfDue();

    expect(scheduled.status).toBe("skipped");
    expect(syncCalls).toHaveLength(1);
  });

  it("replaces an earlier failure when re-run by hand", async () => {
    const store = await temporaryStore();
    const failing: MentorProvider = {
      name: "openai",
      generate: () => Promise.reject(new Error("unused")),
      chat: () => Promise.reject(new Error("unused")),
      briefing: () => Promise.reject(new Error("Credential expired.")),
      starterPrompts: () => Promise.reject(new Error("unused")),
    };
    await (await build({ store, provider: failing })).service.runIfDue();

    const { service } = await build({ store });
    await service.runNow();

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.error).toBeNull();
  });

  it("does not start a second run while one is in flight", async () => {
    // The poll fires every minute and a briefing takes seconds. Without the
    // guard a slow provider would be asked twice for the same day.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = new DeterministicProvider();
    const slow: MentorProvider = {
      name: "deterministic",
      generate: (request) => inner.generate(request),
      chat: (request) => inner.chat(request),
      briefing: async (request) => {
        await gate;
        return await inner.briefing(request);
      },
      starterPrompts: (request) => inner.starterPrompts(request),
    };
    const { service, syncCalls, notifier } = await build({ provider: slow });

    const first = service.runIfDue();
    const second = service.runIfDue();
    release?.();
    await Promise.all([first, second]);

    expect(syncCalls).toHaveLength(1);
    expect(notifier.posted).toHaveLength(1);
  });

  it("skips rather than crashing when the store cannot be opened", async () => {
    const unopenable = new EncryptedBriefingStore("/nonexistent/x.json", {
      isAvailable: () => false,
      encrypt: () => {
        throw new Error("unavailable");
      },
      decrypt: () => {
        throw new Error("unavailable");
      },
    });
    const { service, notifier, syncCalls } = await build({ store: unopenable });

    const outcome = await service.runIfDue();

    // A briefing that cannot be stored would notify once and then vanish, with
    // nothing in the pane to explain it.
    expect(outcome.status).toBe("skipped");
    expect(notifier.posted).toEqual([]);
    expect(syncCalls).toEqual([]);
  });

  it("briefs again the next day", async () => {
    const store = await temporaryStore();
    await (await build({ store })).service.runIfDue();

    const { service } = await build({ store, now: () => noon(11) });
    const outcome = await service.runIfDue();

    expect(outcome.status).toBe("completed");
    expect((await store.list()).map((record) => record.date)).toEqual([
      "2026-03-11",
      "2026-03-10",
    ]);
  });
});
