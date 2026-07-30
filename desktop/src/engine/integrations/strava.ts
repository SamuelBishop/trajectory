/**
 * Training activity read from Strava.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY],
 * [HC-NO-PRIVATE-DATA-COMMITS], [HC-OBSERVATION-VS-INFERENCE]
 *
 * Ingress-only, with one documented exception. Reading activities is a `GET` to
 * `www.strava.com` carrying a bearer token and a date cursor. Refreshing that
 * bearer token is a `POST` to the same host carrying the application's client
 * ID, its client secret, and the refresh token — and nothing else. No goal,
 * value, constraint, journal line, chat message, or mentor text is ever part of
 * a request. That POST is the single exception `[HC-NO-EXFILTRATION]` names by
 * hand; it is an authorization exchange, not a data path, and a future reader
 * should not mistake it for one.
 *
 * This adapter deliberately never reads `map`, `start_latlng`, or `end_latlng`.
 * Route geometry is the most sensitive thing Strava holds — it is where the
 * user lives and when they are away from home — it is large, and a mentor has
 * no use for it. The safest way not to store it is never to read it.
 *
 * Why measurement rather than a written training log: `current_state.yaml` is
 * already the user's account of themselves. Feeding a hand-written log in as
 * observed activity would have the mentor checking that story against itself.
 * A recorded activity is the one thing here the user cannot misremember, which
 * is what makes it worth a network call.
 *
 * `fetch` is injected so the tests run against recorded payloads. A suite that
 * needs a live endpoint and a valid token is a suite that stops being run.
 */

import type { ActivitySignal } from "../domain";
import type { StravaConfig } from "./policy";
import { localDate } from "./rollup";

export const STRAVA_INTEGRATION_ID = "strava";
const STRAVA_HOST = "www.strava.com";
const TOKEN_URL = `https://${STRAVA_HOST}/oauth/token`;
const ACTIVITIES_URL = `https://${STRAVA_HOST}/api/v3/athlete/activities`;

/** Strava's own maximum. Fewer pages for the same history means fewer requests. */
const PER_PAGE = 200;

/**
 * Bounds a first sync at 1,000 activities.
 *
 * The read budget is 200 requests per 15 minutes and 2,000 per day for the
 * whole application, and this adapter shares that budget with anything else the
 * user built on the same API application. An unbounded walk backwards through a
 * decade of training would spend it on history nobody is going to be mentored
 * about.
 */
const MAX_PAGES = 5;

/**
 * Refresh this long before the access token actually dies.
 *
 * Strava's tokens last six hours. Treating one as expired a minute early costs
 * a request roughly never and avoids fetching with a token that expires between
 * the check and the call.
 */
const EXPIRY_MARGIN_SECONDS = 60;

/** Raised when Strava asks us to stop. Carried to the user, never retried in a loop. */
export class StravaRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StravaRateLimitError";
  }
}

/**
 * Raised when the stored authorization no longer works.
 *
 * Separate from a rate limit because the fix is different and only the user can
 * apply it: a refresh token is single-use once rotated, so a stale one is dead
 * rather than busy.
 */
export class StravaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StravaAuthError";
  }
}

/**
 * Read and write the refresh token.
 *
 * A store rather than a plain string because Strava rotates: every successful
 * call to the token endpoint may return a *new* refresh token, and the moment
 * it does the previous one is invalidated. An adapter that could only read
 * would work for weeks and then stop, with no event to point at.
 *
 * The implementation lives in the main process, which is the only place that
 * can open `SecretStore`. Injecting it keeps the network call inside this
 * directory, where the exemption lives, and keeps the credential out of the
 * engine's reach except as an opaque handle.
 */
export interface StravaTokenStore {
  read(): Promise<string | undefined>;
  save(refreshToken: string): Promise<void>;
}

interface SummaryActivity {
  id?: number | string;
  name?: string;
  sport_type?: string;
  type?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  start_date_local?: string;
  start_date?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
}

/**
 * Strava's rejection body: `{ message, errors: [{ resource, field, code }] }`.
 *
 * The `field` is the name of an input, never its value, so repeating it tells
 * the user which of the three credentials to fix without printing any of them.
 */
