/**
 * Tasks completed in a Notion database.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY],
 * [HC-NO-PRIVATE-DATA-COMMITS], [HC-OBSERVATION-VS-INFERENCE]
 *
 * Ingress-only. The request body carries a timestamp filter, a sort, a page
 * size, and a cursor. No goal, value, constraint, journal line, chat message,
 * or mentor text is ever part of it — that is the line `[HC-NO-EXFILTRATION]`
 * draws, and this adapter stays on the ingress side of it.
 *
 * `POST` rather than `GET` is the one place this differs from the GitHub
 * adapter's read-only rule, and it is Notion's design rather than ours: the
 * query endpoint takes its filter in a body. Nothing is created or modified.
 *
 * ## Why the filter is on `last_edited_time` rather than the status column
 *
 * A filter naming a property has to know that property's *type* — `status`,
 * `select`, and `checkbox` take different condition objects, and sending the
 * wrong one is a 400. The adapter cannot know the type until it has seen the
 * database. The timestamp filter needs no property name and works against any
 * schema, so the request stays valid whatever the user's columns look like and
 * completion is decided here, from the returned records.
 */

import type { ActivitySignal } from "../domain";
import type { NotionConfig } from "./policy";
import { localDate } from "./rollup";
import { firstLine } from "./text";

export const NOTION_INTEGRATION_ID = "notion";
const NOTION_API_HOST = "api.notion.com";
const API_ROOT = `https://${NOTION_API_HOST}`;

/**
 * Pinned, never defaulted.
 *
 * Notion's `2025-09-03` split databases into databases and data sources and
 * moved this endpoint to `/v1/data_sources/{id}/query`. An unpinned client
 * would have followed that move silently and started returning nothing. The
 * pin is what makes `/v1/databases/{id}/query` keep meaning what it meant.
 */
const NOTION_VERSION = "2022-06-28";

const PAGE_SIZE = 100;

/** Bounds one sync at 500 tasks. A first sync must not walk an entire archive. */
const MAX_PAGES = 5;

/** Raised when Notion asks us to stop. Carried to the user, never retried in a loop. */
export class NotionRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionRateLimitError";
  }
}

/**
 * Raised when the database is missing or was never shared with the integration.
 *
 * These are one HTTP status in Notion's API and one fix in practice, and the
 * fix is not the one people guess: creating an integration grants it nothing
 * until the database is connected to it from Notion's own UI.
 */
export class NotionAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionAccessError";
  }
}

interface RichTextItem {
  plain_text?: string;
}

type NotionProperty =
  | { type?: "title"; title?: RichTextItem[] }
  | { type?: "rich_text"; rich_text?: RichTextItem[] }
  | { type?: "status"; status?: { name?: string } | null }
  | { type?: "select"; select?: { name?: string } | null }
  | { type?: "multi_select"; multi_select?: { name?: string }[] | null }
  | { type?: "checkbox"; checkbox?: boolean }
  | { type?: "date"; date?: { start?: string } | null }
  | { type?: string };

export interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, NotionProperty>;
}

/**
 * Accept what people actually paste.
 *
 * Notion's "Copy link" gives a URL whose path ends in a 32-character hex ID,
 * often followed by a `?v=` view parameter that is *also* a 32-character hex
 * string. Taking the last match would silently read the wrong object, so this
 * strips the query first and then takes the last ID in the path.
 *
 * Returns the empty string when nothing usable is present, which the adapter
 * treats the same as an unset database: no request at all.
 */
