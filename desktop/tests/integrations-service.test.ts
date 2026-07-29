import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntegrationService } from "../src/main/integrations";

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

async function userDataPath(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "trajectory-integrations-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

const enabledPolicy = {
  enabled: true,
  sync: { on_app_load: true, on_demand: true, timer_minutes: 0 },
  quiet_hours: { start: 0, end: 0 },
  retention_days: 180,
};

describe("IntegrationService", () => {
  it("starts with every integration off and nothing stored", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    const view = await service.view();

    expect(view.paused).toBe(false);
    expect(view.encryptionAvailable).toBe(true);
    expect(view.integrations).toHaveLength(1);
    expect(view.integrations[0]).toMatchObject({
      id: "fixture",
      policy: { enabled: false },
      signalCount: 0,
      lastSyncedAt: null,
      lastError: null,
    });
  });

  it("declares the outbound hosts of each integration to the user", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    const view = await service.view();
    // The offline fixture connects nowhere, and says so.
    expect(view.integrations[0]?.hosts).toEqual([]);
  });

  it("collects nothing until the user turns an integration on", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);

    await service.sync("fixture", "manual");
    let view = await service.view();
    expect(view.integrations[0]?.signalCount).toBe(0);
    expect(view.integrations[0]?.lastSkippedReason).toContain("turned off");

    await service.savePolicy("fixture", enabledPolicy);
    await service.sync("fixture", "manual");
    view = await service.view();
    expect(view.integrations[0]?.signalCount).toBe(5);
    expect(view.integrations[0]?.lastSyncedAt).not.toBeNull();
    expect(view.integrations[0]?.lastSkippedReason).toBeUndefined();
  });

  it("says nothing about an integration the user never turned on", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);

    // A launch sync declining a disabled integration is normal operation. The
    // toggle already says it is off; a standing notice would be noise.
    await service.syncOnLaunch();
    expect(
      (await service.view()).integrations[0]?.lastSkippedReason,
    ).toBeUndefined();
  });

  it("explains why an automatic sync did nothing when it was expected to run", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.savePolicy("fixture", enabledPolicy);
    await service.setPaused(true);

    await service.syncOnLaunch();
    expect((await service.view()).integrations[0]?.lastSkippedReason).toContain(
      "paused",
    );
  });

  it("persists the policy where a later run can read it", async () => {
    const directory = await userDataPath();
    await new IntegrationService(directory, testEncryption).savePolicy(
      "fixture",
      { ...enabledPolicy, retention_days: 30 },
    );

    const reloaded = await new IntegrationService(
      directory,
      testEncryption,
    ).view();
    expect(reloaded.integrations[0]?.policy).toEqual({
      ...enabledPolicy,
      retention_days: 30,
    });
  });

  it("keeps the pause across restarts", async () => {
    const directory = await userDataPath();
    await new IntegrationService(directory, testEncryption).setPaused(true);
    expect(
      (await new IntegrationService(directory, testEncryption).view()).paused,
    ).toBe(true);
  });

  it("honours the pause for a launch sync but not a manual one", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.savePolicy("fixture", enabledPolicy);
    await service.setPaused(true);

    await service.syncOnLaunch();
    expect((await service.view()).integrations[0]?.signalCount).toBe(0);

    await service.sync("fixture", "manual");
    expect((await service.view()).integrations[0]?.signalCount).toBe(5);
  });

  it("erases stored activity on request", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.savePolicy("fixture", enabledPolicy);
    await service.sync("fixture", "manual");
    expect((await service.view()).integrations[0]?.signalCount).toBe(5);

    await service.deleteData("fixture");
    const view = await service.view();
    expect(view.integrations[0]?.signalCount).toBe(0);
    expect(view.integrations[0]?.lastSyncedAt).toBeNull();
  });

  it("only sends the model activity from integrations that are on", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.savePolicy("fixture", enabledPolicy);
    await service.sync("fixture", "manual");
    expect(await service.signalsForPrompt()).toHaveLength(5);

    // Turning an integration off stops it reaching the model immediately. The
    // records stay on disk until the user deletes them, but they are no longer
    // something the mentor gets to reason from.
    await service.savePolicy("fixture", { ...enabledPolicy, enabled: false });
    expect(await service.signalsForPrompt()).toEqual([]);
    expect((await service.view()).integrations[0]?.signalCount).toBe(5);
  });

  it("sends the model no activity when encryption is unavailable", async () => {
    const service = new IntegrationService(
      await userDataPath(),
      unavailableEncryption,
    );
    await service.savePolicy("fixture", enabledPolicy);
    expect(await service.signalsForPrompt()).toEqual([]);
  });

  it("refuses to act on an integration it does not have", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await expect(service.sync("github", "manual")).rejects.toThrow(
      /Unknown integration/,
    );
    await expect(service.deleteData("github")).rejects.toThrow(
      /Unknown integration/,
    );
    await expect(service.savePolicy("github", enabledPolicy)).rejects.toThrow(
      /Unknown integration/,
    );
  });

  it("reports an empty state rather than failing when encryption is unavailable", async () => {
    const service = new IntegrationService(
      await userDataPath(),
      unavailableEncryption,
    );
    const view = await service.view();
    expect(view.encryptionAvailable).toBe(false);
    expect(view.integrations[0]?.signalCount).toBe(0);
  });

  it("writes the sync policy as readable JSON, not an opaque blob", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.savePolicy("fixture", enabledPolicy);

    // The policy is a setting, not private data — the user should be able to
    // read what they authorized. The activity itself is what gets encrypted.
    const written = JSON.parse(
      await readFile(path.join(directory, "integrations.json"), "utf8"),
    ) as { integrations: Record<string, unknown> };
    expect(written.integrations["fixture"]).toEqual(enabledPolicy);
  });
});