interface TokenErrorBody {
  errors?: readonly { field?: string; code?: string }[];
}

/**
 * Turn Strava's rejection into the one sentence that says what to do next.
 *
 * Three credentials go into this request and any of them can be the wrong one.
 * A single "re-authorize" message sends a user to re-mint a token that was
 * fine, which is the most expensive of the three fixes and often not the
 * needed one. Strava already names the field it disliked; discarding that and
 * making the user guess is the app knowing something and not saying it.
 */
export function describeTokenRejection(body: unknown): string {
  const errors = (body as TokenErrorBody | null)?.errors ?? [];
  const fields = new Set(errors.map((error) => error.field ?? ""));

  if (fields.has("client_id") || fields.has("client_secret")) {
    return (
      "Strava rejected the application credentials. Check that the Client ID above " +
      "matches the one on strava.com/settings/api and that the stored client secret " +
      "is that application's, with no stray whitespace."
    );
  }
  if (fields.has("refresh_token") || fields.has("code")) {
    return (
      "Strava rejected the stored refresh token. It has been rotated or revoked — " +
      "anything else using the same API application invalidates it by refreshing. " +
      "Re-authorize with the activity:read_all scope and store the new token in Settings."
    );
  }
  return (
    "Strava rejected the stored authorization. Re-authorize the application " +
    "and store the new refresh token in Settings."
  );
}

/** `ActivitySignal.domain` accepts lowercase alphanumerics, underscores, hyphens. */
export function slugifyDomain(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "");
  return slug.length > 0 ? slug : STRAVA_INTEGRATION_ID;
}

/**
 * `TrailRun` and `WeightTraining` are how Strava spells its sport types.
 *
 * Split on the capitals so the model reads a phrase rather than an identifier;
 * a mentor asked about "trail run" volume should not have to know that the API
 * calls it `TrailRun`.
 */
export function humanizeSport(sport: string): string {
  const spaced = sport
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
  if (spaced.length === 0) {
    return "Workout";
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  return hours > 0 ? `${String(hours)}h ${String(minutes)}m` : `${String(minutes)}m`;
}

/**
 * What the activity was, composed here rather than taken from the user.
 *
 * `name` is deliberately unused. Strava titles default to "Morning Run" and are
 * otherwise jokes, place names, or emoji; none of that is training signal, and
 * a free-text field the user controls is exactly where a pasted credential
 * would end up.
 */
export function activitySummary(activity: SummaryActivity): string {
  const sport = humanizeSport(activity.sport_type ?? activity.type ?? "");
  const metres = Number(activity.distance);
  const seconds = Number(activity.moving_time ?? activity.elapsed_time);
  const parts: string[] = [];
  if (Number.isFinite(metres) && metres >= 100) {
    parts.push(`${(metres / 1000).toFixed(1)} km`);
  }
  if (Number.isFinite(seconds) && seconds > 0) {
    parts.push(formatDuration(seconds));
  }
  const detail = parts.join(" in ");
  const summary = detail.length > 0 ? `${sport} — ${detail}` : sport;
  return summary.slice(0, 280);
}

/**
 * The whole activity ID, never a prefix.
 *
 * The Notion adapter learned this the expensive way: truncating an identifier
 * that is not a content hash collapses distinct records into one, and the store
 * keys on the result, so a day of activity silently becomes a single row.
 */
export function signalId(activityId: string): string {
  const compact = activityId.trim().toLowerCase().replaceAll(/[^a-z0-9_-]+/g, "");
  return `${STRAVA_INTEGRATION_ID}_${compact.length > 0 ? compact : "unknown"}`;
}

/** Only the numbers a mentor can reason about. No coordinates, ever. */
export function activityMetrics(activity: SummaryActivity): Record<string, number> {
  const metrics: Record<string, number> = {};
  const numeric: [string, unknown][] = [
    ["distance_m", activity.distance],
    ["moving_time_s", activity.moving_time],
    ["elapsed_time_s", activity.elapsed_time],
    ["elevation_gain_m", activity.total_elevation_gain],
    ["average_heartrate", activity.average_heartrate],
    ["max_heartrate", activity.max_heartrate],
  ];
  for (const [key, value] of numeric) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = Math.round(value * 10) / 10;
    }
  }
  return metrics;
}

