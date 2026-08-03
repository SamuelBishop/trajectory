/**
 * Google Sheets adapter behaviour, against recorded shapes only.
 *
 * Implements: [HC-TEST-WITH-BEHAVIOR], [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * Never calls a live endpoint: a suite that needs network access and a valid
 * service-account key is a suite that quietly stops being run. Every workout,
 * note and coach comment below is invented. The RSA key is generated in-process
 * at import time so no key material is committed either.
 */

import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GoogleSheetsAdapter,
  GoogleSheetsAuthError,
  GoogleSheetsRateLimitError,
  buildAssertion,
  describeApiRejection,
  describeTokenRejection,
  headerIndex,
  isDeclaredHost,
  metricKey,
  normalizeHeader,
  normalizeSpreadsheetId,
  parseServiceAccount,
  parseSheetDate,
  rowSummary,
  signalId,
} from "../../../src/engine/integrations/google-sheets";
import { googleSheetsConfigSchema } from "../../../src/engine/integrations/policy";
import { activitySignalSchema } from "../../../src/engine/domain";

const now = new Date("2026-03-10T09:00:00.000Z");
const SPREADSHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-x";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ACCOUNT = {
  client_email: "trajectory-reader@example-project.iam.gserviceaccount.com",
  private_key: privateKey,
};

function credential(): string {
  return JSON.stringify(ACCOUNT);
}

function config(overrides: Record<string, unknown> = {}) {
  return googleSheetsConfigSchema.parse({
    spreadsheet_id: SPREADSHEET,
    tab_name: "2026 Log",
    header_row: 1,
    first_data_row: 3,
    client_email: ACCOUNT.client_email,
    date_column: "Date",
    planned_column: "Workout",
    actual_column: "Actual",
    note_columns: ["Notes", "Comments from Coach"],
    metric_columns: {
      "Running Miles": "running_miles",
      "X-training Miles": "xtraining_miles",
      RPE: "rpe",
      "Work load": "work_load",
    },
    default_domain: "training",
    lookback_days: 30,
    ...overrides,
  });
}

/**
 * The real sheet wraps its headers, so two of these carry a literal newline.
 * Matching that has to survive normalization or every metric silently vanishes.
 */
const HEADERS = [
  "Date",
  "Workout",
  "Actual",
  "Running \nMiles",
  "X-training \nMiles",
  "RPE",
  "Work load",
  "Notes",
  "Comments from Coach",
];

const DESCRIPTIONS = [
  "",
  "Planned Workouts",
  "What you actually did",
  "Total running miles",
  "Total miles of x-training",
  "Effort on a scale of 1 to 5",
  "Distance * RPE",
  "Life notes",
  "Feedback",
];

/** 2026-03-09 as a Sheets serial. */
const MARCH_9 = 46_090;

