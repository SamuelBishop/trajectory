import { z } from "zod";
/**
 * Owns activity integrations in the main process.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY], [HC-NO-PLAINTEXT-HISTORY]
 *
 * `ipc.ts` is a boundary, not a place for logic, so the store, the adapter
 * registry, the policy file, and the credential lookup are assembled here. The
 * renderer talks to this through named verbs and receives a view that carries
 * no credential and no raw record — only counts, timestamps, and the declared
 * host list.
 */

import {
  createAdapters,
  githubConfigSchema,
  loadIntegrationsConfig,
  notionConfigSchema,
  policyFor,
  runSync,
  saveIntegrationsConfig,
  stravaConfigSchema,
  type IntegrationsConfig,
  type StravaTokenStore,
  type SyncTrigger,
} from "../engine/integrations";
import type { ActivityAdapter } from "../engine/integrations/types";
import type { ActivitySignal } from "../engine/domain";
import type {
  IntegrationPolicyView,
  IntegrationSummary,
  IntegrationsView,
} from "../shared/types";
import { EncryptedActivityStore } from "./activity-store";

/**
 * The renderer's shape for GitHub scope.
 *
 * Parsed rather than cast, because the renderer is a trust boundary and this
 * arrives over IPC. Camel case here and snake case in stored config is a real
 * seam, so the mapping is written out rather than spread.
 */
const githubScopeViewSchema = z.object({
  login: z.string().default(""),
  repositories: z.array(z.string()).default([]),
  organizations: z.array(z.string()).default([]),
  allRepositories: z.boolean().default(false),
  lookbackDays: z.number().default(7),
  domains: z.record(z.string(), z.string()).default({}),
});

/** The renderer's shape for Notion scope. Parsed, never cast, for the same reason. */
const notionScopeViewSchema = z.object({
  databaseId: z.string().default(""),
  taskSource: z.enum(["rows", "checkboxes"]).default("rows"),
  titleProperty: z.string().default("Name"),
  dateProperty: z.string().default("Date"),
  statusProperty: z.string().default("Status"),
  doneValues: z.array(z.string()).default([]),
  completedProperty: z.string().default(""),
  dueProperty: z.string().default(""),
  domainProperty: z.string().default(""),
  defaultDomain: z.string().default(""),
  includeOpenTasks: z.boolean().default(false),
  lookbackDays: z.number().default(7),
});

/** The renderer's shape for Strava scope. Parsed, never cast, for the same reason. */
const stravaScopeViewSchema = z.object({
  clientId: z.string().default(""),
  defaultDomain: z.string().default("running"),
  lookbackDays: z.number().default(30),
});

interface Encryption {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export class IntegrationService {
  private readonly store: EncryptedActivityStore;
  private readonly adapters: ActivityAdapter[];
  /** Why the last refresh declined to run, so Settings can say so. */
  private readonly skipped = new Map<string, string>();

  constructor(
    private readonly userDataPath: string,
    encryption: Encryption,
    /**
     * Reads a credential for an adapter. Injected because only `SecretStore`
     * may open one, and this class must never hold the file.
     */
    private readonly readCredential: (
      integrationId: string,
    ) => Promise<string | undefined> = () => Promise.resolve(undefined),
    /**
     * The domains the user's goals actually use. Injected because the engine
     * resolves no paths, and offered to Settings so the repository-to-domain
     * map can propose real targets instead of inviting a typo that silently
     * stops a commit from ever matching a goal.
     */
    private readonly readGoalDomains: () => Promise<string[]> = () =>
      Promise.resolve([]),
    /**
     * Injected so tests drive adapters against recorded payloads. Without this
     * seam a test that enables a network adapter reaches the real API, and a
     * suite that needs the network and a live token is one that stops being run.
     */
    httpFetch: typeof fetch = globalThis.fetch,
    /**
     * Reads and writes Strava's refresh token.
     *
     * Two-way where every other credential is read-only, because Strava rotates
     * it: the token endpoint may return a replacement on any successful call,
     * and the previous value is invalidated the moment it does. Defaulting to a
     * no-op store means an unwired Strava reports "needs a refresh token"
     * rather than silently fetching nothing.
     */
    stravaTokens: StravaTokenStore = {
      read: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
    },
  ) {
    this.store = new EncryptedActivityStore(
      EncryptedActivityStore.defaultPath(userDataPath),
      encryption,
    );
    this.adapters = createAdapters({
      httpFetch,
      githubConfig: async () =>
        (await loadIntegrationsConfig(this.userDataPath)).github,
      notionConfig: async () =>
        (await loadIntegrationsConfig(this.userDataPath)).notion,
      stravaConfig: async () =>
        (await loadIntegrationsConfig(this.userDataPath)).strava,
      stravaTokens,
    });
    this.encryptionAvailable = () => encryption.isAvailable();
  }

