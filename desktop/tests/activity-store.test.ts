import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { activitySignalSchema, type ActivitySignal } from "../src/engine/domain";
import { EncryptedActivityStore } from "../src/main/activity-store";

const temporaryDirectories: string[] = [];

const testEncryption = {
  isAvailable: () => true,
  encrypt: (value: string) =>
    Buffer.from(value.split("").reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8").split("").reverse().join(""),
};

const unavailableEncryption = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error("Encryption was called when it was unavailable.");
  },
  decrypt: () => {
    throw new Error("Decryption was called when it was unavailable.");
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-activity-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "activity.enc.json");
}

function signal(overrides: Partial<ActivitySignal> = {}): ActivitySignal {
  return {
    id: "fixture_20260310_0",
    integration_id: "fixture",
    kind: "workout",
    occurred_at: "2026-03-10",
    summary: "Invented sample record",
    domain: "training",
    completed: null,
    metrics: { distance_m: 10_000 },
    url: null,
    provenance: {
      fetched_at: "2026-03-10T12:00:00.000Z",
      adapter_version: "fixture-1",
      account_label: "sample",
      manually_reviewed: false,
    },
    ...overrides,
  };
}

const merge = { retentionDays: 180, today: "2026-03-10", syncedAt: "2026-03-10T12:00:00.000Z" };

describe("EncryptedActivityStore", () => {
  it("refuses a batch whose records share an ID", async () => {
    // The failure this replaces was silent: colliding IDs meant the map kept
    // the last record and the user saw a smaller number with no way to know it
    // was wrong. A failed sync they can read beats data loss they cannot.
    const store = new EncryptedActivityStore(await temporaryFile(), testEncryption);
    await expect(
      store.merge(
        "fixture",
        [
          signal({ id: "fixture_same", summary: "First" }),
          signal({ id: "fixture_same", summary: "Second" }),
        ],
        merge,
      ),
    ).rejects.toThrow(/more than one record with the ID/);
  });

  it("loads records written before completion was tracked", async () => {
    // The field arrived after this user already had months of stored signals.
    // Rejecting them would silently empty the log the mentor reasons from, and
    // an unreadable record is dropped by safeParse without a word.
    const { completed: _dropped, ...legacy } = signal();
    const parsed = activitySignalSchema.safeParse(legacy);

    expect(parsed.success).toBe(true);
    expect(parsed.data?.completed).toBeNull();
  });

  it("writes no plaintext activity to disk", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge(
      "fixture",
      [signal({ summary: "Ran the private canyon loop" })],
      merge,
    );

    const serialized = await readFile(filePath, "utf8");
    expect(serialized).not.toContain("Ran the private canyon loop");
    expect(serialized).not.toContain("training");

    const reloaded = new EncryptedActivityStore(filePath, testEncryption);
    expect((await reloaded.list())[0]?.summary).toBe("Ran the private canyon loop");
  });

  it("refuses to store activity when encryption is unavailable", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, unavailableEncryption);
    await expect(store.merge("fixture", [signal()], merge)).rejects.toThrow(
      /Secure local storage is unavailable/,
    );
  });

  it("replaces a signal that arrives twice instead of duplicating it", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge("fixture", [signal()], merge);
    const count = await store.merge(
      "fixture",
      [signal({ summary: "Corrected summary" })],
      merge,
    );

    expect(count).toBe(1);
    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.summary).toBe("Corrected summary");
  });

  it("drops signals that fall outside the retention window", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge(
      "fixture",
      [
        signal({ id: "fixture_recent", occurred_at: "2026-03-10" }),
        signal({ id: "fixture_old", occurred_at: "2026-01-01" }),
      ],
      { ...merge, retentionDays: 7 },
    );

    const stored = await store.list();
    expect(stored.map((item) => item.id)).toEqual(["fixture_recent"]);
  });

  it("rejects a signal that claims a different integration", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await expect(
      store.merge("fixture", [signal({ integration_id: "github" })], merge),
    ).rejects.toThrow(/belonging to "github"/);
  });

  it("reports the most recent stored date as the incremental starting point", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    expect(await store.latestOccurredAt("fixture")).toBeNull();

    await store.merge(
      "fixture",
      [
        signal({ id: "fixture_a", occurred_at: "2026-03-08" }),
        signal({ id: "fixture_b", occurred_at: "2026-03-10" }),
        signal({ id: "fixture_c", occurred_at: "2026-03-09" }),
      ],
      merge,
    );
    expect(await store.latestOccurredAt("fixture")).toBe("2026-03-10");
  });

  it("keeps a failure visible without discarding what was already stored", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge("fixture", [signal()], merge);
    await store.recordFailure("fixture", "The sample source was unreachable.");

    const status = await store.status();
    expect(status["fixture"]).toEqual({
      lastSyncedAt: "2026-03-10T12:00:00.000Z",
      lastError: "The sample source was unreachable.",
      signalCount: 1,
    });
    expect(await store.list("fixture")).toHaveLength(1);
  });

  it("clears the previous error once a sync succeeds", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.recordFailure("fixture", "Temporary outage.");
    await store.merge("fixture", [signal()], merge);

    expect((await store.status())["fixture"]?.lastError).toBeNull();
  });

  it("removes every trace of an integration on request", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge("fixture", [signal()], merge);
    await store.merge(
      "other",
      [signal({ id: "other_1", integration_id: "other" })],
      merge,
    );

    await store.deleteIntegration("fixture");

    expect(await store.list("fixture")).toHaveLength(0);
    expect(await store.list("other")).toHaveLength(1);
    const status = await store.status();
    expect(status["fixture"]).toBeUndefined();
    expect(status["other"]).toBeDefined();
  });

  it("discards records it can no longer validate rather than serving them", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await store.merge("fixture", [signal()], merge);

    // Simulate a store written by a future or broken version by decrypting the
    // real file, injecting a malformed record, and re-encrypting it in place.
    const envelope = JSON.parse(await readFile(filePath, "utf8")) as {
      ciphertext: string;
    };
    const data = JSON.parse(
      testEncryption.decrypt(Buffer.from(envelope.ciphertext, "base64")),
    ) as { signals: unknown[] };
    data.signals.push({ id: "broken", integration_id: "fixture" });
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        ciphertext: testEncryption
          .encrypt(JSON.stringify(data))
          .toString("base64"),
      }),
      "utf8",
    );

    const reloaded = new EncryptedActivityStore(filePath, testEncryption);
    expect((await reloaded.list()).map((item) => item.id)).toEqual([
      "fixture_20260310_0",
    ]);
  });

  it("refuses to read a store whose envelope it does not recognise", async () => {
    const filePath = await temporaryFile();
    await writeFile(filePath, JSON.stringify({ version: 99, ciphertext: "x" }));
    const store = new EncryptedActivityStore(filePath, testEncryption);
    await expect(store.list()).rejects.toThrow(/unsupported format/);
  });

  it("returns an empty list before anything has ever synced", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedActivityStore(filePath, testEncryption);
    expect(await store.list()).toEqual([]);
    expect(await store.status()).toEqual({});
  });
});