function serialFor(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

interface Reply {
  status?: number;
  body: unknown;
}

/** Replays recorded shapes in order and records what was asked for. */
function recorder(replies: Reply[]) {
  const urls: string[] = [];
  const bodies: string[] = [];
  let index = 0;
  const httpFetch: typeof fetch = (url, init) => {
    urls.push(String(url));
    const body = (init as RequestInit | undefined)?.body;
    if (typeof body === "string") {
      bodies.push(body);
    }
    const reply = replies[index] ?? replies.at(-1);
    index += 1;
    return Promise.resolve(
      new Response(JSON.stringify(reply?.body ?? {}), { status: reply?.status ?? 200 }),
    );
  };
  return { httpFetch, urls, bodies };
}

function tokenReply(): Reply {
  return { body: { access_token: "issued-access-token", expires_in: 3599 } };
}

function metaReply(title = "2026 Log"): Reply {
  return { body: { sheets: [{ properties: { title, sheetId: 884_411 } }] } };
}

function valuesReply(rows: unknown[][]): Reply {
  return { body: { values: [HEADERS, DESCRIPTIONS, ...rows] } };
}

function adapter(overrides: Record<string, unknown> = {}, replies: Reply[] = []) {
  const http = recorder(replies);
  return {
    http,
    instance: new GoogleSheetsAdapter(
      () => Promise.resolve(config(overrides)),
      http.httpFetch,
      () => now,
    ),
  };
}

describe("isDeclaredHost", () => {
  // [HC-NO-EXFILTRATION] names these two hosts by hand. No call site can fail
  // this check today — every URL is built from constants and a sanitized ID —
  // so it is tested directly rather than through a request it cannot provoke.
  it("admits exactly the two hosts the constitution names", () => {
    expect(isDeclaredHost("oauth2.googleapis.com")).toBe(true);
    expect(isDeclaredHost("sheets.googleapis.com")).toBe(true);
  });

  it("refuses everything else, including neighbouring Google hosts", () => {
    for (const host of [
      "docs.google.com",
      "www.googleapis.com",
      "drive.googleapis.com",
      "sheets.googleapis.com.evil.example",
      "",
    ]) {
      expect(isDeclaredHost(host)).toBe(false);
    }
  });

  it("agrees with what the adapter declares", () => {
    const declared = new GoogleSheetsAdapter(() => Promise.resolve(config())).hosts;
    expect([...declared].every(isDeclaredHost)).toBe(true);
    expect(declared).toHaveLength(2);
  });
});

describe("normalizeSpreadsheetId", () => {
  it("takes the ID out of a pasted address bar", () => {
    expect(
      normalizeSpreadsheetId(`https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit#gid=0`),
    ).toBe(SPREADSHEET);
  });

  it("accepts a bare ID, because people paste that too", () => {
    expect(normalizeSpreadsheetId(`  ${SPREADSHEET}  `)).toBe(SPREADSHEET);
  });

  it("refuses a fragment rather than asking Google about it", () => {
    expect(normalizeSpreadsheetId("edit")).toBe("");
    expect(normalizeSpreadsheetId("")).toBe("");
    expect(normalizeSpreadsheetId("https://docs.google.com/spreadsheets/")).toBe("");
  });
});

describe("parseServiceAccount", () => {
  it("reads the two fields out of the downloaded key file", () => {
    const account = parseServiceAccount(credential());
    expect(account.clientEmail).toBe(ACCOUNT.client_email);
    expect(account.privateKey.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
  });

  it("repairs a key whose newlines survived as backslash-n", () => {
    // What a user gets by copying the value of private_key out of the file
    // rather than the file itself. A PEM without real newlines will not sign,
    // and the error it produces blames the signature instead of the paste.
    const escaped = JSON.stringify({
      client_email: ACCOUNT.client_email,
      private_key: privateKey.replaceAll("\n", "\\n"),
    });
    expect(parseServiceAccount(escaped).privateKey).toBe(privateKey);
  });

  it("names the OAuth client file as the wrong file", () => {
    // The easy mistake: same Credentials page, similar filename. "private_key
    // is missing" would not tell anyone which download to go back for.
    expect(() =>
      parseServiceAccount(JSON.stringify({ installed: { client_id: "x" } })),
    ).toThrow(/OAuth client file/);
  });

  it("rejects text that is not JSON at all", () => {
    expect(() => parseServiceAccount("not json")).toThrow(/valid JSON/);
    expect(() => parseServiceAccount("   ")).toThrow(/service account JSON/);
  });

  it("rejects JSON that has no key pair in it", () => {
    expect(() => parseServiceAccount(JSON.stringify({ project_id: "p" }))).toThrow(
      /client_email and private_key/,
    );
  });

  it("never repeats the key material in an error", () => {
    const message = (() => {
      try {
        parseServiceAccount(JSON.stringify({ private_key: privateKey }));
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(privateKey.slice(40, 120));
  });
});

describe("buildAssertion", () => {
  it("claims the readonly Sheets scope and this account", () => {
    const [, claims] = buildAssertion(
      { clientEmail: ACCOUNT.client_email, privateKey },
      now,
    ).split(".");
    const decoded = JSON.parse(
      Buffer.from(claims ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(decoded.iss).toBe(ACCOUNT.client_email);
    // Not any Drive scope: a Drive scope grants every file in the account,
    // where this grants only spreadsheets that were shared explicitly.
    expect(decoded.scope).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(decoded.aud).toBe("https://oauth2.googleapis.com/token");
  });

  it("expires the assertion within Google's one-hour ceiling", () => {
    const [, claims] = buildAssertion(
      { clientEmail: ACCOUNT.client_email, privateKey },
      now,
    ).split(".");
    const decoded = JSON.parse(
      Buffer.from(claims ?? "", "base64url").toString("utf8"),
    ) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(3600);
    expect(decoded.iat).toBe(Math.floor(now.getTime() / 1000));
  });

  it("signs with RS256 and produces three segments", () => {
    const assertion = buildAssertion({ clientEmail: "a@b.c", privateKey }, now);
    const parts = assertion.split(".");
    expect(parts).toHaveLength(3);
    expect(
      JSON.parse(Buffer.from(parts[0] ?? "", "base64url").toString("utf8")),
    ).toEqual({ alg: "RS256", typ: "JWT" });
    expect((parts[2] ?? "").length).toBeGreaterThan(0);
  });

  it("reports a malformed key without describing it", () => {
    expect(() => buildAssertion({ clientEmail: "a@b.c", privateKey: "nonsense" }, now)).toThrow(
      /could not be used to sign/,
    );
  });
});

describe("parseSheetDate", () => {
  it("reads a serial as the calendar square it names", () => {
    // A serial is a count of days, not an instant, so it means the same date
    // wherever it is read. Converting through local time is what would shift it.
    expect(parseSheetDate(MARCH_9, "2026-03-10")).toBe("2026-03-09");
    expect(parseSheetDate(serialFor("2026-01-01"), "2026-03-10")).toBe("2026-01-01");
  });

  it("drops the time part of a date-time serial", () => {
    expect(parseSheetDate(MARCH_9 + 0.75, "2026-03-10")).toBe("2026-03-09");
  });

  it("reads an ISO string", () => {
    expect(parseSheetDate("2026-03-09", "2026-03-10")).toBe("2026-03-09");
    expect(parseSheetDate("2026-03-09T14:00:00Z", "2026-03-10")).toBe("2026-03-09");
  });

  it("reads M/D/YYYY and two-digit years", () => {
    expect(parseSheetDate("3/9/2026", "2026-03-10")).toBe("2026-03-09");
    expect(parseSheetDate("3/9/26", "2026-03-10")).toBe("2026-03-09");
  });

  it("chooses the year that puts a bare M/D nearest today", () => {
    // A log kept across New Year holds both 12/28 and 1/3. Reading every row
    // as the current year files last month's training twelve months away.
    expect(parseSheetDate("12/28", "2026-01-03")).toBe("2025-12-28");
    expect(parseSheetDate("1/3", "2025-12-28")).toBe("2026-01-03");
    expect(parseSheetDate("3/9", "2026-03-10")).toBe("2026-03-09");
  });

  it("refuses a date that does not exist rather than rolling it forward", () => {
    expect(parseSheetDate("2/30", "2026-03-10")).toBeNull();
    expect(parseSheetDate("13/1", "2026-03-10")).toBeNull();
  });

  it("returns null for prose instead of guessing", () => {
    expect(parseSheetDate("Week of the 9th", "2026-03-10")).toBeNull();
    expect(parseSheetDate("", "2026-03-10")).toBeNull();
    expect(parseSheetDate(null, "2026-03-10")).toBeNull();
  });
});

describe("metricKey", () => {
  it("turns a wrapped header into a legal identifier", () => {
    expect(metricKey("Running \nMiles")).toBe("running_miles");
    expect(metricKey("X-training \nMiles")).toBe("x_training_miles");
    expect(metricKey("Work load")).toBe("work_load");
    expect(metricKey("RPE")).toBe("rpe");
  });

  it("does not leave an identifier starting or ending in an underscore", () => {
    expect(metricKey("  Miles!  ")).toBe("miles");
    expect(metricKey("(RPE)")).toBe("rpe");
  });

  it("returns nothing for a header with no letters or digits", () => {
    // The caller declines rather than storing a metric with an empty name.
    expect(metricKey("—")).toBe("");
    expect(metricKey("   ")).toBe("");
  });
});

describe("normalizeHeader and headerIndex", () => {
  it("matches a header that wraps onto two lines", () => {
    // The real sheet's "Running \nMiles". Without this every metric column
    // silently fails to match and the numbers disappear without an error.
    expect(normalizeHeader("Running \nMiles")).toBe("running miles");
    expect(headerIndex(HEADERS, "Running Miles")).toBe(3);
    expect(headerIndex(HEADERS, "x-training miles")).toBe(4);
  });

  it("reports an absent column rather than matching the first one", () => {
    expect(headerIndex(HEADERS, "Sleep")).toBe(-1);
    expect(headerIndex(HEADERS, "")).toBe(-1);
  });
});

describe("rowSummary", () => {
  it("puts the plan and the execution side by side", () => {
    expect(
      rowSummary("6 mi easy", "6.2 mi, felt strong", [
        { label: "Notes", text: "left calf tight" },
      ]),
    ).toBe("Planned: 6 mi easy · Did: 6.2 mi, felt strong · Notes: left calf tight");
  });

  it("keeps the label a coach column was given", () => {
    expect(rowSummary("", "", [{ label: "Comments from Coach", text: "nice week" }])).toBe(
      "Comments from Coach: nice week",
    );
  });

  it("caps each field so a long note cannot displace what was done", () => {
    // Truncating the joined string instead would drop the most important field
    // to keep the least important one, silently.
    const summary = rowSummary("6 mi easy", "6.2 mi, felt strong", [
      { label: "Notes", text: "x".repeat(400) },
    ]);
    expect(summary).toContain("Planned: 6 mi easy");
    expect(summary).toContain("Did: 6.2 mi, felt strong");
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it("caps a long plan so what was actually done still fits", () => {
    // A prescription can be a paragraph — intervals, paces, warm-up, cool-down.
    // Uncapped it consumes the whole budget and the execution, which is the
    // half that cannot be recovered from anywhere else, is cut off entirely.
    const summary = rowSummary(
      `${"3x1600 at 6:30 with 400 jog, ".repeat(20)}`,
      "6.2 mi, felt strong",
      [],
    );
    expect(summary).toContain("Did: 6.2 mi, felt strong");
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it("caps a long execution so the plan beside it survives", () => {
    const summary = rowSummary("6 mi easy", "a".repeat(400), [
      { label: "Notes", text: "calf tight" },
    ]);
    expect(summary).toContain("Planned: 6 mi easy");
    expect(summary).toContain("Notes: calf tight");
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it("caps each note so the first cannot swallow the second", () => {
    // Notes and the coach's column are both configured, and the coach's comes
    // last. Uncapped, a long injury note consumes the remaining budget and the
    // feedback is cut off with nothing to say it was dropped.
    const summary = rowSummary("6 mi easy", "6.2 mi", [
      { label: "Notes", text: "n".repeat(400) },
      { label: "Comments from Coach", text: "great week" },
    ]);
    expect(summary).toContain("Comments from Coach: great week");
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it("stays inside the schema's limit even with every field long", () => {
    const summary = rowSummary("p".repeat(300), "a".repeat(300), [
      { label: "Notes", text: "n".repeat(300) },
      { label: "Comments from Coach", text: "c".repeat(300) },
    ]);
    expect(summary.length).toBeLessThanOrEqual(280);
  });

  it("omits a field that is empty rather than labelling nothing", () => {
    expect(rowSummary("6 mi easy", "", [])).toBe("Planned: 6 mi easy");
  });
});

describe("signalId", () => {
  it("is stable when the row's text changes", () => {
    // The guarantee the whole design rests on. merge() upserts by id, and this
    // sheet's rhythm is a row planned on Monday and completed on Wednesday.
    expect(signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0)).toBe(
      signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0),
    );
  });

  it("separates two sessions on the same day", () => {
    expect(signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0)).not.toBe(
      signalId(SPREADSHEET, "2026 Log", "2026-03-09", 1),
    );
  });

  it("separates the same date in different sheets and tabs", () => {
    expect(signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0)).not.toBe(
      signalId("other-spreadsheet-id-here", "2026 Log", "2026-03-09", 0),
    );
    expect(signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0)).not.toBe(
      signalId(SPREADSHEET, "2025 Log", "2026-03-09", 0),
    );
  });

  it("produces something the signal schema accepts", () => {
    expect(
      activitySignalSchema.shape.id.safeParse(
        signalId(SPREADSHEET, "2026 Log", "2026-03-09", 0),
      ).success,
    ).toBe(true);
  });
});

describe("GoogleSheetsAdapter", () => {
  it("makes no request at all when no spreadsheet is chosen", async () => {
    const { instance, http } = adapter({ spreadsheet_id: "" });
    expect(await instance.fetch(null, credential())).toEqual([]);
    expect(http.urls).toEqual([]);
  });

  it("refuses to read without a stored key", async () => {
    const { instance, http } = adapter();
    await expect(instance.fetch(null, "")).rejects.toThrow(/No Google service account key/);
    expect(http.urls).toEqual([]);
  });

  it("contacts only the two hosts the constitution names", async () => {
    const { instance, http } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""]]),
    ]);
    await instance.fetch(null, credential());
    expect(http.urls.map((url) => new URL(url).host)).toEqual([
      "oauth2.googleapis.com",
      "sheets.googleapis.com",
      "sheets.googleapis.com",
    ]);
  });

  it("sends an assertion and a range, never user content", async () => {
    const { instance, http } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""]]),
    ]);
    await instance.fetch(null, credential());
    expect(http.bodies[0]).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(http.bodies[0]).toContain("assertion=");
    expect(http.bodies).toHaveLength(1);
    expect(http.urls[2]).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(http.urls[2]).toContain("dateTimeRenderOption=SERIAL_NUMBER");
  });

  it("maps a completed row into a workout that was done", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [MARCH_9, "6 mi easy", "6.2 mi, felt strong", 6.2, 0, 3, 18.6, "calf tight", "nice"],
      ]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal).toMatchObject({
      integration_id: "google_sheets",
      kind: "workout",
      occurred_at: "2026-03-09",
      domain: "training",
      completed: true,
      metrics: { running_miles: 6.2, xtraining_miles: 0, rpe: 3, work_load: 18.6 },
    });
    expect(signal?.summary).toContain("Planned: 6 mi easy");
    expect(signal?.summary).toContain("Did: 6.2 mi, felt strong");
    expect(signal?.summary).toContain("calf tight");
  });

  it("records a prescribed session that was not done as not done", async () => {
    // The reason this source exists. Strava has no record of a run that was
    // planned and skipped; this row is that record.
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "10 mi long run", "", "", "", "", "", "", ""]]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal?.completed).toBe(false);
    expect(signal?.summary).toBe("Planned: 10 mi long run");
  });

  it("emits signals the domain schema accepts", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "note", "coach"],
        [serialFor("2026-03-08"), "rest", "", "", "", "", "", "", ""],
      ]),
    ]);
    for (const signal of await instance.fetch(null, credential())) {
      expect(activitySignalSchema.safeParse(signal).success).toBe(true);
    }
  });

  it("skips the descriptive row under the headers", async () => {
    // first_data_row is 3 because the real sheet explains each column in row 2.
    // Read as data it produces one undated junk signal on every sync.
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""]]),
    ]);
    const signals = await instance.fetch(null, credential());
    expect(signals).toHaveLength(1);
    expect(instance.skips().undated).toBe(0);
  });

  it("leaves out a session that has not happened yet, and counts it", async () => {
    // completed:false on a future row would land in open_count and break
    // streak_days, turning next month's plan into a backlog of failures.
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
        [serialFor("2026-03-14"), "race: half marathon", "", "", "", "", "", "", ""],
      ]),
    ]);
    const signals = await instance.fetch(null, credential());
    expect(signals.map((signal) => signal.occurred_at)).toEqual(["2026-03-09"]);
    expect(instance.skips().future).toBe(1);
  });

  it("keeps today, which is not the future", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[serialFor("2026-03-10"), "6 mi easy", "6 mi done", 6, 0, 3, 18, "", ""]]),
    ]);
    expect(await instance.fetch(null, credential())).toHaveLength(1);
  });

  it("counts a row it cannot date instead of dropping it quietly", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
        ["week of the 9th", "cross training", "45 min bike", "", 12, 2, 24, "", ""],
      ]),
    ]);
    const signals = await instance.fetch(null, credential());
    expect(signals).toHaveLength(1);
    expect(instance.skips().undated).toBe(1);
  });

  it("fails loudly when no row has a readable date", async () => {
    // A misconfigured first_data_row reads headings as data. Reporting success
    // with zero records gives the user nothing to act on.
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        ["week one", "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
        ["week two", "8 mi", "8 mi", 8, 0, 3, 24, "", ""],
      ]),
    ]);
    await expect(instance.fetch(null, credential())).rejects.toThrow(
      /None of the 2 rows had a readable date/,
    );
  });

  it("ignores blank rows without counting them as failures", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
        [],
        ["", "", "", "", "", "", "", "", ""],
      ]),
    ]);
    const signals = await instance.fetch(null, credential());
    expect(signals).toHaveLength(1);
    expect(instance.skips()).toEqual({ undated: 0, future: 0, empty: 0 });
  });

  it("bounds a first sync to the lookback window", async () => {
    const { instance } = adapter({ lookback_days: 7 }, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [serialFor("2026-03-09"), "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
        [serialFor("2026-01-15"), "5 mi", "5 mi", 5, 0, 3, 15, "", ""],
      ]),
    ]);
    const signals = await instance.fetch(null, credential());
    expect(signals.map((signal) => signal.occurred_at)).toEqual(["2026-03-09"]);
  });

  it("re-reads the window rather than resuming after it", async () => {
    // Unlike every other adapter here. A row is written when the session is
    // planned and completed days later, so resuming from the last sync would
    // mean the "actual" column was never picked up.
    const { instance } = adapter({ lookback_days: 30 }, [
      tokenReply(),
      metaReply(),
      valuesReply([
        [serialFor("2026-03-02"), "8 mi", "8 mi, good", 8, 0, 3, 24, "", ""],
        [serialFor("2026-03-09"), "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""],
      ]),
    ]);
    const signals = await instance.fetch("2026-03-08", credential());
    expect(signals.map((signal) => signal.occurred_at)).toEqual([
      "2026-03-02",
      "2026-03-09",
    ]);
  });

  it("widens the window when the last sync reached further back", async () => {
    const { instance } = adapter({ lookback_days: 3 }, [
      tokenReply(),
      metaReply(),
      valuesReply([[serialFor("2026-03-01"), "8 mi", "8 mi", 8, 0, 3, 24, "", ""]]),
    ]);
    expect(await instance.fetch("2026-02-01", credential())).toHaveLength(1);
  });

  it("links to the row it read", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "", ""]]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal?.url).toBe(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET}/edit#gid=884411&range=A3`,
    );
  });

  it("reads numbers out of cells that carry units", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", "6.2 mi", "0", "3", "18.6", "", ""]]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal?.metrics).toEqual({
      running_miles: 6.2,
      xtraining_miles: 0,
      rpe: 3,
      work_load: 18.6,
    });
  });

  it("gives a row with numbers but no words a summary anyway", async () => {
    // activitySignalSchema requires at least one character, so an empty
    // summary would throw at the store rather than here.
    const { instance } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "", "", 6.2, 0, 3, 18.6, "", ""]]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal?.summary.length).toBeGreaterThan(0);
    expect(activitySignalSchema.safeParse(signal).success).toBe(true);
  });

  it("leaves out the note columns nobody configured", async () => {
    const { instance } = adapter({ note_columns: [] }, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi easy", "6.2 mi", 6.2, 0, 3, 18.6, "calf tight", "nice"]]),
    ]);
    const [signal] = await instance.fetch(null, credential());
    expect(signal?.summary).not.toContain("calf tight");
    expect(signal?.summary).not.toContain("nice");
  });

  it("quotes a tab name that contains spaces", async () => {
    const { instance, http } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi", "6 mi", 6, 0, 3, 18, "", ""]]),
    ]);
    await instance.fetch(null, credential());
    expect(decodeURIComponent(http.urls[2] ?? "")).toContain("'2026 Log'!A1:ZZ");
  });

  it("lists the tabs that exist when the configured one does not", async () => {
    const { instance } = adapter({ tab_name: "2025 Log" }, [
      tokenReply(),
      metaReply("2026 Log"),
    ]);
    await expect(instance.fetch(null, credential())).rejects.toThrow(
      /no tab named "2025 Log". It has: 2026 Log/,
    );
  });

  it("names the missing date column and lists what the sheet has", async () => {
    const { instance } = adapter({ date_column: "Day" }, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi", "6 mi", 6, 0, 3, 18, "", ""]]),
    ]);
    await expect(instance.fetch(null, credential())).rejects.toThrow(
      /No column named "Day".*Workout/s,
    );
  });

  it("reuses a live access token instead of minting one per sync", async () => {
    const { instance, http } = adapter({}, [
      tokenReply(),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi", "6 mi", 6, 0, 3, 18, "", ""]]),
      metaReply(),
      valuesReply([[MARCH_9, "6 mi", "6 mi", 6, 0, 3, 18, "", ""]]),
    ]);
    await instance.fetch(null, credential());
    await instance.fetch(null, credential());
    expect(http.urls.filter((url) => url.includes("oauth2.googleapis.com"))).toHaveLength(1);
  });

  it("carries a token rejection to the user", async () => {
    const { instance } = adapter({}, [
      {
        status: 400,
        body: { error: "invalid_grant", error_description: "Invalid JWT Signature." },
      },
    ]);
    await expect(instance.fetch(null, credential())).rejects.toThrow(/does not match/);
  });

  it("names the address to share the sheet with on a permission failure", async () => {
    // The overwhelmingly likely first failure, and the address is the one
    // piece of information that makes it fixable.
    const { instance } = adapter({}, [
      tokenReply(),
      {
        status: 403,
        body: {
          error: {
            code: 403,
            message: "The caller does not have permission",
            status: "PERMISSION_DENIED",
          },
        },
      },
    ]);
    await expect(instance.fetch(null, credential())).rejects.toThrow(
      new RegExp(ACCOUNT.client_email),
    );
  });

  it("raises a rate limit as its own type so the runner can back off", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      {
        status: 429,
        body: { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } },
      },
    ]);
    await expect(instance.fetch(null, credential())).rejects.toBeInstanceOf(
      GoogleSheetsRateLimitError,
    );
  });

  it("raises other refusals as auth errors", async () => {
    const { instance } = adapter({}, [
      tokenReply(),
      { status: 404, body: { error: { code: 404, status: "NOT_FOUND" } } },
    ]);
    await expect(instance.fetch(null, credential())).rejects.toBeInstanceOf(
      GoogleSheetsAuthError,
    );
  });

  it("never repeats the private key in a failure", async () => {
    const { instance } = adapter({}, [
      { status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } },
    ]);
    const message = await instance
      .fetch(null, credential())
      .then(() => "")
      .catch((error: unknown) => (error as Error).message);
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(privateKey.slice(40, 120));
  });
});

