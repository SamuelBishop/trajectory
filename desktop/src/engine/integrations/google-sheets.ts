/**
 * A training log read from one Google Sheet.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY],
 * [HC-NO-PRIVATE-DATA-COMMITS], [HC-OBSERVATION-VS-INFERENCE]
 *
 * Ingress-only, with the one documented exception. Reading the sheet is a `GET`
 * to `sheets.googleapis.com` carrying a bearer token and a range. Minting that
 * bearer token is a `POST` to `oauth2.googleapis.com` carrying a JWT signed by
 * the service account's private key — an assertion of which application is
 * asking, and nothing else. No goal, value, constraint, journal line, chat
 * message, or mentor text is ever part of a request.
 *
 * ## Why a service account
 *
 * Google's documentation is blunt about the alternative: a project whose
 * consent screen is external and whose publishing status is "Testing" is
 * issued a refresh token that expires in seven days. A personal, local,
 * single-user app cannot ask its user to re-authorize every week, and the way
 * out — publishing and submitting a sensitive scope for verification — is not
 * available to one either.
 *
 * A service account has no consent screen, no publishing status, and no
 * refresh token. It signs a JWT locally and exchanges it for an access token
 * that lasts an hour. Nothing rotates, so unlike Strava there is no credential
 * to write back.
 *
 * It is also the narrowest access model of any adapter here. A Strava token
 * can read every activity in the account; a Notion integration reads every
 * page shared with it. A service account begins able to see *nothing* and
 * gains exactly the files a human chose to share with its address. The scope
 * is `spreadsheets.readonly` rather than any Drive scope, because a Drive
 * scope would grant every file in the account.
 *
 * ## Why this source is worth a network call at all
 *
 * `strava.ts` argues that a hand-written log is a poor substitute for
 * measurement, because `current_state.yaml` is already the user's account of
 * themselves and checking one against the other is circular. This sheet is the
 * exception, and for a specific reason: it holds a *prescription* written by
 * someone else next to the *execution* written by the user. Strava has no
 * record of a run that was planned and skipped. This sheet does, on the same
 * row, and that is precisely the comparison `[HC-OBSERVATION-VS-INFERENCE]`
 * exists to keep honest.
 *
 * `fetch` is injected so the tests run against recorded payloads. A suite that
 * needs a live endpoint and a valid key is a suite that stops being run.
 */

import { createHash, createSign } from "node:crypto";

import type { ActivitySignal } from "../domain";
import type { GoogleSheetsConfig } from "./policy";
import { slugifyDomain } from "./notion";

export const GOOGLE_SHEETS_INTEGRATION_ID = "google_sheets";

const TOKEN_HOST = "oauth2.googleapis.com";
const SHEETS_HOST = "sheets.googleapis.com";
const TOKEN_URL = `https://${TOKEN_HOST}/token`;
const SHEETS_BASE = `https://${SHEETS_HOST}/v4/spreadsheets`;

/**
 * Read one kind of file, and only where it was shared.
 *
 * Not `drive.readonly`, which grants every file in the account and is a
 * *restricted* scope requiring a third-party security assessment. This one is
 * narrower in both senses: spreadsheets only, and only those a human shared
 * with this service account by hand.
 */
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/** Google's ceiling for a service-account assertion. */
const ASSERTION_LIFETIME_SECONDS = 3600;

/**
 * Treat a token as dead a minute early.
 *
 * Costs a request roughly never, and avoids sending one with a token that
 * expires between the check and the call.
 */
const EXPIRY_MARGIN_SECONDS = 60;

/** `ActivitySignal.summary` is capped here; the schema rejects anything longer. */
const SUMMARY_LIMIT = 280;

/**
 * Per-field caps, applied before the parts are joined.
 *
 * Truncating the joined string instead would let one long coach comment push
 * out what the user actually did — the truncation would be silent and would
 * remove the most important field to keep the least important one.
 */