  private readonly encryptionAvailable: () => boolean;

  private adapter(id: string): ActivityAdapter {
    const found = this.adapters.find((candidate) => candidate.id === id);
    if (!found) {
      throw new Error(`Unknown integration "${id}".`);
    }
    return found;
  }

  async view(): Promise<IntegrationsView> {
    const config = await loadIntegrationsConfig(this.userDataPath);
    // Activity cannot be stored without encryption, so report an empty state
    // rather than crashing Settings on a machine where the OS keychain is
    // unavailable ([HC-NO-PLAINTEXT-HISTORY]).
    const status = this.encryptionAvailable()
      ? await this.store.status()
      : {};

    const integrations: IntegrationSummary[] = this.adapters.map((adapter) => {
      const entry = status[adapter.id];
      const skippedReason = this.skipped.get(adapter.id);
      const summary: IntegrationSummary = {
        id: adapter.id,
        label: adapter.label,
        hosts: [...adapter.hosts],
        requiresCredential: adapter.requiresCredential,
        policy: policyFor(config, adapter.id),
        lastSyncedAt: entry?.lastSyncedAt ?? null,
        lastError: entry?.lastError ?? null,
        signalCount: entry?.signalCount ?? 0,
      };
      return skippedReason === undefined
        ? summary
        : { ...summary, lastSkippedReason: skippedReason };
    });

    return {
      paused: config.paused,
      integrations,
      encryptionAvailable: this.encryptionAvailable(),
      github: {
        login: config.github.login,
        repositories: config.github.repositories,
        organizations: config.github.organizations,
        allRepositories: config.github.all_repositories,
        lookbackDays: config.github.lookback_days,
        domains: config.github.domains,
      },
      notion: {
        databaseId: config.notion.database_id,
        taskSource: config.notion.task_source,
        titleProperty: config.notion.title_property,
        dateProperty: config.notion.date_property,
        statusProperty: config.notion.status_property,
        doneValues: config.notion.done_values,
        completedProperty: config.notion.completed_property,
        dueProperty: config.notion.due_property,
        domainProperty: config.notion.domain_property,
        defaultDomain: config.notion.default_domain,
        includeOpenTasks: config.notion.include_open_tasks,
        lookbackDays: config.notion.lookback_days,
      },
      strava: {
        clientId: config.strava.client_id,
        defaultDomain: config.strava.default_domain,
        lookbackDays: config.strava.lookback_days,
      },
      goalDomains: await this.readGoalDomains().catch(() => []),
    };
  }

  /**
   * Replace the GitHub scope.
   *
   * Empty scope is a legitimate saved state, not an error: it is the default,
   * and it means the adapter makes no request at all.
   */
  async saveGitHubScope(scope: unknown): Promise<void> {
    const view = githubScopeViewSchema.parse(scope);
    const config = await loadIntegrationsConfig(this.userDataPath);
    await saveIntegrationsConfig(this.userDataPath, {
      ...config,
      // Rebuilt field by field rather than spread, so the renderer cannot smuggle
      // an unexpected key into stored config. The schema then re-validates.
      github: githubConfigSchema.parse({
        login: view.login,
        repositories: view.repositories,
        organizations: view.organizations,
        all_repositories: view.allRepositories,
        lookback_days: view.lookbackDays,
        domains: view.domains,
      }),
    });
  }

  /**
   * Replace the Notion scope.
   *
   * The database ID is stored as the user typed it — a pasted URL is normalized
   * by the adapter at query time rather than here, so what Settings shows back
   * is what they entered and a bad paste stays visible instead of becoming a
   * silently empty field.
   */
  async saveNotionScope(scope: unknown): Promise<void> {
    const view = notionScopeViewSchema.parse(scope);
    const config = await loadIntegrationsConfig(this.userDataPath);
    await saveIntegrationsConfig(this.userDataPath, {
      ...config,
      // Rebuilt field by field rather than spread, so the renderer cannot
      // smuggle an unexpected key into stored config. The schema re-validates.
      notion: notionConfigSchema.parse({
        database_id: view.databaseId,
        task_source: view.taskSource,
        title_property: view.titleProperty,
        date_property: view.dateProperty,
        status_property: view.statusProperty,
        done_values: view.doneValues,
        completed_property: view.completedProperty,
        due_property: view.dueProperty,
        domain_property: view.domainProperty,
        default_domain: view.defaultDomain,
        include_open_tasks: view.includeOpenTasks,
        lookback_days: view.lookbackDays,
      }),
    });
  }

