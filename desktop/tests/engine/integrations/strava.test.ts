/**
 * Every payload here is invented: made-up activity IDs, made-up distances, a
 * made-up athlete. Nothing was recorded from a real Strava account
 * ([HC-NO-PRIVATE-DATA-COMMITS]), and no test in this file touches the network.
 */

import { describe, expect, it } from "vitest";

import {
  StravaActivitiesAdapter,
  StravaAuthError,
  StravaRateLimitError,
  activityMetrics,
  activitySummary,
  authorizationCodeFrom,
  authorizeUrl,
  describeApiRejection,
  describeTokenRejection,
  earliestStart,
  exchangeAuthorizationCode,
  grantedScopes,
  humanizeSport,
  type StravaTokenStore,
} from "../../../src/engine/integrations/strava";
import { stravaConfigSchema } from "../../../src/engine/integrations/policy";
import { localDate } from "../../../src/engine/integrations/rollup";
import { activitySignalSchema } from "../../../src/engine/domain";

const now = new Date("2026-03-10T09:00:00.000Z");
/** Passed as the adapter credential, exactly as the runner supplies it. */
const CLIENT_SECRET = "client-secret-value";

function config(overrides: Record<string, unknown> = {}) {
  return stravaConfigSchema.parse({
    client_id: "123456",
    default_domain: "running",
    ...overrides,
  });
}

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: 9_876_543_210,
    name: "Morning Run 🏃",
    sport_type: "TrailRun",
    distance: 21_097.5,
    moving_time: 8_040,
    elapsed_time: 8_400,
    total_elevation_gain: 612.4,
    average_heartrate: 148.2,
    max_heartrate: 172,
    start_date_local: "2026-03-09T06:12:00Z",
    start_date: "2026-03-09T13:12:00Z",
    ...overrides,
  };
}

/** A token endpoint reply. `expires_at` is epoch seconds, as Strava sends it. */
function tokenBody(overrides: Record<string, unknown> = {}) {
  return {
    token_type: "Bearer",
    access_token: "access-aaaa",
    refresh_token: "refresh-original",
    expires_at: Math.floor(now.getTime() / 1000) + 21_600,
    expires_in: 21_600,
    ...overrides,
  };
}

/** Records every request so the tests can assert on what was actually sent. */
function recorder(
  replies: { status?: number; body?: unknown; headers?: Record<string, string> }[],
  log: string[] = [],
) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const bodies: string[] = [];
  let call = 0;
  const httpFetch = ((url: string, init?: RequestInit) => {
    urls.push(url);
    log.push(url.includes("/oauth/token") ? "token-request" : "activities-request");
    headers.push((init?.headers ?? {}) as Record<string, string>);
    bodies.push(String(init?.body ?? ""));
    const reply = replies[Math.min(call, replies.length - 1)] ?? {};
    call += 1;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? []), {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  }) as unknown as typeof fetch;
  return { httpFetch, urls, headers, bodies, log, calls: () => call };
}

/**
 * An in-memory `SecretStore` stand-in that remembers what was written.
 *
 * `null` rather than `undefined` for "nothing stored", because passing
 * `undefined` explicitly still triggers a default parameter — which silently
 * gave a token to the test asserting there was none.
 *
 * Writes land in the same `log` as the requests, so a test can assert *when*
 * the rotation was persisted and not merely that it eventually was.
 */
function tokenStore(initial: string | null = "refresh-original", log: string[] = []) {
  let stored = initial ?? undefined;
  const saved: string[] = [];
  const store: StravaTokenStore = {
    read: () => Promise.resolve(stored),
    save: (next) => {
      stored = next;
      saved.push(next);
      log.push("token-save");
      return Promise.resolve();
    },
  };
  return { store, saved, log, current: () => stored };
}

describe("activitySummary", () => {
  it("describes the activity without using the user's title", () => {
    const summary = activitySummary(activity());
    expect(summary).toBe("Trail run — 21.1 km in 2h 14m");
    // The title is a joke, a place name, or an emoji. It is not training
    // signal, and it is a free-text field where a pasted secret would land.
    expect(summary).not.toContain("Morning Run");
  });

  it("falls back to duration when the activity covers no distance", () => {
    expect(
      activitySummary(
        activity({ sport_type: "WeightTraining", distance: 0, moving_time: 2_700 }),
      ),
    ).toBe("Weight training — 45m");
  });

  it("stays within the summary length the schema allows", () => {
    const summary = activitySummary(activity({ sport_type: "A".repeat(600) }));
    expect(summary.length).toBeLessThanOrEqual(280);
  });
});

