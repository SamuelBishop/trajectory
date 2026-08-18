/**
 * Orchestrates personalized starter prompts with encrypted caching.
 *
 * Implements: [HC-NO-PLAINTEXT-HISTORY], [HC-NO-PROVIDER-FALLBACK]
 *
 * Cache-first: getCached returns whatever is stored (possibly stale), and
 * refresh regenerates. The renderer decides when to trigger; the service never
 * calls a provider speculatively.
 */

import { generateStarterPrompts } from "../engine/mentorship";
import { localDate } from "../engine/integrations/rollup";
import type { MentorProvider } from "../engine/providers/types";
import type { ActivitySignal } from "../engine/domain";
import type { Settings } from "../engine/settings";
import type {
  EncryptedStarterPromptStore,
  StarterPromptRecord,
} from "./starter-prompt-store";

export interface StarterPromptDependencies {
  store: EncryptedStarterPromptStore;
  loadSettings(): Promise<Settings>;
  createProvider(settings: Settings): Promise<MentorProvider>;
  directories(): Promise<{ userDirectory: string; mentorDirectory: string }>;
  signalsForPrompt(): Promise<ActivitySignal[]>;
  now?(): Date;
}

export interface StarterPromptCacheResult {
  record: StarterPromptRecord | null;
  fresh: boolean;
}

export class StarterPromptService {
  private refreshing:
    | { key: string; promise: Promise<StarterPromptRecord> }
    | null = null;
  private refreshGeneration = 0;

  constructor(private readonly deps: StarterPromptDependencies) {}

  async getCached(): Promise<StarterPromptCacheResult> {
    const settings = await this.deps.loadSettings();
    const record = await this.deps.store.get();
    return {
      record,
      fresh: this.deps.store.isFresh(
        record,
        settings.provider,
        settings.model,
        this.now(),
      ),
    };
  }

  /**
   * Regenerate starter prompts using the current provider and context.
   *
   * Concurrent calls share the same in-flight request. On failure the previous
   * cache is preserved and the error is thrown — there is no generic fallback
   * (`[HC-NO-PROVIDER-FALLBACK]`).
   */
  async refresh(): Promise<StarterPromptRecord> {
    const settings = await this.deps.loadSettings();
    const key = `${settings.provider}\u0000${settings.model}`;
    if (this.refreshing?.key === key) {
      return await this.refreshing.promise;
    }
    const generation = ++this.refreshGeneration;
    const attempt = this.execute(settings, generation);
    this.refreshing = { key, promise: attempt };
    try {
      return await attempt;
    } finally {
      if (this.refreshing?.promise === attempt) {
        this.refreshing = null;
      }
    }
  }

  private async execute(
    settings: Settings,
    generation: number,
  ): Promise<StarterPromptRecord> {
    const [provider, directories, signals] = await Promise.all([
      this.deps.createProvider(settings),
      this.deps.directories(),
      this.deps.signalsForPrompt(),
    ]);

    const now = this.now();
    const { prompts } = await generateStarterPrompts(provider, directories, {
      signals,
      today: localDate(now),
    });

    const record: StarterPromptRecord = {
      generatedAt: now.toISOString(),
      provider: settings.provider,
      model: settings.model,
      prompts: prompts.prompts,
    };
    if (generation !== this.refreshGeneration) {
      throw new Error(
        "Starter prompt refresh was superseded by a newer provider selection.",
      );
    }
    return await this.deps.store.save(record);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }
}