describe("explaining why Google refused", () => {
  it("blames the key when the signature is rejected", () => {
    expect(
      describeTokenRejection({
        error: "invalid_grant",
        error_description: "Invalid JWT Signature.",
      }),
    ).toMatch(/private key does not match/);
  });

  it("blames the clock, not the credential, on a timing rejection", () => {
    // Nothing about the credential is wrong here, and every other message
    // would send the user to replace a working key.
    expect(
      describeTokenRejection({
        error: "invalid_grant",
        error_description: "Invalid JWT: Token must be a short-lived token and in a reasonable timeframe",
      }),
    ).toMatch(/clock/);
  });

  it("says the account is gone when Google does not know it", () => {
    expect(
      describeTokenRejection({ error: "invalid_client", error_description: "not found" }),
    ).toMatch(/does not recognize that service account/);
  });

  it("admits it does not know rather than guessing", () => {
    expect(describeTokenRejection(null)).toMatch(/did not say why/);
  });

  it("separates a disabled API from an unshared sheet", () => {
    // Both are 403 with status PERMISSION_DENIED, and the fixes are in
    // different places entirely — one in the Cloud console, one in the sheet's
    // sharing dialog. Only ErrorInfo.reason tells them apart.
    expect(
      describeApiRejection(
        403,
        {
          error: {
            code: 403,
            message:
              "Google Sheets API has not been used in project 12345 before or it is disabled",
            status: "PERMISSION_DENIED",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "SERVICE_DISABLED",
                domain: "googleapis.com",
              },
            ],
          },
        },
        "reader@example.iam.gserviceaccount.com",
      ),
    ).toMatch(/not enabled for the project/);

    expect(
      describeApiRejection(
        403,
        { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
        "reader@example.iam.gserviceaccount.com",
      ),
    ).toMatch(/add reader@example.iam.gserviceaccount.com as a Viewer/);
  });

  it("does not blame the sharing when the token lacks the scope", () => {
    // The third 403. Telling someone to share a sheet they have already shared
    // is worse than saying nothing: re-sharing cannot add a scope to a token
    // issued without one, so the advice sends them round a loop that has no
    // exit. This is the Strava mistake in a different API.
    const message = describeApiRejection(
      403,
      {
        error: {
          code: 403,
          message: "Request had insufficient authentication scopes.",
          status: "PERMISSION_DENIED",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              domain: "googleapis.com",
            },
          ],
        },
      },
      "reader@example.iam.gserviceaccount.com",
    );

    expect(message).toMatch(/sharing is not the problem/);
    expect(message).not.toMatch(/press Share/);
  });

  it("finds ErrorInfo when it is not the first entry in details", () => {
    // details[] is heterogeneous — Help and LocalizedMessage sit beside
    // ErrorInfo and the order is not guaranteed. Reading details[0] blindly
    // yields no reason and falls back to reading the prose.
    //
    // So the prose here deliberately contradicts the reason. AIP-193 exists
    // precisely so clients stop parsing messages, and a message is free to
    // change wording in a way a regex was never written for; the
    // machine-readable field has to win whenever both are present.
    expect(
      describeApiRejection(
        403,
        {
          error: {
            status: "PERMISSION_DENIED",
            message:
              "Google Sheets API has not been used in project 12345 before or it is disabled",
            details: [
              {
                "@type": "type.googleapis.com/google.rpc.Help",
                links: [{ description: "Google developers console" }],
              },
              {
                "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              },
            ],
          },
        },
        "a@b.c",
      ),
    ).toMatch(/sharing is not the problem/);
  });

  it("names the spreadsheet it actually tried to open", () => {
    // Sharing one sheet and configuring another produces this exact 403, and
    // the user cannot see the difference without being told which ID was used.
    expect(
      describeApiRejection(
        403,
        { error: { status: "PERMISSION_DENIED" } },
        "reader@example.iam.gserviceaccount.com",
        "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd",
      ),
    ).toContain("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd");
  });

  it("still reads a disabled API that arrives without ErrorInfo", () => {
    // Older endpoints omit details[]. The prose fallback stays for those, but
    // only where there is no machine-readable reason to prefer.
    expect(
      describeApiRejection(
        403,
        {
          error: {
            message:
              "Google Sheets API has not been used in project 12345 before or it is disabled",
            status: "PERMISSION_DENIED",
          },
        },
        "a@b.c",
      ),
    ).toMatch(/not enabled for the project/);
  });

  it("points at the tab when the range will not parse", () => {
    expect(
      describeApiRejection(
        400,
        { error: { code: 400, message: "Unable to parse range: '2025 Log'!A1:ZZ" } },
        "reader@example.iam.gserviceaccount.com",
      ),
    ).toMatch(/tab does not exist/);
  });

  it("points at the ID on a 404", () => {
    expect(describeApiRejection(404, null, "reader@example.iam.gserviceaccount.com")).toMatch(
      /no spreadsheet with that ID/,
    );
  });

  it("falls back to a working description when the sheet is unshared and unnamed", () => {
    expect(
      describeApiRejection(
        403,
        { error: { status: "PERMISSION_DENIED" } },
        "",
      ),
    ).toMatch(/the service account's address/);
  });

  it("never tells the user to replace a credential the token endpoint just accepted", () => {
    // The regression that cost three rounds of live debugging on Strava: a 401
    // from the data endpoint printed advice about the stored credential, for a
    // credential that had been accepted seconds earlier.
    for (const status of [401, 403, 404, 429]) {
      expect(describeApiRejection(status, null, "reader@example.com")).not.toMatch(
        /paste .* JSON file again|create a new key/,
      );
    }
  });

  it("gives every failure a message of its own", () => {
    // Two unrelated causes reading identically is what sent the user round the
    // Strava loop twice. A collision here is a defect, so it is asserted.
    const messages = [
      describeTokenRejection({ error_description: "Invalid JWT Signature." }),
      describeTokenRejection({ error_description: "Token must be in a reasonable timeframe" }),
      describeTokenRejection({ error: "invalid_client", error_description: "not found" }),
      describeTokenRejection({ error: "invalid_scope" }),
      describeTokenRejection(null),
      describeApiRejection(
        403,
        {
          error: {
            status: "PERMISSION_DENIED",
            details: [{ reason: "SERVICE_DISABLED" }],
          },
        },
        "a@b.c",
      ),
      describeApiRejection(
        403,
        {
          error: {
            status: "PERMISSION_DENIED",
            details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
          },
        },
        "a@b.c",
      ),
      describeApiRejection(403, { error: { status: "PERMISSION_DENIED" } }, "a@b.c"),
      describeApiRejection(404, null, "a@b.c"),
      describeApiRejection(400, { error: { message: "Unable to parse range: x" } }, "a@b.c"),
      describeApiRejection(429, { error: { status: "RESOURCE_EXHAUSTED" } }, "a@b.c"),
      describeApiRejection(401, null, "a@b.c"),
      describeApiRejection(500, null, "a@b.c"),
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});
