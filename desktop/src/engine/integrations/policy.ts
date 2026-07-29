/**
 * When an integration is allowed to run.
 *
 * Implements: [HC-EXPLICIT-CONFIG-PATHS]
 *
 * The timer is the mode that could turn this product into a surveillance tool,
 * so the controls that stop it are part of the substrate rather than a later
 * polish pass: a global pause, per-integration quiet hours, and an enabled flag
 * that is checked before the network rather than after it.
 *
 * Trigger semantics differ on purpose. An explicit refresh is the user acting
 * now, so it overrides the pause and the quiet window — those exist to stop the
 * app from acting on its own, not to stop the user. Automatic triggers respect
 * everything.
 */

import path from "node:path";
import { readFile } from "node:fs/promises";

import { z } from "zod";

import { writeFileAtomic } from "../writer";

export const INTEGRATIONS_FILE = "integrations.json";

const hourOfDaySchema = z.number().int().min(0).max(23);

/** `start === end` means there is no quiet window at all. */
export const quietHoursSchema = z.strictObject({
  start: hourOfDaySchema.default(0),
  end: hourOfDaySchema.default(0),
});

export const syncModesSchema = z.strictObject({
  on_app_load: z.boolean().default(false),
  on_demand: z.boolean().default(true),
  /** Zero disables the timer. */
  timer_minutes: z.number().int().min(0).max(10_080).default(0),
});

export const integrationPolicySchema = z.strictObject({
  enabled: z.boolean().default(false),
  sync: syncModesSchema.prefault({}),
  quiet_hours: quietHoursSchema.prefault({}),
  /** Days of history to keep. Older signals are pruned on write. */
  retention_days: z.number().int().min(1).max(3650).default(180),
});

export const integrationsConfigSchema = z.strictObject({
  /** Stops every automatic sync across every integration at once. */
  paused: z.boolean().default(false),
  integrations: z.record(z.string(), integrationPolicySchema).default({}),
});

export type QuietHours = z.infer<typeof quietHoursSchema>;
export type SyncModes = z.infer<typeof syncModesSchema>;
export type IntegrationPolicy = z.infer<typeof integrationPolicySchema>;
export type IntegrationsConfig = z.infer<typeof integrationsConfigSchema>;

export const DEFAULT_POLICY: IntegrationPolicy =
  integrationPolicySchema.parse({});
export const DEFAULT_INTEGRATIONS_CONFIG: IntegrationsConfig =
  integrationsConfigSchema.parse({});

export type SyncTrigger = "manual" | "app_load" | "timer";

export interface SyncDecision {
  sync: boolean;
  /** Always populated, so the UI can say why a refresh did nothing. */
  reason: string;
}

/**
 * A quiet window may wrap midnight — 22 to 7 is the common case, and it is two
 * ranges rather than one.
 */
export function isWithinQuietHours(
  hourOfDay: number,
  quiet: QuietHours,
): boolean {
  if (quiet.start === quiet.end) {
    return false;
  }
  if (quiet.start < quiet.end) {
    return hourOfDay >= quiet.start && hourOfDay < quiet.end;
  }
  return hourOfDay >= quiet.start || hourOfDay < quiet.end;
}

export function decideSync(input: {
  policy: IntegrationPolicy;
  trigger: SyncTrigger;
  now: Date;
  lastSyncedAt: string | null;
  globallyPaused: boolean;
}): SyncDecision {
  const { policy, trigger, now, lastSyncedAt, globallyPaused } = input;

  if (!policy.enabled) {
    return { sync: false, reason: "The integration is turned off." };
  }

  if (trigger === "manual") {
    return policy.sync.on_demand
      ? { sync: true, reason: "Refreshed on request." }
      : { sync: false, reason: "On-demand refresh is turned off." };
  }

  if (globallyPaused) {
    return { sync: false, reason: "All automatic syncing is paused." };
  }

  if (isWithinQuietHours(now.getHours(), policy.quiet_hours)) {
    return { sync: false, reason: "Inside quiet hours." };
  }

  if (trigger === "app_load") {
    return policy.sync.on_app_load
      ? { sync: true, reason: "Synced on launch." }
      : { sync: false, reason: "Sync on launch is turned off." };
  }

  if (policy.sync.timer_minutes <= 0) {
    return { sync: false, reason: "The timer is turned off." };
  }
  if (lastSyncedAt === null) {
    return { sync: true, reason: "No previous sync." };
  }
  const previous = Date.parse(lastSyncedAt);
  if (Number.isNaN(previous)) {
    return { sync: true, reason: "The last sync time was unreadable." };
  }
  const elapsedMinutes = (now.getTime() - previous) / 60_000;
  return elapsedMinutes >= policy.sync.timer_minutes
    ? { sync: true, reason: "The sync interval elapsed." }
    : { sync: false, reason: "The sync interval has not elapsed." };
}

export function policyFor(
  config: IntegrationsConfig,
  integrationId: string,
): IntegrationPolicy {
  return config.integrations[integrationId] ?? DEFAULT_POLICY;
}

export function integrationsConfigPath(userDataPath: string): string {
  return path.join(userDataPath, INTEGRATIONS_FILE);
}

/**
 * Like settings, this is a convenience rather than a source of truth: a missing
 * or corrupt file falls back to defaults, which disable every integration.
 * Failing closed is the right direction for a file that authorizes network
 * access.
 */
export async function loadIntegrationsConfig(
  userDataPath: string,
): Promise<IntegrationsConfig> {
  let text: string;
  try {
    text = await readFile(integrationsConfigPath(userDataPath), "utf8");
  } catch {
    return DEFAULT_INTEGRATIONS_CONFIG;
  }
  try {
    const result = integrationsConfigSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : DEFAULT_INTEGRATIONS_CONFIG;
  } catch {
    return DEFAULT_INTEGRATIONS_CONFIG;
  }
}

export async function saveIntegrationsConfig(
  userDataPath: string,
  input: unknown,
): Promise<IntegrationsConfig> {
  const config = integrationsConfigSchema.parse(input);
  await writeFileAtomic(
    integrationsConfigPath(userDataPath),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return config;
}