/**
 * The earliest start time worth asking for, as epoch seconds.
 *
 * The last sync when there is one, and the lookback horizon otherwise. As in
 * the GitHub and Notion adapters, the horizon bounds the *first* sync only:
 * taking the later of the two would mean a fortnight away from the app silently
 * loses everything in the gap, which is data loss rather than a window.
 *
 * The boundary is local midnight, matching `start_date_local`, and it is
 * derived with `localDate` rather than `toISOString`. Deriving a local horizon
 * from UTC starts the window a day late from early evening onwards — which is
 * exactly when someone reviews their day.
 */
export function earliestStart(
  since: string | null,
  lookbackDays: number,
  today: Date,
): number {
  const day =
    since ??
    localDate(new Date(today.getTime() - lookbackDays * 86_400_000));
  // Re-reads the whole of the last synced day. The store dedupes by ID, so the
  // cost is a few repeated records and the benefit is never missing an activity
  // recorded later on a day already seen.
  const midnight = new Date(`${day}T00:00:00`);
  return Math.floor(midnight.getTime() / 1000);
}

export class StravaActivitiesAdapter {
  readonly id = STRAVA_INTEGRATION_ID;
  readonly version = "strava-1";
  readonly hosts: readonly string[] = [STRAVA_HOST];
  readonly label = "Strava";
  readonly requiresCredential = true;
  readonly credentialHint =
    "Create an API application at strava.com/settings/api, then store its " +
    "client secret and a refresh token with the activity:read_all scope.";

  /** Cached only in memory. An access token lives six hours and is never written to disk. */
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly readConfig: () => Promise<StravaConfig>,
    private readonly tokens: StravaTokenStore,
    private readonly httpFetch: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(since: string | null, credential?: string): Promise<ActivitySignal[]> {
    const config = await this.readConfig();
    // No application ID means no request. The user has not finished setting up,
    // and guessing one would just produce an unexplained 401.
    if (config.client_id.length === 0) {
      return [];
    }
    const clientSecret = credential ?? "";
    if (clientSecret.length === 0) {
      throw new StravaAuthError(
        "Strava needs its client secret before it can read activities.",
      );
    }

    const accessToken = await this.accessToken(config.client_id, clientSecret);
    const after = earliestStart(since, config.lookback_days, this.now());
    const activities = await this.activities(accessToken, after);
    const fetchedAt = this.now().toISOString();
    const domain = slugifyDomain(config.default_domain);

    const signals: ActivitySignal[] = [];
    for (const activity of activities) {
      const rawId = activity.id === undefined ? "" : String(activity.id);
      const occurredAt = (activity.start_date_local ?? activity.start_date ?? "").slice(
        0,
        10,
      );
      if (rawId.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
        continue;
      }
      signals.push({
        id: signalId(rawId),
        integration_id: STRAVA_INTEGRATION_ID,
        kind: "workout",
        occurred_at: occurredAt,
        summary: activitySummary(activity),
        domain,
        // A recorded activity is something that happened. Unlike a task there
        // is no open state to represent: Strava has no record of a run the
        // user planned and did not do.
        completed: true,
        metrics: activityMetrics(activity),
        url: `https://${STRAVA_HOST}/activities/${rawId}`,
        provenance: {
          fetched_at: fetchedAt,
          adapter_version: this.version,
          account_label: STRAVA_INTEGRATION_ID,
          manually_reviewed: false,
        },
      });
    }
    return signals;
  }

  /**
   * A live access token, refreshing only when the cached one is spent.
   *
   * Implements: [HC-SECRETS-ENV-ONLY]
   */
  private async accessToken(clientId: string, clientSecret: string): Promise<string> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (this.access !== null && this.access.expiresAt - EXPIRY_MARGIN_SECONDS > nowSeconds) {
      return this.access.token;
    }

