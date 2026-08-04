/**
 * Runs the daily briefing and posts the notification.
 *
 * Implements: [HC-NO-PLAINTEXT-HISTORY], [HC-NO-PROVIDER-FALLBACK]
 *
 * Three rules shape everything here:
 *
 * 1. **Sync first, then say what is stale.** The briefing is only worth
 *    interrupting someone for if it read today rather than yesterday, and a
 *    source that failed to refresh must be named rather than read as silence.
 * 2. **Never notify on failure.** A provider outage, a missing key, or no
 *    active goals are all recorded and visible in the pane. A daily alert that
 *    says "briefing failed" is how a feature gets muted.
 * 3. **One attempt per local day**, successful or not, so an outage does not
 *    make the sixty-second poll retry until midnight.
 *
 * The Electron surface is injected rather than imported so the whole service is
 * testable without launching a browser window.
 */

import {
  DEFAULT_BRIEFING_MINUTE,
  decideBriefing,
} from "../engine/briefing-schedule";
import {
  GENERIC_NOTIFICATION_BODY,
  NOTIFICATION_TITLE,
  notificationBodyFor,
} from "../engine/notification-text";
import { localDate } from "../engine/integrations/rollup";
import { dailyBriefing } from "../engine/mentorship";
import type { MentorProvider } from "../engine/providers/types";
import type { ActivitySignal } from "../engine/domain";
import type { Settings } from "../engine/settings";
import type { BriefingRecord, EncryptedBriefingStore } from "./briefing-store";

/** How often the poll asks whether the briefing is due. */
export const BRIEFING_POLL_MS = 60_000;

export interface BriefingNotifier {
  isSupported(): boolean;
  notify(options: { title: string; body: string }): void;
}

export interface BriefingDependencies {
  store: EncryptedBriefingStore;
  loadSettings(): Promise<Settings>;
  createProvider(settings: Settings): Promise<MentorProvider>;
  directories(): Promise<{ userDirectory: string; mentorDirectory: string }>;
  syncForBriefing(): Promise<string[]>;
  signalsForPrompt(): Promise<ActivitySignal[]>;
  notifier: BriefingNotifier;
  now?(): Date;
}

export type BriefingRunTrigger = "manual" | "scheduled";

export interface BriefingRunOutcome {
  status: "completed" | "failed" | "skipped";
  reason: string;
  record: BriefingRecord | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class BriefingService {
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Guards against a second run starting while the first is still talking to
   * the provider. A briefing takes seconds and the poll fires every minute, so
   * without this a slow provider would be asked twice for the same day.
   */
  private running: Promise<BriefingRunOutcome> | null = null;

  constructor(private readonly dependencies: BriefingDependencies) {}

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  /** Starts the poll. Safe to call twice; the second call is ignored. */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runIfDue();
    }, BRIEFING_POLL_MS);
    // Do not hold the process open for the sake of the poll. On macOS the app
    // survives its last window anyway, which is what makes a midday
    // notification possible.
    this.timer.unref?.();
    // Check immediately as well as on the interval, so a launch after the due
    // time catches up now rather than up to a minute later.
    void this.runIfDue();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runIfDue(): Promise<BriefingRunOutcome> {
    const settings = await this.dependencies.loadSettings();
    const now = this.now();
    let lastRunDate: string | null;
    try {
      lastRunDate = await this.dependencies.store.lastRunDate();
    } catch (error) {
      // Encryption unavailable, most likely. Do not run: a briefing that
      // cannot be stored would notify once and then vanish, and the pane would
      // show nothing to explain it.
      return { status: "skipped", reason: describe(error), record: null };
    }

    const decision = decideBriefing({
      now,
      dueMinute: settings.briefingMinute ?? DEFAULT_BRIEFING_MINUTE,
      lastRunDate,
      enabled: settings.briefingEnabled,
    });
    if (!decision.run) {
      return { status: "skipped", reason: decision.reason, record: null };
    }
    return await this.run("scheduled");
  }

  /**
   * Runs now regardless of schedule, for the pane's "Run now" button.
   *
   * A manual run still writes today's record, so pressing it at 11:00 means the
   * scheduled run at noon does not also fire. That is the intended reading of
   * "one briefing a day".
   */
  async runNow(): Promise<BriefingRunOutcome> {
    return await this.run("manual");
  }

  private async run(trigger: BriefingRunTrigger): Promise<BriefingRunOutcome> {
    if (this.running !== null) {
      return await this.running;
    }
    const attempt = this.execute(trigger);
    this.running = attempt;
    try {
      return await attempt;
    } finally {
      this.running = null;
    }
  }

  private async execute(
    trigger: BriefingRunTrigger,
  ): Promise<BriefingRunOutcome> {
    const now = this.now();
    const date = localDate(now);
    const generatedAt = now.toISOString();

    let staleSources: string[] = [];
    try {
      staleSources = await this.dependencies.syncForBriefing();
    } catch (error) {
      // A sync that throws outright still leaves the previously stored signals
      // usable, so compose from them rather than abandoning the day. What must
      // not happen is composing as if everything were fresh.
      console.error("Briefing sync failed:", describe(error));
      staleSources = ["every source"];
    }

    try {
      const settings = await this.dependencies.loadSettings();
      const [provider, directories, signals] = await Promise.all([
        this.dependencies.createProvider(settings),
        this.dependencies.directories(),
        this.dependencies.signalsForPrompt(),
      ]);

      const { briefing } = await dailyBriefing(
        provider,
        directories,
        { signals, today: date },
        staleSources,
      );

      const includeHeadline = settings.briefingHeadlineInNotification;
      const notified = this.postNotification(briefing.headline, includeHeadline);
      const record = await this.dependencies.store.saveSuccess({
        date,
        generatedAt,
        briefing,
        staleSources,
        notified,
      });
      return { status: "completed", reason: `Briefing ${trigger}.`, record };
    } catch (error) {
      const message = describe(error);
      console.error("Briefing failed:", message);
      try {
        const record = await this.dependencies.store.saveFailure({
          date,
          generatedAt,
          message,
          staleSources,
        });
        return { status: "failed", reason: message, record };
      } catch (storeError) {
        // Nothing left to do but report. Deliberately no notification: the user
        // would get an alert they cannot act on and no record to look at.
        return {
          status: "failed",
          reason: `${message} (and the result could not be stored: ${describe(storeError)})`,
          record: null,
        };
      }
    }
  }

  /**
   * Hands text to the operating system. The only place in the app that does.
   *
   * Returns whether a notification was actually posted, which the record keeps
   * so the pane can distinguish "you were told" from "this was waiting here".
   */
  private postNotification(headline: string, includeHeadline: boolean): boolean {
    if (!this.dependencies.notifier.isSupported()) {
      return false;
    }
    this.dependencies.notifier.notify({
      title: NOTIFICATION_TITLE,
      body: notificationBodyFor({ headline, includeHeadline }),
    });
    return true;
  }
}

export { GENERIC_NOTIFICATION_BODY };