describe("humanizeSport", () => {
  it("turns Strava's identifiers into something a mentor can read back", () => {
    expect(humanizeSport("TrailRun")).toBe("Trail run");
    expect(humanizeSport("VirtualRide")).toBe("Virtual ride");
    expect(humanizeSport("")).toBe("Workout");
  });
});

describe("activityMetrics", () => {
  it("keeps the numbers a mentor can reason about", () => {
    expect(activityMetrics(activity())).toEqual({
      distance_m: 21_097.5,
      moving_time_s: 8_040,
      elapsed_time_s: 8_400,
      elevation_gain_m: 612.4,
      average_heartrate: 148.2,
      max_heartrate: 172,
    });
  });

  it("omits a metric the activity does not carry", () => {
    const metrics = activityMetrics(
      activity({ average_heartrate: undefined, max_heartrate: undefined }),
    );
    expect(metrics).not.toHaveProperty("average_heartrate");
    expect(metrics).not.toHaveProperty("max_heartrate");
    expect(metrics["distance_m"]).toBe(21_097.5);
  });
});

describe("earliestStart", () => {
  it("resumes from the last sync rather than the lookback horizon", () => {
    const resumed = earliestStart("2026-03-01", 30, now);
    expect(resumed).toBe(Math.floor(new Date("2026-03-01T00:00:00").getTime() / 1000));
  });

  it("uses the local calendar horizon on a first sync", () => {
    const first = earliestStart(null, 7, now);
    expect(first).toBe(
      Math.floor(new Date("2026-03-03T00:00:00").getTime() / 1000),
    );
  });

  it("derives the horizon from the local calendar, not UTC", () => {
    // An evening after UTC has rolled over but the user's day has not. Slicing
    // `toISOString` here names tomorrow, so the window starts a day late — and
    // this is exactly the hour someone sits down to review their day. The same
    // derivation bug has now appeared four times in this codebase.
    const evening = new Date("2026-07-30T02:00:00.000Z");
    const expectedDay = localDate(new Date(evening.getTime() - 7 * 86_400_000));
    const utcDay = new Date(evening.getTime() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    expect(earliestStart(null, 7, evening)).toBe(
      Math.floor(new Date(`${expectedDay}T00:00:00`).getTime() / 1000),
    );
    // Only meaningful where the two actually disagree; on a UTC machine this
    // says so rather than passing silently for the wrong reason.
    expect(expectedDay).not.toBe(utcDay);
  });
});

describe("StravaActivitiesAdapter", () => {
  it("declares www.strava.com as its exhaustive host list", () => {
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
    );
    expect(adapter.hosts).toEqual(["www.strava.com"]);
    expect(adapter.requiresCredential).toBe(true);
  });

  it("maps an activity to a signal the schema accepts", async () => {
    const http = recorder([
      { body: tokenBody() },
      { body: [activity()] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);

    expect(signals).toHaveLength(1);
    const signal = activitySignalSchema.parse(signals[0]);
    expect(signal.id).toBe("strava_9876543210");
    expect(signal.kind).toBe("workout");
    expect(signal.domain).toBe("running");
    expect(signal.occurred_at).toBe("2026-03-09");
    // A recorded activity is a thing that happened. Strava has no record of a
    // run that was planned and skipped, so there is no open state to represent.
    expect(signal.completed).toBe(true);
    expect(signal.url).toBe("https://www.strava.com/activities/9876543210");
  });

  it("omits GPS and polyline data entirely", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        body: [
          activity({
            map: {
              id: "a9876543210",
              summary_polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
              polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
            },
            start_latlng: [39.7392, -104.9903],
            end_latlng: [39.7401, -104.9887],
            location_city: "Denver",
          }),
        ],
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);

    // Route geometry says where the athlete lives and when they are away from
    // home. Assert on the whole serialized signal rather than named fields, so
    // a future change that widens the mapping cannot slip coordinates through.
    const serialized = JSON.stringify(signals);
    expect(serialized).not.toContain("polyline");
    expect(serialized).not.toContain("39.7392");
    expect(serialized).not.toContain("104.99");
    expect(serialized).not.toContain("Denver");
  });

  it("persists a rotated refresh token", async () => {
    const tokens = tokenStore("refresh-original");
    const http = recorder([
      { body: tokenBody({ refresh_token: "refresh-rotated" }) },
      { body: [activity()] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokens.store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch(null, CLIENT_SECRET);

    // Strava invalidates the previous refresh token the instant it issues a
    // replacement. Dropping the new one leaves a dead credential and no event
    // to point at weeks later.
    expect(tokens.saved).toEqual(["refresh-rotated"]);
    expect(tokens.current()).toBe("refresh-rotated");
  });

  it("does not rewrite the refresh token when it did not change", async () => {
    const tokens = tokenStore("refresh-original");
    const http = recorder([
      { body: tokenBody({ refresh_token: "refresh-original" }) },
      { body: [activity()] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokens.store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch(null, CLIENT_SECRET);

    expect(tokens.saved).toEqual([]);
  });

  it("persists a rotated token before it issues the activity request", async () => {
    const log: string[] = [];
    const tokens = tokenStore("refresh-original", log);
    const http = recorder(
      [
        { body: tokenBody({ refresh_token: "refresh-rotated" }) },
        { status: 500, body: {} },
      ],
      log,
    );
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokens.store,
      http.httpFetch,
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toThrow(
      "Strava replied 500",
    );

    // Ordering, not just eventual arrival. The rotation has already happened on
    // Strava's side by the time the token response is read, so anything that
    // defers the write past a request that can fail leaves the integration
    // holding a credential Strava has already invalidated.
    expect(log).toEqual(["token-request", "token-save", "activities-request"]);
    expect(tokens.current()).toBe("refresh-rotated");
  });

  it("exchanges the refresh token without sending any user content", async () => {
    const http = recorder([{ body: tokenBody() }, { body: [] }]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch(null, CLIENT_SECRET);

    // [HC-NO-EXFILTRATION] names this POST as its single exception: it carries
    // client credentials and a refresh token, and nothing else.
    expect(http.urls[0]).toBe("https://www.strava.com/oauth/token");
    const sent = new URLSearchParams(http.bodies[0] ?? "");
    expect([...sent.keys()].sort()).toEqual([
      "client_id",
      "client_secret",
      "grant_type",
      "refresh_token",
    ]);
    expect(sent.get("grant_type")).toBe("refresh_token");
  });

  it("reuses a cached access token instead of refreshing on every sync", async () => {
    const http = recorder([
      { body: tokenBody() },
      { body: [] },
      { body: [] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch(null, CLIENT_SECRET);
    await adapter.fetch(null, CLIENT_SECRET);

    const tokenCalls = http.urls.filter((url) =>
      url.startsWith("https://www.strava.com/oauth/token"),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("refreshes an expired access token before fetching", async () => {
    const http = recorder([
      { body: tokenBody({ expires_at: Math.floor(now.getTime() / 1000) + 10 }) },
      { body: [] },
      { body: tokenBody({ access_token: "access-bbbb" }) },
      { body: [] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch(null, CLIENT_SECRET);
    await adapter.fetch(null, CLIENT_SECRET);

    const tokenCalls = http.urls.filter((url) =>
      url.startsWith("https://www.strava.com/oauth/token"),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it("fetches incrementally using the last synced day", async () => {
    const http = recorder([{ body: tokenBody() }, { body: [] }]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await adapter.fetch("2026-03-08", CLIENT_SECRET);

    const after = new URL(http.urls[1] ?? "").searchParams.get("after");
    expect(after).toBe(
      String(Math.floor(new Date("2026-03-08T00:00:00").getTime() / 1000)),
    );
  });

  it("paginates a multi-page history", async () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      activity({ id: 1_000_000 + index }),
    );
    const http = recorder([
      { body: tokenBody() },
      { body: full },
      { body: [activity({ id: 2_000_001 })] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);

    expect(signals).toHaveLength(201);
    expect(new URL(http.urls[1] ?? "").searchParams.get("page")).toBe("1");
    expect(new URL(http.urls[2] ?? "").searchParams.get("page")).toBe("2");
  });

  it("gives every activity its own signal id", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        body: [
          activity({ id: 14_000_000_000_001 }),
          activity({ id: 14_000_000_000_002 }),
          activity({ id: 14_000_000_000_003 }),
        ],
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);

    // Strava IDs are sequential, so a day of activity shares a long leading
    // run. Truncating one is what collapsed a page of Notion checkboxes into a
    // single stored record.
    expect(new Set(signals.map((signal) => signal.id)).size).toBe(3);
  });

  it("makes no request at all until an application ID is configured", async () => {
    const http = recorder([{ body: tokenBody() }]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config({ client_id: "" })),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    expect(await adapter.fetch(null, CLIENT_SECRET)).toEqual([]);
    expect(http.calls()).toBe(0);
  });

  it("asks for a refresh token instead of calling with none", async () => {
    const http = recorder([{ body: tokenBody() }]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore(null).store,
      http.httpFetch,
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toBeInstanceOf(StravaAuthError);
    expect(http.calls()).toBe(0);
  });

  it("reports a rejected authorization without leaking the credential", async () => {
    const http = recorder([{ status: 400, body: { message: "Bad Request" } }]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore("refresh-secret-value").store,
      http.httpFetch,
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toThrow(
      /one of the three/,
    );
    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.not.toThrow(
      /refresh-secret-value|client-secret-value/,
    );
  });

  it("reports a 401 on the activity request without leaking the token", async () => {
    const http = recorder([
      { body: tokenBody({ access_token: "access-secret-value" }) },
      { status: 401, body: {} },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const error = await adapter.fetch(null, CLIENT_SECRET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StravaAuthError);
    expect(String(error)).not.toContain("access-secret-value");
  });

  it("backs off on a rate-limit response and names which budget ran out", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        status: 429,
        body: {},
        headers: {
          "x-ratelimit-limit": "200,2000",
          "x-ratelimit-usage": "12,2000",
        },
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const error = await adapter.fetch(null, CLIENT_SECRET).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StravaRateLimitError);
    // Naming the window is the difference between waiting a quarter of an hour
    // and waiting until midnight.
    expect(String(error)).toContain("daily budget");
  });

  it("names the short window when only the 15-minute budget is spent", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        status: 429,
        body: {},
        headers: {
          "x-ratelimit-limit": "200,2000",
          "x-ratelimit-usage": "200,412",
        },
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toThrow(/15-minute budget/);
  });

  it("skips an activity with no usable start date rather than dating it wrongly", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        body: [
          activity({ id: 1, start_date_local: undefined, start_date: undefined }),
          activity({ id: 2 }),
        ],
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);
    expect(signals.map((signal) => signal.id)).toEqual(["strava_2"]);
  });

  it("files workouts under the configured goal domain", async () => {
    const http = recorder([
      { body: tokenBody() },
      { body: [activity()] },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config({ default_domain: "Ultra Training!" })),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    const signals = await adapter.fetch(null, CLIENT_SECRET);
    expect(signals[0]?.domain).toBe("ultra-training");
  });
});

describe("saying which credential Strava rejected", () => {
  // Strava returns `{ message, errors: [{ resource, field, code }] }`. The
  // field names an input, never its value, so it is safe to repeat and it is
  // the only thing that distinguishes a mistyped secret from a dead token.
  it("names the application credentials when the client is wrong", () => {
    const message = describeTokenRejection({
      message: "Bad Request",
      errors: [
        { resource: "Application", field: "client_id", code: "invalid" },
      ],
    });
    expect(message).toContain("Client ID");
    expect(message).not.toContain("refresh token");
  });

  it("names the application credentials when the field is blank", () => {
    // The exact body the live endpoint returns for a real client_id with the
    // wrong secret, which is the most common way to get this wrong. A first
    // version of this parser matched on `field` alone, and `field` is empty
    // here — so the single most likely failure fell through to a fallback that
    // told the user to go and replace a refresh token that was fine.
    const message = describeTokenRejection({
      message: "Authorization Error",
      errors: [{ resource: "Application", field: "", code: "invalid" }],
    });
    expect(message).toContain("client secret");
    expect(message).not.toContain("one of the three");
  });

  it("names the refresh token when that is what died", () => {
    // The common failure: something else sharing the API application refreshed
    // and Strava invalidated this copy.
    const message = describeTokenRejection({
      message: "Bad Request",
      errors: [
        { resource: "RefreshToken", field: "refresh_token", code: "invalid" },
      ],
    });
    expect(message).toContain("rotated or revoked");
    // Ranked ahead of the Application branch: a rotated token is reported with
    // resource RefreshToken, and matching Application first would swallow it.
    expect(message).not.toContain("client secret");
    expect(message).toContain("activity:read_all");
  });

  it("falls back to naming all three credentials when Strava says nothing useful", () => {
    for (const body of [null, {}, { errors: [] }, "not json"]) {
      expect(describeTokenRejection(body)).toContain("one of the three");
    }
  });

  it("words every failure differently so the message identifies the cause", async () => {
    // The bug this exists to prevent, and it cost a live debugging round: the
    // fallback here was byte-identical to the 401 thrown by the activity
    // request. Two unrelated failures with different fixes produced the same
    // sentence, so reading it could not tell you which had happened — and the
    // advice it gave was wrong for one of them.
    const messages: string[] = [
      describeTokenRejection({ errors: [{ resource: "Application", field: "" }] }),
      describeTokenRejection({ errors: [{ field: "refresh_token" }] }),
      describeTokenRejection(null),
    ];

    const activity401 = recorder([
      { body: tokenBody() },
      { status: 401, body: {} },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      activity401.httpFetch,
      () => now,
    );
    await adapter.fetch(null, CLIENT_SECRET).catch((error: unknown) => {
      messages.push((error as Error).message);
    });

    expect(messages).toHaveLength(4);
    expect(new Set(messages).size).toBe(4);
    // And the one that is not about a stored credential must not tell the user
    // to go and replace one.
    expect(messages[3]).toContain("reading activities");
  });

  it("never repeats a credential value back to the user", () => {
    // The field name is an input's name. Its value must never make the trip,
    // however Strava chose to echo it. [HC-SECRETS-ENV-ONLY]
    const message = describeTokenRejection({
      errors: [
        {
          resource: "RefreshToken",
          field: "refresh_token",
          code: "invalid",
          value: "s3cr3t-token-value",
        },
      ],
    });
    expect(message).not.toContain("s3cr3t-token-value");
  });

  it("surfaces the rejection detail through a real refresh", async () => {
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message: "Authorization Error",
              errors: [{ resource: "Application", field: "", code: "invalid" }],
            }),
            { status: 400 },
          ),
        ),
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toThrow(
      "strava.com/settings/api",
    );
  });
});

describe("explaining a rejection from the activity endpoint", () => {
  // A 401 here is not a 401 at the token endpoint. The credentials were just
  // accepted, so telling the user to replace them is wrong — and that is the
  // advice a status-code-only reading produces.
  it("says a missing scope cannot be fixed by refreshing", () => {
    const message = describeApiRejection(
      401,
      {
        message: "Authorization Error",
        errors: [
          {
            resource: "AccessToken",
            field: "activity:read_permission",
            code: "missing",
          },
        ],
      },
      "reading activities",
    );
    expect(message).toContain("missing a permission");
    expect(message).toContain("refreshing cannot add a scope");
  });

  it("points at an application mismatch when the token itself is refused", () => {
    // The shape the live endpoint returns for a bearer it does not recognize.
    const message = describeApiRejection(
      401,
      {
        message: "Authorization Error",
        errors: [
          { resource: "Athlete", field: "access_token", code: "invalid" },
        ],
      },
      "reading activities",
    );
    expect(message).toContain("different application");
    expect(message).not.toContain("missing a permission");
  });

  it("admits it does not know rather than guessing a cause", () => {
    const message = describeApiRejection(401, null, "reading activities");
    expect(message).toContain("did not say why");
  });

  it("never tells the user to replace a credential that was just accepted", () => {
    // The regression that cost a live debugging round: every 401 from this
    // endpoint said "store the new refresh token in Settings", for a token the
    // token endpoint had accepted seconds earlier.
    for (const body of [
      { errors: [{ resource: "Athlete", field: "access_token" }] },
      null,
    ]) {
      expect(describeApiRejection(401, body, "reading activities")).not.toMatch(
        /store the new refresh token/,
      );
    }
  });

  it("carries the rejection through a real fetch", async () => {
    const http = recorder([
      { body: tokenBody() },
      {
        status: 401,
        body: {
          errors: [{ field: "activity:read_permission", code: "missing" }],
        },
      },
    ]);
    const adapter = new StravaActivitiesAdapter(
      () => Promise.resolve(config()),
      tokenStore().store,
      http.httpFetch,
      () => now,
    );

    await expect(adapter.fetch(null, CLIENT_SECRET)).rejects.toThrow(
      /missing a permission/,
    );
  });
});

describe("getting a refresh token that can read activities", () => {
  it("asks for activity:read_all, because the settings-page token cannot", () => {
    // The whole reason this helper exists. Strava's API settings page hands
    // out a refresh token with `read` scope, which authenticates perfectly and
    // then cannot list a single activity.
    const url = new URL(authorizeUrl("169093"));
    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("activity:read_all");
    expect(url.searchParams.get("client_id")).toBe("169093");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("forces the consent screen so a wrong existing grant is replaced", () => {
    // Without this Strava silently reuses the authorization already on file —
    // including the `read`-only one the user is trying to escape, which would
    // make the fix appear to do nothing.
    expect(
      new URL(authorizeUrl("169093")).searchParams.get("approval_prompt"),
    ).toBe("force");
  });

  it("points the redirect somewhere that needs no listener", () => {
    // localhost is a whitelisted redirect target and the page failing to load
    // is the expected outcome: the code is read out of the address bar. This
    // is why the integration needs no loopback server.
    expect(new URL(authorizeUrl("1")).searchParams.get("redirect_uri")).toBe(
      "http://localhost/exchange_token",
    );
  });

  it("takes the code out of a pasted address bar", () => {
    expect(
      authorizationCodeFrom(
        "http://localhost/exchange_token?state=&code=abc123def&scope=read,activity:read_all",
      ),
    ).toBe("abc123def");
  });

  it("accepts a bare code, because people paste that too", () => {
    expect(authorizationCodeFrom("  abc123def  ")).toBe("abc123def");
  });

  it("refuses a URL that carries no code rather than sending it as one", () => {
    // A paste that should have carried a code and did not is a mistake worth
    // reporting. Forwarding the whole URL to Strava as a code would produce a
    // rejection that blames the credential instead.
    expect(authorizationCodeFrom("http://localhost/exchange_token?error=access_denied")).toBe("");
    expect(authorizationCodeFrom("")).toBe("");
  });

  it("exchanges a code for a refresh token", async () => {
    const log: string[] = [];
    const refreshToken = await exchangeAuthorizationCode(
      "169093",
      CLIENT_SECRET,
      "abc123def",
      (url, init) => {
        log.push(String(url));
        log.push(String((init as RequestInit).body));
        return Promise.resolve(
          new Response(
            JSON.stringify({ refresh_token: "minted-token", access_token: "a" }),
          ),
        );
      },
    );

    expect(refreshToken).toBe("minted-token");
    expect(log[0]).toBe("https://www.strava.com/oauth/token");
    expect(log[1]).toContain("grant_type=authorization_code");
    expect(log[1]).toContain("code=abc123def");
  });

  it("explains a rejected exchange without echoing the secret", async () => {
    await expect(
      exchangeAuthorizationCode("169093", CLIENT_SECRET, "abc", () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              errors: [{ resource: "Application", field: "", code: "invalid" }],
            }),
            { status: 401 },
          ),
        ),
      ),
    ).rejects.toThrow(/client secret/);

    await expect(
      exchangeAuthorizationCode("169093", CLIENT_SECRET, "abc", () =>
        Promise.resolve(new Response("{}", { status: 401 })),
      ),
    ).rejects.not.toThrow(new RegExp(CLIENT_SECRET));
  });

  it("refuses to call Strava at all when there is no code", async () => {
    let called = false;
    await expect(
      exchangeAuthorizationCode("169093", CLIENT_SECRET, "", () => {
        called = true;
        return Promise.resolve(new Response("{}"));
      }),
    ).rejects.toThrow(/authorization code/);
    expect(called).toBe(false);
  });
});

describe("checking the scope the athlete actually granted", () => {
  // Strava draws every requested scope as a tickable box and returns whatever
  // survived. An unticked box still yields a code, a successful exchange and a
  // genuine refresh token that cannot read one workout.
  it("reads the granted scopes out of the redirect", () => {
    expect(
      grantedScopes(
        "http://localhost/exchange_token?state=&code=abc&scope=read,activity:read_all",
      ),
    ).toEqual(["read", "activity:read_all"]);
  });

  it("survives the scopes arriving percent-encoded", () => {
    expect(
      grantedScopes("http://localhost/exchange_token?code=abc&scope=read%2Cactivity%3Aread_all"),
    ).toEqual(["read", "activity:read_all"]);
  });

  it("separates a paste that cannot answer from one that says nothing was granted", () => {
    // null means "no scope list here, ask the token endpoint instead". An empty
    // list means Strava said nothing was granted. Collapsing the two would make
    // a bare code look like a refusal.
    expect(grantedScopes("abc123def")).toBeNull();
    expect(grantedScopes("http://localhost/exchange_token?code=abc&scope=")).toEqual([]);
  });

  it("refuses a redirect that withheld activity access, without calling Strava", async () => {
    // The failure this whole gate exists for. Exchanging would succeed and
    // store a token guaranteed to 401 on the next sync.
    let called = false;
    await expect(
      exchangeAuthorizationCode(
        "169093",
        CLIENT_SECRET,
        "http://localhost/exchange_token?state=&code=abc123def&scope=read",
        () => {
          called = true;
          return Promise.resolve(new Response("{}"));
        },
      ),
    ).rejects.toThrow(/not to your activities/);
    expect(called).toBe(false);
  });

  it("names the box that has to stay ticked", async () => {
    // "Grant the right scope" is not actionable while looking at Strava's page.
    // The label is.
    await expect(
      exchangeAuthorizationCode(
        "169093",
        CLIENT_SECRET,
        "http://localhost/exchange_token?code=abc&scope=read",
        () => Promise.resolve(new Response("{}")),
      ),
    ).rejects.toThrow(/View data about your private activities/);
  });

  it("exchanges normally when the activity scope survived", async () => {
    const refreshToken = await exchangeAuthorizationCode(
      "169093",
      CLIENT_SECRET,
      "http://localhost/exchange_token?state=&code=abc123def&scope=read,activity:read_all",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              refresh_token: "minted-token",
              scope: "read activity:read_all",
            }),
          ),
        ),
    );
    expect(refreshToken).toBe("minted-token");
  });

  it("still refuses when only the token response reveals the missing scope", async () => {
    // A bare-code paste carries no scope list, so the response is the only
    // place the truth appears.
    await expect(
      exchangeAuthorizationCode("169093", CLIENT_SECRET, "abc123def", () =>
        Promise.resolve(
          new Response(JSON.stringify({ refresh_token: "minted-token", scope: "read" })),
        ),
      ),
    ).rejects.toThrow(/not to your activities/);
  });

  it("reports a declined authorization as declined, not as a bad paste", async () => {
    await expect(
      exchangeAuthorizationCode(
        "169093",
        CLIENT_SECRET,
        "http://localhost/exchange_token?state=&error=access_denied",
        () => Promise.resolve(new Response("{}")),
      ),
    ).rejects.toThrow(/declined/);
  });

  it("does not read like the sync-time missing-permission failure", async () => {
    // Two different moments with two different fixes: one is "tick the box on
    // the page in front of you", the other is "the stored grant is wrong".
    // Identical wording is what sent the user round the loop twice already.
    const atConsent = await exchangeAuthorizationCode(
      "169093",
      CLIENT_SECRET,
      "http://localhost/exchange_token?code=abc&scope=read",
      () => Promise.resolve(new Response("{}")),
    ).catch((error: unknown) => (error as Error).message);
    const atSync = describeApiRejection(
      401,
      { errors: [{ resource: "AccessToken", field: "activity:read_permission", code: "missing" }] },
      "reading activities",
    );
    expect(atConsent).not.toBe(atSync);
  });
});