    const refreshToken = (await this.tokens.read()) ?? "";
    if (refreshToken.length === 0) {
      throw new StravaAuthError(
        "Strava needs a refresh token before it can read activities. " +
          "Authorize the API application with the activity:read_all scope and store the token in Settings.",
      );
    }

    const response = await this.httpFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (response.status === 400 || response.status === 401) {
      // Strava names the field it rejected. Repeat that name and nothing else:
      // it identifies which of the three credentials is wrong without echoing
      // any of them back. Without it the only advice possible is "re-authorize",
      // which is the most expensive fix and usually the wrong one.
      const detail: unknown = await response.json().catch(() => null);
      throw new StravaAuthError(describeTokenRejection(detail));
    }
    this.assertUsable(response);

    const body = (await response.json()) as TokenResponse;
    const token = body.access_token ?? "";
    if (token.length === 0) {
      throw new StravaAuthError("Strava returned no access token.");
    }

    // Persist a rotated refresh token *before* anything else can fail. Strava
    // invalidates the previous one the instant it issues a replacement, so a
    // rotation dropped on the floor leaves the integration holding a dead
    // credential with nothing to say about why.
    const rotated = body.refresh_token ?? "";
    if (rotated.length > 0 && rotated !== refreshToken) {
      await this.tokens.save(rotated);
    }

    const expiresAt =
      typeof body.expires_at === "number" && Number.isFinite(body.expires_at)
        ? body.expires_at
        : nowSeconds + (body.expires_in ?? 0);
    this.access = { token, expiresAt };
    return token;
  }

  private async activities(
    accessToken: string,
    after: number,
  ): Promise<SummaryActivity[]> {
    const collected: SummaryActivity[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url =
        `${ACTIVITIES_URL}?` +
        new URLSearchParams({
          after: String(after),
          per_page: String(PER_PAGE),
          page: String(page),
        }).toString();
      const response = await this.httpFetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      this.assertUsable(response);

      const body: unknown = await response.json();
      if (!Array.isArray(body) || body.length === 0) {
        break;
      }
      collected.push(...(body as SummaryActivity[]));
      if (body.length < PER_PAGE) {
        break;
      }
    }
    return collected;
  }

  /**
   * Convert an unhappy response into a message the user can act on.
   *
   * Implements: [HC-SECRETS-ENV-ONLY]
   *
   * No token, code, or client secret appears in any message here, not even
   * truncated. A 401 says to re-authorize; it does not show what was sent.
   */
  private assertUsable(response: Response): void {
    if (response.ok) {
      return;
    }
    if (response.status === 401) {
      throw new StravaAuthError(
        "Strava rejected the stored authorization. Re-authorize the application " +
          "and store the new refresh token in Settings.",
      );
    }
    if (response.status === 429) {
      // Surface the wait and stop. Never spin: the budget is 200 requests per
      // 15 minutes for the whole application, and retrying inside that window
      // is how an integration throttles itself for longer.
      throw new StravaRateLimitError(
        `Strava rate limit reached. ${describeWait(response)}`,
      );
    }
    if (response.status === 403) {
      throw new StravaAuthError(
        "Strava refused the request. The authorization may lack the activity:read_all scope.",
      );
    }
    throw new Error(`Strava replied ${String(response.status)}.`);
  }
}

/**
 * Strava reports usage as `used,used` against `limit,limit` for the 15-minute
 * and daily windows, and sends no `Retry-After`. Naming which of the two ran
 * out is the difference between waiting a quarter of an hour and waiting a day.
 */
function describeWait(response: Response): string {
  const limits = (response.headers.get("x-ratelimit-limit") ?? "").split(",");
  const usage = (response.headers.get("x-ratelimit-usage") ?? "").split(",");
  const dailyLimit = Number(limits[1]);
  const dailyUsage = Number(usage[1]);
  if (
    Number.isFinite(dailyLimit) &&
    Number.isFinite(dailyUsage) &&
    dailyLimit > 0 &&
    dailyUsage >= dailyLimit
  ) {
    return "The daily budget is spent; it resets at midnight UTC.";
  }
  return "The 15-minute budget is spent. Try again shortly.";
}