const PLANNED_LIMIT = 90;
const ACTUAL_LIMIT = 110;
const NOTE_LIMIT = 60;

/**
 * The hosts this adapter is permitted to contact, as a predicate.
 *
 * `[HC-NO-EXFILTRATION]` names these two by hand, and the integrations guide
 * requires that a URL built from a *response* — a `next` link, a redirect
 * target — be validated before it is followed, since the declaration does not
 * cover it.
 *
 * No call site here can currently fail this check: every URL is built from
 * constants and an ID that `normalizeSpreadsheetId` has restricted to
 * `[A-Za-z0-9_-]`. It is kept, and tested on its own, so that the first
 * pagination cursor or redirect anyone adds is covered by default rather than
 * by remembering.
 */
export function isDeclaredHost(host: string): boolean {
  return host === TOKEN_HOST || host === SHEETS_HOST;
}

/** Raised when Google refuses. Carried to the user, never retried in a loop. */
export class GoogleSheetsAuthError extends Error {}
export class GoogleSheetsRateLimitError extends Error {}

/**
 * Pull the spreadsheet ID out of whatever the user pasted.
 *
 * They are told to copy the address bar, so accept the whole URL. A bare ID
 * works too. Anything else returns empty, which means the adapter makes no
 * request rather than asking Google about a malformed identifier.
 */
export function normalizeSpreadsheetId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  const candidate = fromUrl?.[1] ?? trimmed;
  // Google's IDs are long, opaque, and URL-safe. The length floor is what
  // stops a pasted fragment like "edit" being sent as an ID.
  return /^[a-zA-Z0-9_-]{20,}$/.test(candidate) ? candidate : "";
}

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

/**
 * Read the JSON file Google hands out when a service-account key is created.
 *
 * The whole file rather than its two useful fields, because the alternative is
 * telling someone to extract a PEM by hand from JSON that escapes every
 * newline as `\n`. `JSON.parse` unescapes them correctly and for free; a human
 * doing it in a text box gets a key that fails to sign with an error message
 * about signatures, which points at the wrong thing entirely.
 */
