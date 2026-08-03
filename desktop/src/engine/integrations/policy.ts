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

/**
 * What the GitHub adapter is allowed to look at.
 *
 * Implements: [HC-NO-EXFILTRATION]
 *
 * Scope defaults to empty and empty means fetch nothing. A token can usually
 * see far more than the user wants mentored, so reading everything it permits
 * would be a privacy decision made on their behalf.
 *
 * `domains` is the piece that makes discrepancy detection work. `ActivitySignal.domain`
 * has to match a `Goal.domain` for selection to connect them, and a repository
 * name almost never does — mapping `octocat/api-service` to `career` is what
 * lets the mentor notice that the promotion goal is getting a fifth of the
 * commits. Unmapped repositories fall back to a slug of the repository name,
 * which is honest but rarely matches a goal.
 */
export const githubConfigSchema = z.strictObject({
  /** The commit author to search for. Empty means the adapter cannot run. */
  login: z.string().trim().default(""),
  /** `owner/name` entries. */
  repositories: z.array(z.string().trim()).default([]),
  /** Organization logins, which widen scope to every repository within. */
  organizations: z.array(z.string().trim()).default([]),
  /**
   * Read every repository the token can see, instead of a named list.
   *
   * Off by default, because reading everything a credential permits is a
   * decision that must be the user's rather than the default. Turning it on is
   * that decision, made explicitly.
   */
  all_repositories: z.boolean().default(false),
  /**
   * How far back to look.
   *
   * A mentor is for what you are doing now, so the default is a week. Without
   * this the first sync reaches back across all of history and returns hundreds
   * of commits, which floods storage and burns the search budget to tell the
   * user about work they have long since finished.
   */
  lookback_days: z.number().int().min(1).max(365).default(7),
  /**
   * Optional `owner/name` (or organization) to goal domain.
   *
   * A ranking aid, not a requirement. The model reads the repository name and
   * the commit message and can infer which goal the work serves — often better
   * than a fixed map, since one repository can serve several goals. Mapping is
   * worth doing when a repository's name says nothing useful about the goal.
   */
  domains: z.record(z.string(), z.string()).default({}),
});

/**
 * What the Notion adapter is allowed to look at, and how to read it.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-EXPLICIT-CONFIG-PATHS]
 *
 * Every property name is configurable because no two task databases share a
 * schema. Notion has no canonical "status" or "due date" — those are whatever
 * the user named their columns, so hardcoding "Status" would work for the
 * author and silently return nothing for everyone else.
 *
 * The defaults are Notion's own template names, which makes the common case
 * work unconfigured while leaving every part of it adjustable.
 */
export const notionConfigSchema = z.strictObject({
  /**
   * The database to read. Empty means the adapter makes no request.
   *
   * Accepts a pasted Notion URL as well as a bare ID; `normalizeDatabaseId`
   * does the extraction, because copying the URL is what people actually do.
   */
  database_id: z.string().trim().default(""),
  /**
   * Where the tasks are.
   *
   * `rows` treats each database row as one task and reads its properties. That
   * is a task board.
   *
   * `checkboxes` treats each row as a container — a daily page — and reads the
   * to-do blocks written *inside* it. That is a journal, where the row is a
   * date and the tasks are the boxes you ticked under it. Reading the page body
   * is strictly more than reading its properties, so it is opt-in.
   *
   * A mode rather than two flags, because the two readings are exclusive: under
   * `checkboxes` the row itself is not a task, and the status column is
   * irrelevant since a ticked box is unambiguous.
   */
  task_source: z.enum(["rows", "checkboxes"]).default("rows"),
  /** The title column. Notion's default name for it is "Name". */
  title_property: z.string().trim().default("Name"),
  /**
   * The date column on a daily page, used only under `checkboxes`.
   *
   * A real date rather than the page title. A page called "July 30" carries no
   * year, so dating a task from its title means guessing one — and guessing
   * wrong files this week's work under last year.
   */
  date_property: z.string().trim().default("Date"),
  /**
   * The column that says whether a task is finished.
   *
   * May be a `status`, a `select`, or a `checkbox` — all three are common, and
   * the adapter reads whichever it finds rather than requiring one.
   */
  status_property: z.string().trim().default("Status"),
  /**
   * Status values that count as finished, compared case-insensitively.
   *
   * Ignored when the status column is a checkbox, where ticked means done.
   */
  done_values: z.array(z.string().trim()).default(["Done", "Complete", "Completed"]),
  /** Optional date column holding when the task was finished. */
  completed_property: z.string().trim().default(""),
  /** Optional date column holding when the task is due. */
  due_property: z.string().trim().default("Due"),
  /** Optional `select` or `multi_select` column naming the goal domain. */
  domain_property: z.string().trim().default(""),
  /** Used when no domain column is mapped, or when a task leaves it blank. */
  default_domain: z.string().trim().default(""),
  /**
   * Also store tasks that are not finished.
   *
   * Off by default, because it widens what leaves the user's workspace: an
   * unfinished task is usually a plan they have not committed to out loud.
   *
   * Safe to turn on because `ActivitySignal.completed` records which side of
   * the line each task fell on. Before that field existed this flag was the
   * hazard it warned about — open and finished tasks were the same record, so
   * collecting both let "I planned to" count as "I did".
   */
  include_open_tasks: z.boolean().default(false),
  /** How far back the first sync reaches. Later syncs resume from the last one. */
  lookback_days: z.number().int().min(1).max(365).default(7),
});

