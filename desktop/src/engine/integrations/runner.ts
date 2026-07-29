/**
 * Run one adapter, respecting policy, and record what happened.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY]
 *
 * The order here is the security-relevant part: policy is evaluated *before*
 * the adapter is touched, so a disabled integration produces no call rather
 * than a call whose result is discarded. `[HC-NO-EXFILTRATION]` makes the
 * enabled flag part of the bar, not a UI affordance.
 *
 * The sink is an interface rather than a concrete store so this stays testable
 * without Electron. `EncryptedActivityStore` in the main process satisfies it
 * structurally; the engine never imports from `main/`.
 */

import type { ActivitySignal } from "../domain";
import {
  decideSync,
  type IntegrationPolicy,
  type SyncTrigger,
} from "./policy";
import { localDate } from "./rollup";
import type { ActivityAdapter } from "./types";

export interface SignalSink {
  latestOccurredAt(integrationId: string): Promise<string | null>;
  merge(
    integrationId: string,
    incoming: readonly ActivitySignal[],
    options: { retentionDays: number; today: string; syncedAt: string },
  ): Promise<number>;
  recordFailure(integrationId: string, message: string): Promise<void>;
}

export type SyncOutcome =
  | { status: "skipped"; integrationId: string; reason: string }
  | { status: "synced"; integrationId: string; signalCount: number }
  | { status: "failed"; integrationId: string; problem: string };

/**
 * A credential is passed in rather than read here. Only the main process can
 * open `SecretStore`, and keeping the read there means this module never holds
 * a value it could accidentally log.
 */
export async function runSync(input: {
  adapter: ActivityAdapter;
  policy: IntegrationPolicy;
  trigger: SyncTrigger;
  sink: SignalSink;
  globallyPaused: boolean;
  now: Date;
  credential?: string;
}): Promise<SyncOutcome> {
  const { adapter, policy, trigger, sink, globallyPaused, now, credential } =
    input;

  const lastSyncedAt = await sink
    .latestOccurredAt(adapter.id)
    .catch(() => null);

  const decision = decideSync({
    policy,
    trigger,
    now,
    lastSyncedAt,
    globallyPaused,
  });
  if (!decision.sync) {
    return { status: "skipped", integrationId: adapter.id, reason: decision.reason };
  }

  if (adapter.requiresCredential && (credential ?? "").length === 0) {
    const problem = `${adapter.label} needs a credential before it can sync. ${adapter.credentialHint}`;
    await sink.recordFailure(adapter.id, problem);
    return { status: "failed", integrationId: adapter.id, problem };
  }

  try {
    const signals = await adapter.fetch(lastSyncedAt, credential);
    const today = localDate(now);
    const signalCount = await sink.merge(adapter.id, signals, {
      retentionDays: policy.retention_days,
      today,
      syncedAt: now.toISOString(),
    });
    return { status: "synced", integrationId: adapter.id, signalCount };
  } catch (error) {
    // The adapter's message reaches the user because a rate limit, an expired
    // authorization, and an unshared database are all things only they can fix
    // — but adapters are required never to put a credential in one.
    const problem = error instanceof Error ? error.message : String(error);
    await sink.recordFailure(adapter.id, problem);
    return { status: "failed", integrationId: adapter.id, problem };
  }
}