export function normalizeDatabaseId(raw: string): string {
  const withoutQuery = raw.trim().split(/[?#]/, 1)[0] ?? "";
  const matches = withoutQuery.match(/[0-9a-fA-F]{32}/g);
  const compact = matches?.at(-1) ?? withoutQuery.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    return "";
  }
  const lower = compact.toLowerCase();
  return [
    lower.slice(0, 8),
    lower.slice(8, 12),
    lower.slice(12, 16),
    lower.slice(16, 20),
    lower.slice(20),
  ].join("-");
}

/** Notion returns text as an array of runs; the plain text is their concatenation. */
export function plainText(property: NotionProperty | undefined): string {
  if (!property) {
    return "";
  }
  const runs =
    ("title" in property && property.title) ||
    ("rich_text" in property && property.rich_text) ||
    undefined;
  if (!Array.isArray(runs)) {
    return "";
  }
  return runs.map((run) => run.plain_text ?? "").join("");
}

/** The name of a `status`, `select`, or first `multi_select` value. */
export function optionName(property: NotionProperty | undefined): string | null {
  if (!property) {
    return null;
  }
  if ("status" in property && property.status) {
    return property.status.name ?? null;
  }
  if ("select" in property && property.select) {
    return property.select.name ?? null;
  }
  if ("multi_select" in property && Array.isArray(property.multi_select)) {
    return property.multi_select[0]?.name ?? null;
  }
  return null;
}

/** The `start` of a date property, as a calendar date. */
export function dateStart(property: NotionProperty | undefined): string | null {
  if (!property || !("date" in property) || !property.date) {
    return null;
  }
  const start = property.date.start;
  return typeof start === "string" && start.length >= 10 ? start.slice(0, 10) : null;
}

/**
 * Whether a task is finished, reading whichever column shape the user has.
 *
 * Null rather than false when the status column is absent from the page. The
 * difference matters: false means "this task is open", null means "this
 * database does not have the column you named", and the second is a
 * configuration error that has to reach the user rather than quietly filtering
 * every task away.
 */
export function isComplete(
  page: NotionPage,
  config: NotionConfig,
): boolean | null {
  const property = page.properties?.[config.status_property];
  if (!property) {
    return null;
  }
  if ("checkbox" in property && typeof property.checkbox === "boolean") {
    return property.checkbox;
  }
  const name = optionName(property);
  if (name === null) {
    // The column exists but is blank on this task, which is a real state and
    // means not done — unlike the column being absent entirely.
    return false;
  }
  const done = new Set(config.done_values.map((value) => value.toLowerCase()));
  return done.has(name.toLowerCase());
}

/**
 * When the task happened.
 *
 * A finished task is dated by its completion, an open one by when it is due,
 * and anything else by when it was last touched. The last is a weaker claim
 * than the first two, but it is still an observation rather than a guess, and
 * dropping the task instead would lose a real record over a missing column.
 */
export function occurredAt(
  page: NotionPage,
  config: NotionConfig,
  complete: boolean,
): string | null {
  const completed =
    config.completed_property.length > 0
      ? dateStart(page.properties?.[config.completed_property])
      : null;
  const due =
    config.due_property.length > 0
      ? dateStart(page.properties?.[config.due_property])
      : null;
  const edited =
    typeof page.last_edited_time === "string" && page.last_edited_time.length >= 10
      ? page.last_edited_time.slice(0, 10)
      : null;

  const preferred = complete ? (completed ?? edited) : (due ?? edited);
  return preferred ?? completed ?? due ?? null;
}

/** The mapped column, then the configured default, then the integration name. */
export function domainFor(page: NotionPage, config: NotionConfig): string {
  const mapped =
    config.domain_property.length > 0
      ? optionName(page.properties?.[config.domain_property])
      : null;
  return slugifyDomain(mapped ?? config.default_domain);
}

/** `ActivitySignal.domain` accepts lowercase alphanumerics, underscores, hyphens. */
export function slugifyDomain(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "");
  return slug.length > 0 ? slug : NOTION_INTEGRATION_ID;
}

/** Notion IDs are UUIDs; `ActivitySignal.id` is a slug, so the hyphens go. */
export function signalId(pageId: string): string {
  const compact = pageId.replaceAll("-", "").toLowerCase().slice(0, 12);
  return `${NOTION_INTEGRATION_ID}_${compact.length > 0 ? compact : "unknown"}`;
}

/**
 * The earliest edit time worth asking for.
 *
 * The last sync when there is one, and the lookback horizon otherwise. As in
 * the GitHub adapter, the horizon bounds the *first* sync only: taking the
 * later of the two would mean a fortnight away from the app silently loses
 * everything in the gap, which is data loss rather than a window.
 */
export function earliestEdit(
  since: string | null,
  lookbackDays: number,
  today: Date,
): string {
  if (since !== null) {
    return since;
  }
  // A local calendar date, not a UTC one. From early evening onwards in a US
  // timezone UTC has already rolled over, so a horizon taken from toISOString
  // starts a day late — and a two-day window silently loses yesterday exactly
  // when someone sits down to review their day.
  return localDate(new Date(today.getTime() - lookbackDays * 86_400_000));
}

// Not `implements ActivityAdapter`: that type is a union pairing
// `requiresCredential` with `credentialHint`, and a class cannot implement a
// union. `createAdapters` returns `ActivityAdapter[]`, so the pairing is still
// checked — at registration, which is where the registry actually forms.
export class NotionTasksAdapter {
  readonly id = NOTION_INTEGRATION_ID;
  readonly version = "notion-1";
  readonly hosts: readonly string[] = [NOTION_API_HOST];
  readonly label = "Notion tasks";
  readonly requiresCredential = true;
  readonly credentialHint =
    "Create an internal integration at notion.so/my-integrations, copy its " +
    "secret, and store it in Settings under Notion token. Then open the task " +
    "database in Notion and connect it to that integration — creating the " +
    "integration grants it nothing on its own, and a database it cannot see " +
    "is reported as missing.";