  /**
   * Replace the Strava scope.
   *
   * Only the application ID and the goal mapping live here. The client secret
   * and the refresh token are credentials and go to `SecretStore`, so this
   * method never sees one.
   */
  async saveStravaScope(scope: unknown): Promise<void> {
    const view = stravaScopeViewSchema.parse(scope);
    const config = await loadIntegrationsConfig(this.userDataPath);
    await saveIntegrationsConfig(this.userDataPath, {
      ...config,
      // Rebuilt field by field rather than spread, so the renderer cannot
      // smuggle an unexpected key into stored config. The schema re-validates.
      strava: stravaConfigSchema.parse({
        client_id: view.clientId,
        default_domain: view.defaultDomain,
        lookback_days: view.lookbackDays,
      }),
    });
  }

  async sync(integrationId: string, trigger: SyncTrigger): Promise<void> {
    const adapter = this.adapter(integrationId);
    const config = await loadIntegrationsConfig(this.userDataPath);
    const credential = adapter.requiresCredential
      ? await this.readCredential(integrationId)
      : undefined;

    const outcome = await runSync({
      adapter,
      policy: policyFor(config, integrationId),
      trigger,
      sink: this.store,
      globallyPaused: config.paused,
      now: new Date(),
      ...(credential === undefined ? {} : { credential }),
    });

    if (outcome.status === "skipped") {
      // A disabled integration declining an automatic trigger is not news — the
      // toggle already says so, and reporting it would put a permanent notice
      // on every integration the user has chosen not to use. An explicit
      // refresh still gets an answer, because there the user asked.
      const worthReporting =
        trigger === "manual" || policyFor(config, integrationId).enabled;
      if (worthReporting) {
        this.skipped.set(integrationId, outcome.reason);
      } else {
        this.skipped.delete(integrationId);
      }
    } else {
      this.skipped.delete(integrationId);
    }
  }

  /**
   * Run every enabled integration once at launch. Failures are recorded on the
   * integration rather than raised, because a broken adapter must not stop the
   * app from starting.
   */
  async syncOnLaunch(): Promise<void> {
    for (const adapter of this.adapters) {
      await this.sync(adapter.id, "app_load").catch((error: unknown) => {
        console.error(
          `Launch sync failed for "${adapter.id}":`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }

  /**
   * The signals chat may ground in.
   *
   * Only enabled integrations contribute. Turning one off means "stop using
   * this", so leaving its stored records in the prompt would make the toggle a
   * lie — the data stays on disk until the user deletes it, but it stops
   * reaching the model immediately.
   */
  async signalsForPrompt(): Promise<ActivitySignal[]> {
    if (!this.encryptionAvailable()) {
      return [];
    }
    const config = await loadIntegrationsConfig(this.userDataPath);
    const enabled = new Set(
      this.adapters
        .filter((adapter) => policyFor(config, adapter.id).enabled)
        .map((adapter) => adapter.id),
    );
    if (enabled.size === 0) {
      return [];
    }
    const signals = await this.store.list();
    return signals.filter((signal) => enabled.has(signal.integration_id));
  }

  async savePolicy(
    integrationId: string,
    policy: IntegrationPolicyView,
  ): Promise<void> {
    this.adapter(integrationId);
    const config = await loadIntegrationsConfig(this.userDataPath);
    // Spread the whole config rather than rebuilding it. Naming each field here
    // means every field added later is silently dropped the next time a user
    // toggles a switch, which destroys their scope settings without a word.
    const next: IntegrationsConfig = {
      ...config,
      integrations: { ...config.integrations, [integrationId]: policy },
    };
    await saveIntegrationsConfig(this.userDataPath, next);
    this.skipped.delete(integrationId);
  }

  async setPaused(paused: boolean): Promise<void> {
    const config = await loadIntegrationsConfig(this.userDataPath);
    await saveIntegrationsConfig(this.userDataPath, { ...config, paused });
  }

  /**
   * Erase what was collected. This deletes the signals outright rather than
   * marking them hidden, because a delete control that keeps the data is a lie.
   */
  async deleteData(integrationId: string): Promise<void> {
    this.adapter(integrationId);
    await this.store.deleteIntegration(integrationId);
    this.skipped.delete(integrationId);
  }
}