export function parseServiceAccount(pasted: string): ServiceAccount {
  const trimmed = pasted.trim();
  if (trimmed.length === 0) {
    throw new GoogleSheetsAuthError("Paste the service account JSON file.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new GoogleSheetsAuthError(
      "That is not valid JSON. Paste the whole contents of the key file " +
        "Google downloaded, including the outermost braces.",
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new GoogleSheetsAuthError("That JSON is not an object.");
  }
  const record = parsed as Record<string, unknown>;
  // An OAuth *client* download is the wrong file and the easy mistake: it comes
  // from the same Credentials page, has the same shape, and is also called
  // client_secret_….json. Naming it beats "private_key is missing".
  if ("installed" in record || "web" in record) {
    throw new GoogleSheetsAuthError(
      "That is an OAuth client file, not a service account key. It comes from " +
        "the same Credentials page. The one needed here is created under " +
        "Service Accounts, and its JSON contains a private_key.",
    );
  }
  const clientEmail = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const privateKey = typeof record.private_key === "string" ? record.private_key : "";
  if (clientEmail.length === 0 || privateKey.length === 0) {
    throw new GoogleSheetsAuthError(
      "That JSON has no client_email and private_key pair, so it is not a " +
        "service account key file.",
    );
  }
  return { clientEmail, privateKey: unescapeNewlines(privateKey) };
}

/**
 * Repair a key whose newlines survived as the two characters `\` and `n`.
 *
 * Happens when the JSON is round-tripped through something that escapes twice,
 * or when a user pastes the value of `private_key` rather than the file. A PEM
 * without real newlines will not sign, and the resulting error blames the
 * signature rather than the paste.
 */
function unescapeNewlines(key: string): string {
  return key.includes("\\n") ? key.replaceAll("\\n", "\n") : key;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Build the signed assertion that stands in for a user's consent.
 *
 * Exported for the tests: signing is the one step whose output cannot be
 * eyeballed, so it is worth asserting the claims separately from the transport.
 */
export function buildAssertion(account: ServiceAccount, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issuedAt,
      exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
    }),
  );
  const signingInput = `${header}.${claims}`;
  let signature: Buffer;
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signature = signer.sign(account.privateKey);
  } catch {
    // The key is malformed rather than merely wrong. Deliberately says nothing
    // about the key's contents.
    throw new GoogleSheetsAuthError(
      "The stored private key could not be used to sign. Re-paste the service " +
        "account JSON file exactly as Google downloaded it.",
    );
  }
  return `${signingInput}.${base64url(signature)}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Google's two rejection shapes.
 *
 * The token endpoint answers `{ error, error_description }`. The API answers
 * `{ error: { code, message, status } }`. Reading only the status code and
 * discarding the body is the mistake that cost three rounds of live debugging
 * on the Strava adapter: every failure printed the same advice, and it sent
 * the user to replace a credential that was working.
 */
interface TokenErrorBody {
  error?: string;
  error_description?: string;
}

interface ApiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

function tokenErrorFacets(detail: unknown): TokenErrorBody {
  if (typeof detail !== "object" || detail === null) {
    return {};
  }
  const record = detail as Record<string, unknown>;
  return {
    error: typeof record.error === "string" ? record.error : undefined,
    error_description:
      typeof record.error_description === "string" ? record.error_description : undefined,
  };
}

function apiErrorFacets(detail: unknown): NonNullable<ApiErrorBody["error"]> {
  if (typeof detail !== "object" || detail === null) {
    return {};
  }
  const inner = (detail as Record<string, unknown>).error;
  if (typeof inner !== "object" || inner === null) {
    return {};
  }
  const record = inner as Record<string, unknown>;
  return {
    code: typeof record.code === "number" ? record.code : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    status: typeof record.status === "string" ? record.status : undefined,
  };
}

/**
 * Say which part of the setup is wrong when the token endpoint refuses.
 *
 * Every branch names a different repair, because a message that fits two
 * unrelated causes is a message that sends the user to the wrong one.
 */
export function describeTokenRejection(detail: unknown): string {
  const { error, error_description: description } = tokenErrorFacets(detail);
  const text = description ?? "";
  if (/signature/i.test(text)) {
    return (
      "Google rejected the signature on the token request. The stored private " +
      "key does not match the service account it claims to be from — create a " +
      "new key for that service account and paste its JSON file again."
    );
  }
  // Worth its own branch because nothing about the credential is wrong, and
  // every other message here would send the user to replace a working key.
  // The wording is Google's own: a JWT issued outside the window comes back as
  // "Token must be a short-lived token and in a reasonable timeframe".
  if (/timeframe|short-lived|too early|too late|expired|clock|\biat\b|\bexp\b/i.test(text)) {
    return (
      "Google rejected the token request as issued outside the allowed time " +
      "window. That points at this machine's clock rather than at the " +
      "credential: check that the system time and time zone are correct."
    );
  }
  if (/invalid_client|not found|deleted|disabled/i.test(`${error ?? ""} ${text}`)) {
    return (
      "Google does not recognize that service account. It may have been " +
      "deleted or disabled in the Cloud console — confirm it still exists, " +
      "then paste a fresh key file."
    );
  }
  if (error === "invalid_scope") {
    return (
      "Google refused the requested scope. Enable the Google Sheets API for " +
      "the project that owns this service account."
    );
  }
  return (
    "Google refused to issue an access token and did not say why in a form " +
    "this app recognizes. Check that the Sheets API is enabled for the " +
    "project and that the service account still exists."
  );
}

/**
 * Say what to fix when the Sheets API itself refuses.
 *
 * A failure here is not a failure at the token endpoint: the credential was
 * just accepted seconds ago, so any message telling the user to replace it is
 * wrong. `clientEmail` is threaded in because the overwhelmingly likely cause
 * is that the sheet was never shared, and the address to share it with is the
 * one piece of information that makes that fixable.
 */
export function describeApiRejection(
  status: number,
  detail: unknown,
  clientEmail: string,
): string {
  const { message, status: googleStatus } = apiErrorFacets(detail);
  const text = message ?? "";
  const shareWith = clientEmail.length > 0 ? clientEmail : "the service account's address";

  if (status === 429 || googleStatus === "RESOURCE_EXHAUSTED") {
    return "Google is rate limiting this app. The next sync will try again.";
  }
  // Checked before PERMISSION_DENIED: a disabled API also returns 403, and the
  // fix is in the Cloud console rather than in the sheet's sharing dialog.
  if (googleStatus === "SERVICE_DISABLED" || /has not been used in project|is disabled/i.test(text)) {
    return (
      "The Google Sheets API is not enabled for the project that owns this " +
      "service account. Enable it in the Cloud console, wait a minute, then " +
      "sync again."
    );
  }
  if (status === 403 || googleStatus === "PERMISSION_DENIED") {
    return (
      `The service account cannot open that spreadsheet. Share the sheet with ` +
      `${shareWith} — open it in Google Sheets, press Share, paste that ` +
      `address, and give it Viewer. A service account can only read files that ` +
      `have been shared with it explicitly.`
    );
  }
  if (status === 404 || googleStatus === "NOT_FOUND") {
    return (
      "Google has no spreadsheet with that ID. Re-copy the address of the " +
      "sheet from the browser and paste the whole URL into Settings."
    );
  }
  if (/unable to parse range|not found in spreadsheet/i.test(text)) {
    return (
      "That tab does not exist in the spreadsheet. Check the tab name at the " +
      "bottom of the sheet — it must match exactly, including spaces."
    );
  }
  if (status === 401) {
    return (
      "Google accepted the credential and then refused the read. The access " +
      "token was issued for a different scope than the Sheets API needs, " +
      "which usually means the key file belongs to another project."
    );
  }
  return `Google refused to read the spreadsheet (HTTP ${String(status)}).`;
}

/** Header cells wrap, so a column named on two lines contains a real newline. */
export function normalizeHeader(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Turn a column header into a metric key the model can read.
 *
 * `metric_columns` maps header to key because the two are rarely the same
 * string: "Running \nMiles" is a header, `running_miles` is an identifier.
 * Deriving the key rather than asking for it removes a field whose only correct
 * answer is mechanical, and a header of pure punctuation yields "" so the
 * caller can decline it rather than storing a nameless metric.
 */
export function metricKey(header: string): string {
  return normalizeHeader(header)
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
}

/**
 * Locate a column by name.
 *
 * By name and not by letter. A training log is a living document, and a layout
 * pinned to spreadsheet columns does not fail when one is inserted — it keeps
 * working and starts reading the wrong data, which is worse.
 */
export function headerIndex(headers: readonly string[], name: string): number {
  if (name.trim().length === 0) {
    return -1;
  }
  const wanted = normalizeHeader(name);
  return headers.findIndex((header) => normalizeHeader(header) === wanted);
}

/** Google Sheets counts days from 1899-12-30. */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function isoFromUtc(ms: number): string {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Turn whatever is in the date cell into a calendar date.
 *
 * A serial number is handled in UTC on purpose, and this is not the usual
 * timezone mistake. A serial is not an instant — it is a count of days, and
 * day 46_000 means the same square on the calendar wherever it is read. Doing
 * the arithmetic in UTC and reading back UTC components keeps it that way;
 * converting through local time is what would shift it by one.
 *
 * `today` is the local date, used only to choose a year for the `M/D` form
 * that a hand-kept log frequently uses.
 */
export function parseSheetDate(raw: unknown, today: string): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // Sheets stores a date-time as a fractional serial; the whole part is the
    // day, and the fraction is a time we have no use for.
    return isoFromUtc(SHEETS_EPOCH_UTC + Math.floor(raw) * MS_PER_DAY);
  }
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim();
  if (text.length === 0) {
    return null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const slashed = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(text);
  if (!slashed) {
    return null;
  }
  const month = Number(slashed[1]);
  const day = Number(slashed[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const explicitYear = slashed[3];
  if (explicitYear !== undefined) {
    const year = Number(explicitYear);
    return formatParts(year < 100 ? 2000 + year : year, month, day);
  }
  return nearestYear(month, day, today);
}

function formatParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Choose the year that puts a bare `M/D` closest to today.
 *
 * A log kept through a new year holds both "12/28" and "1/3", and reading
 * every row as the current year files last month's training twelve months
 * away. Nearest-to-today gets both right either side of the boundary.
 */
function nearestYear(month: number, day: number, today: string): string | null {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(todayMs)) {
    return null;
  }
  const thisYear = Number(today.slice(0, 4));
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
    const candidateMs = Date.UTC(year, month - 1, day);
    // Rejects 2/30 and friends, which Date.UTC would silently roll forward
    // into a date the user never wrote.
    if (new Date(candidateMs).getUTCMonth() !== month - 1) {
      continue;
    }
    const distance = Math.abs(candidateMs - todayMs);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = formatParts(year, month, day);
    }
  }
  return best;
}

function cellText(row: readonly unknown[], index: number): string {
  if (index < 0) {
    return "";
  }
  const value = row[index];
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.replaceAll(/\s+/g, " ").trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function cellNumber(row: readonly unknown[], index: number): number | null {
  if (index < 0) {
    return null;
  }
  const value = row[index];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    // Tolerates "6.5 mi" and "1,200", which hand-kept logs are full of.
    const cleaned = value.replaceAll(",", "").trim();
    const match = /^-?\d+(?:\.\d+)?/.exec(cleaned);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Assemble the one sentence the model will read for this day.
 *
 * Planned first, then done, then the free-text columns in configured order.
 * Each is capped before the join so a long note cannot displace the two fields
 * that carry the comparison.
 */
export function rowSummary(
  planned: string,
  actual: string,
  notes: readonly { label: string; text: string }[],
): string {
  const parts: string[] = [];
  if (planned.length > 0) {
    parts.push(`Planned: ${clip(planned, PLANNED_LIMIT)}`);
  }
  if (actual.length > 0) {
    parts.push(`Did: ${clip(actual, ACTUAL_LIMIT)}`);
  }
  for (const note of notes) {
    if (note.text.length > 0) {
      parts.push(`${normalizeLabel(note.label)}: ${clip(note.text, NOTE_LIMIT)}`);
    }
  }
  return clip(parts.join(" · "), SUMMARY_LIMIT);
}

function normalizeLabel(label: string): string {
  return label.replaceAll(/\s+/g, " ").trim();
}

interface SheetProperties {
  properties?: { title?: string; sheetId?: number };
}

interface SpreadsheetMeta {
  sheets?: SheetProperties[];
}

interface ValueRange {
  values?: unknown[][];
}

/**
 * What the sync could not use.
 *
 * Surfaced rather than swallowed. Two of the last four fixes in this codebase
 * were silent data loss — a truncated activity list and a dropped Notion
 * page — and both looked like success while returning less than the truth.
 */
export interface SkipCounts {
  undated: number;
  future: number;
  empty: number;
}

export class GoogleSheetsAdapter {
  readonly id = GOOGLE_SHEETS_INTEGRATION_ID;
  readonly version = "1.0.0";
  readonly hosts: readonly string[] = [TOKEN_HOST, SHEETS_HOST];
  readonly label = "Google Sheets training log";
  readonly requiresCredential = true as const;
  readonly credentialHint =
    "The JSON key file for a Google service account, from the Google Cloud " +
    "console. The training log must then be shared with that account's email " +
    "address, exactly as it would be shared with a person.";

  /** Cached between syncs; there is nothing to persist, so it stays in memory. */
  private cachedToken: { value: string; expiresAt: number } | null = null;

  private lastSkips: SkipCounts = { undated: 0, future: 0, empty: 0 };

  constructor(
    private readonly config: () => Promise<GoogleSheetsConfig>,
    private readonly httpFetch: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** What the last `fetch` declined to turn into signals, and why. */
  skips(): SkipCounts {
    return { ...this.lastSkips };
  }

  async fetch(since: string | null, credential?: string): Promise<ActivitySignal[]> {
    this.lastSkips = { undated: 0, future: 0, empty: 0 };
    const config = await this.config();
    const spreadsheetId = normalizeSpreadsheetId(config.spreadsheet_id);
    if (spreadsheetId.length === 0) {
      return [];
    }
    if (credential === undefined || credential.trim().length === 0) {
      throw new GoogleSheetsAuthError(
        "No Google service account key is stored, so the sheet cannot be read.",
      );
    }
    const account = parseServiceAccount(credential);
    const token = await this.accessToken(account);

    const meta = await this.spreadsheetMeta(spreadsheetId, token, account.clientEmail);
    const tab = this.chooseTab(meta, config.tab_name);
    const range = `${quoteTab(tab.title)}!A${String(config.header_row)}:ZZ`;
    const values = await this.values(spreadsheetId, range, token, account.clientEmail);

    return this.toSignals(values, config, spreadsheetId, tab, since);
  }

  private async accessToken(account: ServiceAccount): Promise<string> {
    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const cached = this.cachedToken;
    if (cached && cached.expiresAt - EXPIRY_MARGIN_SECONDS > nowSeconds) {
      return cached.value;
    }
    const assertion = buildAssertion(account, this.now());
    const response = await this.httpFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      const detail: unknown = await response.json().catch(() => null);
      throw new GoogleSheetsAuthError(describeTokenRejection(detail));
    }
    const body = (await response.json()) as TokenResponse;
    const value = body.access_token ?? "";
    if (value.length === 0) {
      throw new GoogleSheetsAuthError("Google returned no access token.");
    }
    this.cachedToken = {
      value,
      expiresAt: nowSeconds + (body.expires_in ?? ASSERTION_LIFETIME_SECONDS),
    };
    return value;
  }

  private async spreadsheetMeta(
    spreadsheetId: string,
    token: string,
    clientEmail: string,
  ): Promise<SpreadsheetMeta> {
    const url = `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(
      "sheets.properties.title,sheets.properties.sheetId",
    )}`;
    const response = await this.request(url, token, clientEmail);
    return (await response.json()) as SpreadsheetMeta;
  }

  private async values(
    spreadsheetId: string,
    range: string,
    token: string,
    clientEmail: string,
  ): Promise<unknown[][]> {
    // UNFORMATTED_VALUE with SERIAL_NUMBER because a formatted date is
    // whatever the sheet's display locale says it is, while a serial is a
    // count of days and means the same thing everywhere.
    const url =
      `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}` +
      `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`;
    const response = await this.request(url, token, clientEmail);
    const body = (await response.json()) as ValueRange;
    return body.values ?? [];
  }

  private async request(url: string, token: string, clientEmail: string): Promise<Response> {
    const target = new URL(url);
    // Checked rather than assumed. See isDeclaredHost: unreachable from here
    // today, kept so a future response-derived URL cannot slip past.
    if (!isDeclaredHost(target.host)) {
      throw new GoogleSheetsAuthError(`Refusing to contact ${target.host}.`);
    }
    const response = await this.httpFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      return response;
    }
    const detail: unknown = await response.json().catch(() => null);
    const message = describeApiRejection(response.status, detail, clientEmail);
    if (response.status === 429) {
      throw new GoogleSheetsRateLimitError(message);
    }
    throw new GoogleSheetsAuthError(message);
  }

  private chooseTab(
    meta: SpreadsheetMeta,
    wanted: string,
  ): { title: string; sheetId: number } {
    const sheets = (meta.sheets ?? [])
      .map((sheet) => ({
        title: sheet.properties?.title ?? "",
        sheetId: sheet.properties?.sheetId ?? 0,
      }))
      .filter((sheet) => sheet.title.length > 0);
    if (sheets.length === 0) {
      throw new GoogleSheetsAuthError("That spreadsheet has no readable tabs.");
    }
    if (wanted.trim().length === 0) {
      return sheets[0] as { title: string; sheetId: number };
    }
    const match = sheets.find(
      (sheet) => normalizeHeader(sheet.title) === normalizeHeader(wanted),
    );
    if (!match) {
      // Listing what does exist turns "it says the tab is missing" into a fix.
      throw new GoogleSheetsAuthError(
        `That spreadsheet has no tab named "${wanted}". It has: ` +
          `${sheets.map((sheet) => sheet.title).join(", ")}.`,
      );
    }
    return match;
  }

  private toSignals(
    values: readonly unknown[][],
    config: GoogleSheetsConfig,
    spreadsheetId: string,
    tab: { title: string; sheetId: number },
    since: string | null,
  ): ActivitySignal[] {
    const headerOffset = config.first_data_row - config.header_row;
    const headers = (values[0] ?? []).map((cell) =>
      typeof cell === "string" ? cell : String(cell ?? ""),
    );
    const now = this.now();
    const today = localCalendarDate(now);
    const fetchedAt = now.toISOString();
    const domain = slugifyDomain(config.default_domain) || "training";

    const dateAt = headerIndex(headers, config.date_column);
    const plannedAt = headerIndex(headers, config.planned_column);
    const actualAt = headerIndex(headers, config.actual_column);
    const noteColumns = config.note_columns
      .map((name) => ({ label: name, index: headerIndex(headers, name) }))
      .filter((column) => column.index >= 0);
    const metricColumns = Object.entries(config.metric_columns)
      .map(([header, key]) => ({ key, index: headerIndex(headers, header) }))
      .filter((column) => column.index >= 0 && column.key.trim().length > 0);

    if (dateAt < 0) {
      throw new GoogleSheetsAuthError(
        `No column named "${config.date_column}" in row ` +
          `${String(config.header_row)} of that tab. It has: ` +
          `${headers.filter((header) => header.trim().length > 0).map(normalizeLabel).join(", ")}.`,
      );
    }

    const earliest = this.earliest(config.lookback_days, today, since);
    const signals: ActivitySignal[] = [];
    const perDate = new Map<string, number>();
    let dataRows = 0;

    for (let offset = headerOffset; offset < values.length; offset += 1) {
      const row = values[offset] ?? [];
      const rowNumber = config.header_row + offset;
      const planned = cellText(row, plannedAt);
      const actual = cellText(row, actualAt);
      const notes = noteColumns.map((column) => ({
        label: column.label,
        text: cellText(row, column.index),
      }));
      const metrics: Record<string, number> = {};
      for (const column of metricColumns) {
        const value = cellNumber(row, column.index);
        if (value !== null) {
          metrics[column.key] = value;
        }
      }
      const hasContent =
        planned.length > 0 ||
        actual.length > 0 ||
        notes.some((note) => note.text.length > 0) ||
        Object.keys(metrics).length > 0;
      const rawDate = dateAt >= 0 ? row[dateAt] : undefined;
      const hasDateCell = rawDate !== undefined && rawDate !== null && String(rawDate).trim() !== "";
      if (!hasContent && !hasDateCell) {
        continue;
      }
      dataRows += 1;

      const occurred = parseSheetDate(rawDate, today);
      if (occurred === null) {
        this.lastSkips.undated += 1;
        continue;
      }
      if (!hasContent) {
        this.lastSkips.empty += 1;
        continue;
      }
      if (occurred > today) {
        // Not a missed session — a session that has not come round yet.
        // Stored as `completed: false` it would land in `open_count` and break
        // `streak_days`, turning next month's plan into a backlog of failures.
        this.lastSkips.future += 1;
        continue;
      }
      if (occurred < earliest) {
        continue;
      }

      const ordinal = perDate.get(occurred) ?? 0;
      perDate.set(occurred, ordinal + 1);
      const summary = rowSummary(planned, actual, notes);

      signals.push({
        id: signalId(spreadsheetId, tab.title, occurred, ordinal),
        integration_id: GOOGLE_SHEETS_INTEGRATION_ID,
        kind: "workout",
        occurred_at: occurred,
        summary: summary.length > 0 ? summary : describeMetrics(metrics),
        domain,
        metrics,
        // The whole reason this source is worth reading. An empty "actual" on a
        // past date is a session that was prescribed and not done, which no
        // other integration here can observe.
        completed: actual.length > 0,
        url:
          `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` +
          `#gid=${String(tab.sheetId)}&range=A${String(rowNumber)}`,
        provenance: {
          fetched_at: fetchedAt,
          adapter_version: this.version,
          account_label: GOOGLE_SHEETS_INTEGRATION_ID,
          manually_reviewed: false,
        },
      });
    }

    // Every row unreadable is a misconfigured column, not an empty log. Left to
    // report success it would show "0 records" and give nothing to act on.
    if (dataRows > 0 && this.lastSkips.undated === dataRows) {
      throw new GoogleSheetsAuthError(
        `None of the ${String(dataRows)} rows had a readable date in the ` +
          `"${config.date_column}" column. If the first rows of the tab are ` +
          `headings, raise the first data row in Settings.`,
      );
    }
    return signals;
  }

  /**
   * The oldest date worth emitting.
   *
   * Deliberately does *not* resume from `since`, unlike every other adapter
   * here. Those pull from an API that charges per record; this one has already
   * paid for the whole range in a single request, so narrowing buys nothing.
   *
   * It would also lose data. This sheet's defining rhythm is a row written on
   * Monday and filled in on Wednesday, and a sync that started after Monday
   * would never see the "actual" arrive. `since` is used only to widen the
   * window, never to narrow it.
   */
  private earliest(lookbackDays: number, today: string, since: string | null): string {
    const todayMs = Date.parse(`${today}T00:00:00Z`);
    const window = isoFromUtc(todayMs - (lookbackDays - 1) * MS_PER_DAY);
    const sinceDate = since === null ? null : since.slice(0, 10);
    if (sinceDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) && sinceDate < window) {
      return sinceDate;
    }
    return window;
  }
}

