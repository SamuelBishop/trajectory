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
const AUTHORIZE_URL = `https://${STRAVA_HOST}/oauth/authorize`;

/**
 * The scope this adapter needs, and the reason the setup has a helper at all.
 *
 * `strava.com/settings/api` displays a ready-made access token and refresh
 * token next to the client secret, which is the obvious thing to copy — and
 * those are issued with `read` scope only. `read` cannot list activities, so
 * the pair authenticates perfectly, the token endpoint returns 200, and the
 * activity request returns 401. Nothing about the settings page suggests the
 * token it hands you is the wrong one for reading activities.
 */
const REQUIRED_SCOPE = "activity:read_all";

/**
 * Where the user has to go to grant `activity:read_all`.
 *
 * `localhost` is a whitelisted redirect target, so the redirect fails to load
 * and the authorization code can be read out of the address bar. That is the
 * whole reason this integration needs no loopback listener.
 *
 * `approval_prompt=force` because Strava otherwise silently reuses an existing
 * authorization — including one granted with the wrong scope, which is the
 * exact situation this link exists to escape.
 */
export function authorizeUrl(clientId: string): string {
  return (
    `${AUTHORIZE_URL}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      approval_prompt: "force",
      scope: REQUIRED_SCOPE,
    }).toString()
  );
}

const REDIRECT_URI = "http://localhost/exchange_token";

/**
 * Pull the authorization code out of whatever the user pasted.
 *
 * They are told to copy an address bar, so accept the whole URL. They will
 * sometimes paste just the code, so accept that too. Getting this wrong is
 * cheap to fix and annoying to hit, and the alternative is an instruction
 * telling someone to edit a URL by hand.
 */
export function authorizationCodeFrom(pasted: string): string {
  const trimmed = pasted.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const match = /[?&]code=([^&\s]+)/.exec(trimmed);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  // A bare code. Reject anything URL-shaped so a paste that *should* have
  // carried a code is reported rather than sent to Strava as one.
  return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : "";
}

/**
 * Trade an authorization code for a refresh token.
 *
 * Separate from the adapter because it runs once, during setup, and needs the
 * client secret and a code rather than a stored refresh token. It returns the
 * refresh token instead of storing it: persistence belongs to the main
 * process, and the network call belongs here.
 */
export async function exchangeAuthorizationCode(
  clientId: string,
  clientSecret: string,
  code: string,
  httpFetch: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (code.length === 0) {
    throw new StravaAuthError(
      "That does not look like an authorization code. Paste the whole address " +
        "the browser landed on, including the ?code= part.",
    );
  }
  const response = await httpFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
    }).toString(),
  });

  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => null);
    throw new StravaAuthError(describeTokenRejection(detail));
  }

  const body = (await response.json()) as TokenResponse;
  const refreshToken = body.refresh_token ?? "";
  if (refreshToken.length === 0) {
    throw new StravaAuthError("Strava returned no refresh token.");
  }
  return refreshToken;
}
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
 * `resource` and `field` name an input, never its value, so repeating them
 * tells the user which of the three credentials to fix without printing any of
 * them.
 */
interface TokenErrorBody {
  errors?: readonly { resource?: string; field?: string; code?: string }[];
}

/**
 * Turn Strava's rejection into the one sentence that says what to do next.
 *
 * Three credentials go into this request and any of them can be the wrong one.
 * A single "re-authorize" message sends a user to re-mint a token that was
 * fine, which is the most expensive of the three fixes and usually not the
 * needed one.
 *
 * The shapes below were read off the live endpoint, not out of the docs, after
 * a first version keyed on `field` alone and fell through to the fallback on
 * the most common failure there is. `field` is *empty* for a wrong secret; the
 * information is in `resource`:
 *
 * | sent | status | resource | field |
 * | --- | --- | --- | --- |
 * | client_id that does not exist | 400 | `Application` | `client_id` |
 * | real client_id, wrong secret | 401 | `Application` | `""` |
 * | bad bearer on the activity call | 401 | `Athlete` | `access_token` |
 *
 * A blank `field` under `Application` therefore means the application was
 * found and its secret was refused, which is a different fix from an ID that
 * matches nothing. Both are handled by the same branch because the user checks
 * the same two boxes either way, but the distinction is why matching on
 * `resource` is what makes this work at all.
 */
/** The `{ resource, field, code }` triples Strava reports, as plain sets. */
function errorFacets(body: unknown): {
  resources: Set<string>;
  fields: Set<string>;
  codes: Set<string>;
} {
  const errors = (body as TokenErrorBody | null)?.errors ?? [];
  return {
    resources: new Set(errors.map((error) => error.resource ?? "")),
    fields: new Set(errors.map((error) => error.field ?? "")),
    codes: new Set(errors.map((error) => error.code ?? "")),
  };
}

/**
 * Explain a 401 or 403 from an API call, as opposed to the token endpoint.
 *
 * Strava distinguishes "this token is not valid" from "this token is valid and
 * does not carry the permission you need", and the two have completely
 * different fixes: one is a stale credential, the other is an authorization
 * granted without a scope, which no amount of refreshing will repair. It
 * reports the second as a `missing` code on an `activity:read_permission`
 * field. Guessing between them from the status code alone gets it wrong
 * roughly half the time, and the wrong guess sends the user to replace a
 * working token.
 */
export function describeApiRejection(
  status: number,
  body: unknown,
  request: string,
): string {
  const { resources, fields, codes } = errorFacets(body);
  const scopeField = [...fields].some((field) => field.endsWith("_permission"));

  if (scopeField || codes.has("missing")) {
    return (
      `Strava refused the request while ${request} because the authorization is ` +
      "missing a permission, not because the token is stale. Re-authorize the " +
      "application with the activity:read_all scope — refreshing cannot add a " +
      "scope that was never granted — then store the new refresh token in Settings."
    );
  }
  if (fields.has("access_token") || resources.has("Athlete")) {
    return (
      `Strava rejected the access token while ${request}. It was issued by the ` +
      "token endpoint moments earlier, so this is not a stale credential: it " +
      "usually means the refresh token belongs to a different application than " +
      "the Client ID above."
    );
  }
  return (
    `Strava returned ${String(status)} while ${request} and did not say why. ` +
    "The credentials were accepted at the token endpoint, so the authorization " +
    "itself is the thing to check."
  );
}

export function describeTokenRejection(body: unknown): string {
  const { resources, fields } = errorFacets(body);

  if (fields.has("refresh_token") || resources.has("RefreshToken")) {
    return (
      "Strava rejected the stored refresh token. It has been rotated or revoked — " +
      "anything else using the same API application invalidates it by refreshing. " +
      "Re-authorize with the activity:read_all scope and store the new token in Settings."
    );
  }
  if (resources.has("Application") || fields.has("client_id")) {
    return (
      "Strava accepted the request but refused the application credentials. The " +
      "Client ID above and the stored client secret must both belong to the same " +
      "application on strava.com/settings/api — a secret copied with a missing " +
      "character or a trailing space fails exactly this way."
    );
  }
  // Deliberately worded differently from every other failure here. An earlier
  // version of this fallback was byte-identical to the 401 message from the
  // activity request, which made the two indistinguishable in the one place it
  // mattered: a user reading the message to decide what to fix.
  return (
    "Strava rejected the token request without saying which credential was wrong. " +
    "Check the Client ID above, the stored client secret, and the stored refresh " +
    "token — one of the three is not what Strava expects."
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
    await this.assertUsable(response, "refreshing the access token");

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
      await this.assertUsable(response, "reading activities");

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
  /**
   * `request` names which call failed, because the same status means different
   * things on the two endpoints and the fixes are not the same. A 401 on the
   * token endpoint is a bad credential; a 401 on the activity endpoint means
   * the credentials were *accepted* and the resulting authorization still
   * cannot read activities. Reporting both as "re-authorize and store a new
   * refresh token" sent the user to replace a token that was working.
   */
  private async assertUsable(response: Response, request: string): Promise<void> {
    if (response.ok) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      // Read the body. Twice now the answer to "why did this fail" was sitting
      // in a response this adapter parsed only far enough to learn the status
      // code, and both times the message it printed instead sent the user to
      // fix something that was not broken.
      const detail: unknown = await response.json().catch(() => null);
      throw new StravaAuthError(
        describeApiRejection(response.status, detail, request),
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
    throw new Error(
      `Strava replied ${String(response.status)} while ${request}.`,
    );
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
