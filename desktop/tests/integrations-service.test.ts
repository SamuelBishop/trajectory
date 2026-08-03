import { mkdtemp, readFile, rm } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { IntegrationService } from "../src/main/integrations";
import { loadIntegrationsConfig } from "../src/engine/integrations";
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

/**
 * Invented training log. The key is generated here so none is committed.
 *
 * Replies in the order the adapter asks: token, tab metadata, then values.
 */
const { privateKey: sheetsKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SHEETS_ACCOUNT = JSON.stringify({
  client_email: "trajectory-reader@example-project.iam.gserviceaccount.com",
  private_key: sheetsKey,
});

/**
 * A local calendar date, offset in days from today.
 *
 * Relative rather than fixed, because this test drives the real service and so
 * the real clock. A hard-coded date would sit outside the lookback window the
 * moment it aged past it, and the suite would go quietly green with no signals.
 */
function sheetsDay(offset: number): string {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

const sheetsStub = ((url: string) => {
  const address = String(url);
  if (address.includes("oauth2.googleapis.com")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({ access_token: "access-value", expires_in: 3600 }),
        { status: 200 },
      ),
    );
  }
  if (address.includes("/values/")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          values: [
            ["Date", "Workout", "Actual", "Running \nMiles"],
            ["", "what was planned", "what happened", "miles run"],
            [sheetsDay(-1), "6 mi easy", "6.2 mi easy", 6.2],
            [sheetsDay(0), "8 x 400m", "", ""],
          ],
        }),
        { status: 200 },
      ),
    );
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({ sheets: [{ properties: { title: "2026 Log" } }] }),
      { status: 200 },
    ),
  );
}) as unknown as typeof fetch;

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

  it("round-trips the Google Sheets scope through stored config", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGoogleSheetsScope({
      spreadsheetId:
        "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd/edit",
      tabName: "2026",
      headerRow: 1,
      firstDataRow: 3,
      clientEmail: "log-reader@sample-project.iam.gserviceaccount.com",
      noteColumns: ["Notes", "Comments from Coach"],
      metricColumns: ["Running \nMiles", "RPE"],
      defaultDomain: "running",
      lookbackDays: 45,
    });

    const view = await service.view();
    // Stored as typed, like Notion: normalizing the URL away here would mean a
    // bad paste came back as a blank field with nothing to correct.
    expect(view.googleSheets.spreadsheetId).toContain("docs.google.com");
    expect(view.googleSheets.firstDataRow).toBe(3);
    expect(view.googleSheets.noteColumns).toEqual([
      "Notes",
      "Comments from Coach",
    ]);
    // Round-trips as the headers the user chose, not as the derived keys.
    expect(view.googleSheets.metricColumns).toEqual(["Running \nMiles", "RPE"]);
    expect(view.googleSheets.lookbackDays).toBe(45);
  });

  it("derives a metric name for every numeric column it keeps", async () => {
    // The adapter reads a header-to-key map. The renderer only says which
    // columns to keep, so the key has to be derived here or the metrics arrive
    // with no name and cannot be cited.
    const directory = await userDataPath();
    const service = new IntegrationService(directory, testEncryption);
    await service.saveGoogleSheetsScope({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      metricColumns: ["Running \nMiles", "Work load", "—"],
    });

    const stored = await loadIntegrationsConfig(directory);
    expect(stored.google_sheets.metric_columns).toEqual({
      "Running \nMiles": "running_miles",
      "Work load": "work_load",
    });
  });

  it("records the service account without disturbing the columns", async () => {
    // Storing a key arrives from a JSON paste, the columns from a form. The two
    // must not overwrite each other, or re-pasting the key after a rotation
    // would quietly reset the sheet back to its default column names.
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGoogleSheetsScope({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      plannedColumn: "Prescribed",
      actualColumn: "Completed",
      firstDataRow: 3,
    });

    await service.saveGoogleServiceAccountEmail(
      "log-reader@sample-project.iam.gserviceaccount.com",
    );

    const view = await service.view();
    expect(view.googleSheets.clientEmail).toBe(
      "log-reader@sample-project.iam.gserviceaccount.com",
    );
    expect(view.googleSheets.plannedColumn).toBe("Prescribed");
    expect(view.googleSheets.actualColumn).toBe("Completed");
    expect(view.googleSheets.firstDataRow).toBe(3);
  });

  it("keeps the Google Sheets scope when an unrelated policy is saved", async () => {
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGoogleSheetsScope({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      tabName: "2026",
    });

    await service.savePolicy("fixture", enabledPolicy);

    const view = await service.view();
    expect(view.googleSheets.tabName).toBe("2026");
  });

  it("carries a skipped training session all the way to the mentor's context", async () => {
    // End to end through the real service, not the adapter alone. The stored
    // credential has to be exactly what the adapter can parse — storing the
    // private key on its own typechecks, saves without complaint, and then
    // fails on the first sync, which no unit test on either side would catch.
    const service = new IntegrationService(
      await userDataPath(),
      testEncryption,
      () => Promise.resolve(SHEETS_ACCOUNT),
      () => Promise.resolve(["training"]),
      sheetsStub,
    );
    await service.saveGoogleSheetsScope({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      tabName: "2026 Log",
      firstDataRow: 3,
      metricColumns: ["Running \nMiles"],
      defaultDomain: "training",
      lookbackDays: 30,
    });
    await service.savePolicy("google_sheets", enabledPolicy);
    await service.sync("google_sheets", "manual");

    const view = await service.view();
    const sheets = view.integrations.find(
      (entry) => entry.id === "google_sheets",
    );
    expect(sheets?.lastError).toBeNull();
    expect(sheets?.signalCount).toBe(2);

    const signals = await service.signalsForPrompt();
    const context = buildActivityContext(
      "How is my training going?",
      [{ domain: "training" }],
      signals,
      sheetsDay(0),
    );
    const done = context?.signals.find((signal) => signal.completed);
    const missed = context?.signals.find((signal) => !signal.completed);

    // The whole reason this integration exists: a session that was prescribed
    // and not done is observable, which no other source can report.
    expect(done?.summary).toContain("6.2 mi easy");
    expect(done?.metrics.running_miles).toBe(6.2);
    expect(missed?.summary).toContain("8 x 400m");
    expect(missed?.completed).toBe(false);
  });

  it("keeps the service account address when a stale form saves over it", async () => {
    // The pane holding the scope form may have loaded before the key was
    // pasted, so its copy of the address is empty or belongs to a previous
    // key. Taking it would leave Settings telling the user to share their
    // sheet with an account that is not the one signing the request — and the
    // resulting error says "share it with this address" for a sheet already
    // shared with the address on screen.
    const service = new IntegrationService(await userDataPath(), testEncryption);
    await service.saveGoogleServiceAccountEmail(
      "log-reader@sample-project.iam.gserviceaccount.com",
    );

    await service.saveGoogleSheetsScope({
      spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      clientEmail: "",
      tabName: "2026",
    });

    const view = await service.view();
    expect(view.googleSheets.clientEmail).toBe(
      "log-reader@sample-project.iam.gserviceaccount.com",
    );
    expect(view.googleSheets.tabName).toBe("2026");
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
