import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Briefing } from "../src/engine/domain";
import {
  BRIEFING_RETENTION_DAYS,
  EncryptedBriefingStore,
} from "../src/main/briefing-store";

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
  const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-briefing-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "briefings.enc.json");
}

const SECRET = "Nine consecutive training days against a stated recovery limit.";

function briefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    headline: "One thing slipping — worth the afternoon.",
    body: SECRET,
    on_track: "partly",
    priorities: ["Outline the postponed design proposal."],
    watch_out: "Polishing a finished pull request.",
    goal_ids: ["career_001"],
    principle_ids: ["demo_opportunity_cost_001"],
    source_ids: ["demo_source_001"],
    activity_ids: [],
    observations: ["The pull request is described as complete."],
    inferences: ["Further polish has lower opportunity value."],
    confidence: 0.7,
    uncertainties: ["Work away from connected sources is invisible."],
    ...overrides,
  };
}

describe("encrypted briefing store", () => {
  it("round-trips a briefing", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await store.saveSuccess({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: true,
    });

    const record = await store.forDate("2026-03-10");
    expect(record?.briefing?.body).toBe(SECRET);
    expect(record?.notified).toBe(true);
  });

  it("writes no readable prose to disk", async () => {
    // The whole justification for the store. If the body were recoverable from
    // the file, the encryption would be decoration.
    const filePath = await temporaryFile();
    const store = new EncryptedBriefingStore(filePath, testEncryption);

    await store.saveSuccess({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });

    const raw = await readFile(filePath, "utf8");
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("recovery");
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });

  it("refuses to write when encryption is unavailable", async () => {
    // [HC-NO-PLAINTEXT-HISTORY]: refuse, never downgrade.
    const filePath = await temporaryFile();
    const store = new EncryptedBriefingStore(filePath, unavailableEncryption);

    await expect(
      store.saveSuccess({
        date: "2026-03-10",
        generatedAt: "2026-03-10T12:00:00.000Z",
        briefing: briefing(),
        staleSources: [],
        notified: false,
      }),
    ).rejects.toThrow(/Secure local storage is unavailable/);

    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("refuses to clear when encryption is unavailable", async () => {
    // `clear()` is the one path that writes without reading first, so it needs
    // its own guard rather than inheriting the one on the read path. Writing an
    // "empty" file here would still create a store the next write appends
    // plaintext to.
    const filePath = await temporaryFile();

    await expect(
      new EncryptedBriefingStore(filePath, unavailableEncryption).clear(),
    ).rejects.toThrow(/Secure local storage is unavailable/);

    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("refuses to read when encryption is unavailable", async () => {
    // Without this guard a missing file reads as an empty list, and the pane
    // renders "no briefings yet" — a claim about the user's history — when the
    // truth is that the store could not be opened at all.
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      unavailableEncryption,
    );

    await expect(store.list()).rejects.toThrow(
      /Secure local storage is unavailable/,
    );
    await expect(store.forDate("2026-03-10")).rejects.toThrow(
      /Secure local storage is unavailable/,
    );
  });

  it("replaces an earlier attempt for the same day", async () => {
    // "Run now" after fixing a broken integration must correct the day rather
    // than leave two contradictory entries for the user to reconcile.
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await store.saveFailure({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      message: "Strava rejected the stored authorization.",
      staleSources: ["strava"],
    });
    await store.saveSuccess({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:05:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: true,
    });

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.error).toBeNull();
  });

  it("keeps a failure visible rather than swallowing it", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await store.saveFailure({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      message: "The provider was unreachable.",
      staleSources: ["github"],
    });

    const record = await store.forDate("2026-03-10");
    expect(record?.error).toBe("The provider was unreachable.");
    expect(record?.briefing).toBeNull();
    // Never notified on failure, so this must be false however it was written.
    expect(record?.notified).toBe(false);
    expect(record?.staleSources).toEqual(["github"]);
  });

  it("counts a failed attempt as the day's run", async () => {
    // Otherwise a provider outage makes the sixty-second poll retry until
    // midnight.
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await store.saveFailure({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      message: "The provider was unreachable.",
      staleSources: [],
    });

    expect(await store.lastRunDate()).toBe("2026-03-10");
  });

  it("reports no last run before anything is stored", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    expect(await store.lastRunDate()).toBeNull();
    expect(await store.list()).toEqual([]);
  });

  it("lists most recent first", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    for (const date of ["2026-03-08", "2026-03-10", "2026-03-09"]) {
      await store.saveSuccess({
        date,
        generatedAt: `${date}T12:00:00.000Z`,
        briefing: briefing(),
        staleSources: [],
        notified: false,
      });
    }

    expect((await store.list()).map((record) => record.date)).toEqual([
      "2026-03-10",
      "2026-03-09",
      "2026-03-08",
    ]);
    expect(await store.lastRunDate()).toBe("2026-03-10");
  });

  it("drops records past the retention window", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await store.saveSuccess({
      date: "2025-01-01",
      generatedAt: "2025-01-01T12:00:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });
    await store.saveSuccess({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });

    expect((await store.list()).map((record) => record.date)).toEqual([
      "2026-03-10",
    ]);
  });

  it("keeps a record at the edge of the retention window", async () => {
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );
    const today = "2026-03-10";
    const edge = new Date(
      Date.parse(`${today}T00:00:00Z`) -
        (BRIEFING_RETENTION_DAYS - 1) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);

    await store.saveSuccess({
      date: edge,
      generatedAt: `${edge}T12:00:00.000Z`,
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });
    await store.saveSuccess({
      date: today,
      generatedAt: `${today}T12:00:00.000Z`,
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });

    expect((await store.list()).map((record) => record.date)).toEqual([
      today,
      edge,
    ]);
  });

  it("rejects a briefing the schema does not accept", async () => {
    // A headline too long for a notification must not reach disk, or the pane
    // would render a record the notifier could never have sent.
    const store = new EncryptedBriefingStore(
      await temporaryFile(),
      testEncryption,
    );

    await expect(
      store.saveSuccess({
        date: "2026-03-10",
        generatedAt: "2026-03-10T12:00:00.000Z",
        briefing: briefing({ headline: "a".repeat(121) }),
        staleSources: [],
        notified: false,
      }),
    ).rejects.toThrow();
  });

  it("discards a malformed record on read rather than surfacing it", async () => {
    const filePath = await temporaryFile();
    const store = new EncryptedBriefingStore(filePath, testEncryption);

    await store.saveSuccess({
      date: "2026-03-10",
      generatedAt: "2026-03-10T12:00:00.000Z",
      briefing: briefing(),
      staleSources: [],
      notified: false,
    });

    const raw = JSON.parse(await readFile(filePath, "utf8")) as {
      ciphertext: string;
    };
    const decoded = JSON.parse(
      testEncryption.decrypt(Buffer.from(raw.ciphertext, "base64")),
    ) as { records: unknown[] };
    decoded.records.push({ date: "not-a-date", briefing: null });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        ciphertext: testEncryption
          .encrypt(JSON.stringify(decoded))
          .toString("base64"),
      }),
      "utf8",
    );

    const records = await store.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.date).toBe("2026-03-10");
  });

  it("rejects an envelope written by a future version", async () => {
    const filePath = await temporaryFile();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      filePath,
      JSON.stringify({ version: 2, ciphertext: "" }),
      "utf8",
    );

    await expect(
      new EncryptedBriefingStore(filePath, testEncryption).list(),
    ).rejects.toThrow(/unsupported format/);
  });
});