/** The calendar date where the user is, which is the one their log is kept in. */
function localCalendarDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * A stable identifier for one row.
 *
 * Keyed on the date rather than on the row's text, and this is load-bearing.
 * `SignalSink.merge` upserts by id, and the whole point of this sheet is that a
 * row is written when the session is planned and completed when it is done.
 * An id derived from the contents would make filling in the "actual" column
 * create a *second* signal for that day — a plan and an achievement, stored
 * side by side, which is exactly the confusion `completed` exists to prevent.
 *
 * Not the row number either: inserting a row above shifts every id below it.
 */
export function signalId(
  spreadsheetId: string,
  tab: string,
  occurred: string,
  ordinal: number,
): string {
  const source = createHash("sha256")
    .update(`${spreadsheetId}\u0000${tab}`)
    .digest("hex")
    .slice(0, 12);
  return `${GOOGLE_SHEETS_INTEGRATION_ID}_${source}_${occurred}_${String(ordinal)}`;
}

/** Last resort when a row carries numbers but no words. */
function describeMetrics(metrics: Record<string, number>): string {
  const parts = Object.entries(metrics).map(
    ([key, value]) => `${key.replaceAll("_", " ")} ${String(value)}`,
  );
  return parts.length > 0 ? clip(parts.join(", "), SUMMARY_LIMIT) : "Logged";
}

/** Sheets ranges quote a tab name with spaces, and escape quotes by doubling. */
function quoteTab(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}