/**
 * What the Strava adapter is allowed to look at.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY]
 *
 * `client_id` lives here rather than in `SecretStore` because it is not a
 * secret — it is an integer application ID that appears in every authorize URL,
 * including ones the user pastes into a browser address bar. The client
 * *secret* and the refresh token are the credentials, and those are in
 * `SecretStore`.
 *
 * There is no activity-type filter on purpose. A 50K plan fails through
 * overtraining as often as through undertraining, so the cross-training and
 * recovery work is exactly the signal a mentor needs — filtering to runs would
 * hide the days that answer "am I recovering".
 */
export const stravaConfigSchema = z.strictObject({
  /**
   * The API application's ID, from <https://www.strava.com/settings/api>.
   *
   * Empty means the adapter makes no request. Kept as a string because it
   * arrives by paste and is only ever put back into a query parameter;
   * parsing it to a number would buy nothing and lose a leading zero.
   */
  client_id: z.string().trim().default(""),
  /**
   * The goal domain every workout is filed under.
   *
   * A single value rather than a per-activity map. `ActivitySignal.domain` has
   * to match a `Goal.domain` for selection to connect them, and unlike a
   * repository name an activity type carries no hint of which goal it serves —
   * a run is a run whether it is base training or stress relief.
   */
  default_domain: z.string().trim().default("running"),
  /** How far back the first sync reaches. Later syncs resume from the last one. */
  lookback_days: z.number().int().min(1).max(365).default(30),
});

/**
 * What the Google Sheets adapter is allowed to look at, and how to read it.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-EXPLICIT-CONFIG-PATHS]
 *
 * One spreadsheet, named explicitly. A service account can only see files that
 * have been shared with it, so the credential's reach is already narrow — but
 * "the sheet you named" is narrower still, and it is the difference between an
 * integration and a crawler.
 *
 * `client_email` lives here rather than in `SecretStore` for the same reason
 * Strava's `client_id` does: it is an identifier, not a credential. The user
 * has to read it back and paste it into Google's own sharing dialog, so a
 * store that deliberately has no getter is the wrong home for it. The private
 * key is the credential and that is in `SecretStore`.
 *
 * Every column is named rather than positional. A training log is a personal
 * document that gets columns inserted into it, and a layout pinned to
 * spreadsheet letters breaks silently the first time that happens — the
 * adapter would keep working and start reading the wrong column.
 */
export const googleSheetsConfigSchema = z.strictObject({
  /**
   * The spreadsheet to read. Empty means the adapter makes no request.
   *
   * Accepts a pasted `docs.google.com` URL as well as a bare ID;
   * `normalizeSpreadsheetId` does the extraction, because copying the address
   * bar is what people actually do.
   */
  spreadsheet_id: z.string().trim().default(""),
  /** Which tab. Empty means the first one, which is the common case. */
  tab_name: z.string().trim().default(""),
  /** 1-based row holding the column names. */
  header_row: z.number().int().min(1).max(1000).default(1),
  /**
   * 1-based row where data starts.
   *
   * Not `header_row + 1`. Real logs put a second explanatory row under the
   * headers — "Effort on a scale of 1 to 5" — and reading it as data produces
   * one undated junk signal on every sync.
   */
  first_data_row: z.number().int().min(1).max(1000).default(2),
  /** The service account's address, which is also what the sheet is shared with. */
  client_email: z.string().trim().default(""),
  /** Column holding the date the row describes. */
  date_column: z.string().trim().default("Date"),
  /**
   * Column holding what was *planned*.
   *
   * Kept separate from `actual_column` because that separation is the whole
   * value of this source. `[HC-OBSERVATION-VS-INFERENCE]` exists to stop a plan
   * being read as an achievement, and a coached training log is the one place
   * that distinction arrives already made, per day, by hand.
   */
  planned_column: z.string().trim().default("Workout"),
  /** Column holding what was actually done. Empty cell means it was not. */
  actual_column: z.string().trim().default("Actual"),
  /**
   * Free-text columns appended to the summary, in order.
   *
   * Defaults to empty. These carry the most personal material in the sheet —
   * injury notes, life context, another person's feedback — so including them
   * is a decision the user makes rather than one the defaults make quietly.
   */
  note_columns: z.array(z.string().trim()).default([]),
  /**
   * Numeric columns to keep, as header name to metric key.
   *
   * The key is what the model sees, so it is separate from the header: a column
   * called "Work load" and a metric called `work_load` are the same number, but
   * only one of them is a legal identifier.
   */
  metric_columns: z.record(z.string(), z.string()).default({}),
  /**
   * The goal domain every row is filed under.
   *
   * One value, because one sheet is one subject. `ActivitySignal.domain` has to
   * match a `Goal.domain` for selection to connect them.
   */
  default_domain: z.string().trim().default("training"),
  /** How far back the first sync reaches. Later syncs resume from the last one. */
  lookback_days: z.number().int().min(1).max(365).default(30),
});

export const integrationsConfigSchema = z.strictObject({
  /** Stops every automatic sync across every integration at once. */
  paused: z.boolean().default(false),
  integrations: z.record(z.string(), integrationPolicySchema).default({}),
  github: githubConfigSchema.prefault({}),
  notion: notionConfigSchema.prefault({}),
  strava: stravaConfigSchema.prefault({}),
  google_sheets: googleSheetsConfigSchema.prefault({}),
});

export type QuietHours = z.infer<typeof quietHoursSchema>;
export type SyncModes = z.infer<typeof syncModesSchema>;
export type IntegrationPolicy = z.infer<typeof integrationPolicySchema>;
export type GitHubConfig = z.infer<typeof githubConfigSchema>;
export type NotionConfig = z.infer<typeof notionConfigSchema>;
export type StravaConfig = z.infer<typeof stravaConfigSchema>;
export type GoogleSheetsConfig = z.infer<typeof googleSheetsConfigSchema>;
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