  constructor(
    private readonly readConfig: () => Promise<NotionConfig>,
    private readonly httpFetch: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(since: string | null, credential?: string): Promise<ActivitySignal[]> {
    const config = await this.readConfig();
    const databaseId = normalizeDatabaseId(config.database_id);

    // No database means no request. An unset scope is the default, and the
    // default must never be "read whatever the credential can reach".
    if (databaseId.length === 0) {
      if (config.database_id.trim().length > 0) {
        throw new Error(
          "That does not look like a Notion database ID. Paste the database " +
            "URL or its 32-character ID into Settings.",
        );
      }
      return [];
    }

    const token = credential ?? "";
    if (token.length === 0) {
      throw new Error("Notion needs a token before it can read tasks.");
    }

    const pages = await this.query(databaseId, config, since, token);
    const fetchedAt = this.now().toISOString();
    const signals: ActivitySignal[] = [];
    let sawStatusProperty = false;

    for (const page of pages) {
      const complete = isComplete(page, config);
      if (complete !== null) {
        sawStatusProperty = true;
      }
      if (complete !== true && !config.include_open_tasks) {
        continue;
      }
      const summary = firstLine(plainText(page.properties?.[config.title_property]));
      const occurred = occurredAt(page, config, complete === true);
      if (summary.length === 0 || occurred === null) {
        continue;
      }
      signals.push({
        id: signalId(page.id),
        integration_id: NOTION_INTEGRATION_ID,
        kind: "task",
        occurred_at: occurred,
        summary,
        domain: domainFor(page, config),
        // A task is an event, not a measurement. There is nothing honest to
        // count here, and inventing a metric would give the model a number to
        // reason about that means nothing.
        metrics: {},
        url: page.url ?? null,
        provenance: {
          fetched_at: fetchedAt,
          adapter_version: this.version,
          account_label: databaseId,
          manually_reviewed: false,
        },
      });
    }

    // Tasks came back and not one carried the configured status column, so the
    // name is wrong. Without this the sync reports success and stores nothing,
    // which looks identical to a quiet week — the app asserting something false
    // about the user's behavior rather than admitting it cannot read the board.
    if (pages.length > 0 && !sawStatusProperty) {
      throw new Error(
        `No task had a property named "${config.status_property}". ` +
          `The database uses: ${describeProperties(pages)}. ` +
          "Set the status property in Settings to whichever of those says a task is done.",
      );
    }

    return signals;
  }

  private async query(
    databaseId: string,
    config: NotionConfig,
    since: string | null,
    token: string,
  ): Promise<NotionPage[]> {
    const collected: NotionPage[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.httpFetch(
        `${API_ROOT}/v1/databases/${databaseId}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // A timestamp filter takes no property name — Notion rejects the
            // request if one is supplied — which is exactly why it is safe
            // against a schema this adapter has never seen.
            filter: {
              timestamp: "last_edited_time",
              last_edited_time: {
                on_or_after: earliestEdit(since, config.lookback_days, this.now()),
              },
            },
            sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
            page_size: PAGE_SIZE,
            ...(cursor === undefined ? {} : { start_cursor: cursor }),
          }),
        },
      );
      this.assertUsable(response, databaseId);

      const body = (await response.json()) as {
        results?: NotionPage[];
        has_more?: boolean;
        next_cursor?: string | null;
      };
      collected.push(...(body.results ?? []));
      if (body.has_more !== true || !body.next_cursor) {
        break;
      }
      cursor = body.next_cursor;
    }
    return collected;
  }

  /**
   * Convert an unhappy response into a message the user can act on.
   *
   * Implements: [HC-SECRETS-ENV-ONLY]
   *
   * The token is never part of any message here, not even truncated. A 401 says
   * to store a current one; it does not show what was sent.
   */
  private assertUsable(response: Response, databaseId: string): void {
    if (response.ok) {
      return;
    }
    if (response.status === 401) {
      throw new Error(
        "Notion rejected the stored token. Open Settings and store a current one.",
      );
    }
    if (response.status === 404) {
      // Notion returns this both for a database that does not exist and for one
      // the integration was never connected to, and the second is far more
      // common — creating an integration does not grant it access to anything.
      throw new NotionAccessError(
        `Notion could not find database ${databaseId}. Open it in Notion, and ` +
          "from the ••• menu connect it to your integration. Creating the " +
          "integration does not give it access on its own.",
      );
    }
    if (response.status === 403) {
      throw new NotionAccessError(
        "Notion refused the request. The integration does not have access to that database.",
      );
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      // Surface the wait and stop. Never spin: retrying inside the window is
      // how an integration gets itself throttled for longer.
      throw new NotionRateLimitError(
        `Notion rate limit reached. ${describeWait(retryAfter)}`,
      );
    }
    throw new Error(`Notion replied ${String(response.status)}.`);
  }
}

/** Property names only, never values — the schema is the diagnostic, not the tasks. */
function describeProperties(pages: readonly NotionPage[]): string {
  const names = new Set<string>();
  for (const page of pages) {
    for (const name of Object.keys(page.properties ?? {})) {
      names.add(name);
    }
  }
  const sorted = [...names].sort();
  return sorted.length > 0 ? sorted.join(", ") : "(no properties)";
}

function describeWait(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    return `Try again in about ${String(minutes)} minute${minutes === 1 ? "" : "s"}.`;
  }
  return "Try again in a few minutes.";
}
