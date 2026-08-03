import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntegrationService } from "../src/main/integrations";
import { buildActivityContext } from "../src/engine/selection";

/** Invented commit payload. No test here touches the network. */
const githubStub = ((url: string) =>
  Promise.resolve(
    new Response(
      JSON.stringify(
        String(url).includes("/search/commits")
          ? {
              items: [
                {
                  sha: "abc123def4567890",
                  html_url:
                    "https://github.com/octo-sample/api-service/commit/abc123d",
                  commit: {
                    message: "Add retry handling to the importer",
                    committer: { date: "2026-03-09T18:22:11Z" },
                  },
                  repository: { full_name: "octo-sample/api-service" },
                },
              ],
            }
          : { stats: { additions: 12, deletions: 3 }, files: [1] },
      ),
      { status: 200 },
    ),
  )) as unknown as typeof fetch;

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
    expect(view.integrations.map((entry) => entry.id)).toEqual([
      "fixture",
      "github",
      "notion",
      "strava",
      "google_sheets",
    ]);
    for (const entry of view.integrations) {
      expect(entry).toMatchObject({
        policy: { enabled: false },
        signalCount: 0,
        lastSyncedAt: null,
        lastError: null,
      });
    }
    // Nothing is in scope until the user puts it there.
    expect(view.github).toMatchObject({
      login: "",
      repositories: [],
      organizations: [],
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

  it("carries a GitHub commit all the way to the mentor's context", async () => {
    const service = new IntegrationService(
      await userDataPath(),
      testEncryption,
      () => Promise.resolve("token-value"),
      () => Promise.resolve(["career"]),
      githubStub,
    );
    await service.saveGitHubScope({
      login: "sample-user",
      repositories: ["octo-sample/api-service"],
      domains: { "octo-sample/api-service": "career" },
    });
    await service.savePolicy("github", enabledPolicy);
    await service.sync("github", "manual");

    const view = await service.view();
    const github = view.integrations.find((entry) => entry.id === "github");
    expect(github?.lastError).toBeNull();
    expect(github?.signalCount).toBe(1);

    // The whole point of the adapter: a commit becomes a signal, the domain map
    // makes it match a goal, and selection admits it for a relevant question.
    const signals = await service.signalsForPrompt();
    const context = buildActivityContext(
      "How is my career work going?",
      [{ domain: "career" }],
      signals,
      "2026-03-10",
    );
    expect(context?.signals.map((signal) => signal.id)).toEqual([
      "github_abc123def456",
    ]);
    expect(context?.signals[0]?.summary).toBe("Add retry handling to the importer");
  });

  it("reaches the mentor even when the repository is mapped to no goal", async () => {
    const service = new IntegrationService(
      await userDataPath(),
      testEncryption,
      () => Promise.resolve("token-value"),
      () => Promise.resolve(["career"]),
      githubStub,
    );
    await service.saveGitHubScope({
      login: "sample-user",
      repositories: ["octo-sample/api-service"],
      domains: {},
    });
    await service.savePolicy("github", enabledPolicy);
    await service.sync("github", "manual");

    // With no mapping the domain is a slug of the repository, matching no goal.
    // It reaches the mentor anyway, which is the point: the model reads the
    // repository name and the commit message and works out which goal the work
    // serves. Requiring a hand-written map first made unmapped work invisible
    // rather than merely unlabelled.
    const signals = await service.signalsForPrompt();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.domain).toBe("api-service");

    const context = buildActivityContext(
      "How is my career work going?",
      [{ domain: "career" }],
      signals,
      "2026-03-10",
    );
    expect(context?.signals.map((item) => item.domain)).toEqual([
      "api-service",
    ]);
  });

  it("defaults to a bounded window and to reading no repository", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    const view = await service.view();

    // Both defaults are decisions the user has not made yet, so they take the
    // conservative side: a week rather than all of history, and nothing rather
    // than everything the credential can reach.
    expect(view.github.lookbackDays).toBe(7);
    expect(view.github.allRepositories).toBe(false);
  });

  it("round-trips the window and the all-repositories opt-in", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGitHubScope({
      login: "sample-user",
      repositories: [],
      organizations: [],
      allRepositories: true,
      lookbackDays: 30,
      domains: {},
    });

    const view = await service.view();
    expect(view.github.allRepositories).toBe(true);
    expect(view.github.lookbackDays).toBe(30);
  });

  it("keeps the GitHub scope when an unrelated policy is saved", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.saveGitHubScope({
      login: "sample-user",
      repositories: ["octo-sample/api-service"],
      domains: { "octo-sample/api-service": "career" },
    });

    // Toggling any integration rewrites integrations.json. Rebuilding that file
    // field by field would silently erase the scope the user configured.
    await service.savePolicy("fixture", enabledPolicy);

    const view = await service.view();
    expect(view.github.login).toBe("sample-user");
    expect(view.github.repositories).toEqual(["octo-sample/api-service"]);
    expect(view.github.domains).toEqual({ "octo-sample/api-service": "career" });
  });

  it("round-trips the Notion scope through stored config", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveNotionScope({
      databaseId: "https://www.notion.so/Tasks-11112222333344445555666677778888",
      titleProperty: "Task",
      statusProperty: "State",
      doneValues: ["Shipped"],
      completedProperty: "Closed on",
      dueProperty: "Target",
      domainProperty: "Area",
      defaultDomain: "projects",
      includeOpenTasks: true,
      lookbackDays: 14,
    });

    const view = await service.view();
    // Stored as typed. Normalizing the URL away here would mean a bad paste
    // came back as a blank field with nothing to correct.
    expect(view.notion.databaseId).toContain("notion.so");
    expect(view.notion.statusProperty).toBe("State");
    expect(view.notion.doneValues).toEqual(["Shipped"]);
    expect(view.notion.includeOpenTasks).toBe(true);
    expect(view.notion.lookbackDays).toBe(14);
  });

  it("keeps the Notion scope when an unrelated policy is saved", async () => {
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.saveNotionScope({
      databaseId: "11112222333344445555666677778888",
      statusProperty: "State",
      defaultDomain: "projects",
    });

    await service.savePolicy("fixture", enabledPolicy);

    const view = await service.view();
    expect(view.notion.statusProperty).toBe("State");
    expect(view.notion.defaultDomain).toBe("projects");
  });

  it("keeps the GitHub and Notion scopes apart", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGitHubScope({
      login: "sample-user",
      repositories: ["octo-sample/api-service"],
    });
    await service.saveNotionScope({ databaseId: "11112222333344445555666677778888" });

    // Each save rebuilds only its own branch of the config. Writing one must not
    // reset the other, which is what a spread over the whole object would do.
    const view = await service.view();
    expect(view.github.login).toBe("sample-user");
    expect(view.notion.databaseId).toBe("11112222333344445555666677778888");
  });

  it("refuses a GitHub scope it cannot validate", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await expect(
      service.saveGitHubScope({ login: 5, repositories: "not-a-list" }),
    ).rejects.toThrow();
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
    await expect(service.sync("nonesuch", "manual")).rejects.toThrow(
      /Unknown integration/,
    );
    await expect(service.deleteData("nonesuch")).rejects.toThrow(
      /Unknown integration/,
    );
    await expect(service.savePolicy("nonesuch", enabledPolicy)).rejects.toThrow(
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
