/**
 * Every payload here is invented: fake SHAs, fake repositories, a fake login.
 * Nothing was recorded from a real account ([HC-NO-PRIVATE-DATA-COMMITS]), and
 * no test in this file touches the network.
 */

import { describe, expect, it } from "vitest";

import {
  GitHubCommitsAdapter,
  GitHubRateLimitError,
  domainFor,
  firstLine,
  scopeQualifiers,
  slugifyDomain,
} from "../../../src/engine/integrations/github";
import { githubConfigSchema } from "../../../src/engine/integrations/policy";

const now = new Date("2026-03-10T09:00:00.000Z");

function config(overrides: Record<string, unknown> = {}) {
  return githubConfigSchema.parse({
    login: "sample-user",
    repositories: ["octo-sample/api-service"],
    domains: { "octo-sample/api-service": "career" },
    ...overrides,
  });
}

function searchItem(overrides: Record<string, unknown> = {}) {
  return {
    sha: "A1B2C3D4E5F60718293A4B5C6D7E8F9012345678",
    html_url: "https://github.com/octo-sample/api-service/commit/a1b2c3d",
    commit: {
      message: "Add retry handling to the importer",
      committer: { date: "2026-03-09T18:22:11Z" },
    },
    repository: { full_name: "octo-sample/api-service" },
    ...overrides,
  };
}

/** Records every request so the tests can assert on what was actually sent. */
function recorder(
  handler: (url: string) => { status?: number; body?: unknown; headers?: Record<string, string> },
) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const httpFetch = ((url: string, init?: RequestInit) => {
    urls.push(url);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    const reply = handler(url);
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? { items: [] }), {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  }) as unknown as typeof fetch;
  return { urls, headers, httpFetch };
}

/** Search returns the items; the per-commit stats call returns line counts. */
function searchAndStats(items: unknown[]) {
  return recorder((url) =>
    url.includes("/search/commits")
      ? { body: { items } }
      : { body: { stats: { additions: 120, deletions: 40 }, files: [1, 2, 3] } },
  );
}

/**
 * Assert that a call rejected, and hand back the error.
 *
 * A bare `.catch()` would let a call that unexpectedly *succeeded* slip through
 * as a passing test.
 */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to fail, but it resolved.");
}

/** The `q` parameter only — `sort=committer-date` lives outside it. */
function searchQuery(url: string): string {
  return new URL(url).searchParams.get("q") ?? "";
}

function adapter(
  http: { httpFetch: typeof fetch },
  overrides: Record<string, unknown> = {},
) {
  return new GitHubCommitsAdapter(
    () => Promise.resolve(config(overrides)),
    http.httpFetch,
    () => now,
  );
}

describe("GitHub commit mapping", () => {
  it("maps a commit to a signal", async () => {
    const http = searchAndStats([searchItem()]);
    const signals = await adapter(http).fetch(null, "token-value");

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      id: "github_a1b2c3d4e5f6",
      integration_id: "github",
      kind: "code_commit",
      occurred_at: "2026-03-09",
      summary: "Add retry handling to the importer",
      domain: "career",
      url: "https://github.com/octo-sample/api-service/commit/a1b2c3d",
      metrics: { additions: 120, deletions: 40, files: 3 },
    });
    expect(signals[0]?.provenance.adapter_version).toBe("github-1");
  });

  it("applies the repository-to-domain map", async () => {
    const http = searchAndStats([
      searchItem(),
      searchItem({
        sha: "ffff0000111122223333444455556666777788",
        repository: { full_name: "sample-user/side-quest" },
      }),
    ]);
    const signals = await adapter(http, {
      repositories: ["octo-sample/api-service", "sample-user/side-quest"],
      domains: {
        "octo-sample/api-service": "career",
        "sample-user/side-quest": "projects",
      },
    }).fetch(null, "token-value");

    // Without this map every commit lands in one bucket and the mentor cannot
    // tell you which goal is actually getting your attention.
    expect(signals.map((signal) => signal.domain)).toEqual(["career", "projects"]);
  });

  it("falls back to a slug of the repository when it is unmapped", async () => {
    const http = searchAndStats([
      searchItem({ repository: { full_name: "Octo-Sample/API.Service" } }),
    ]);
    const signals = await adapter(http, { domains: {} }).fetch(null, "token-value");
    // `domain` must satisfy the identifier rule, so the raw name cannot be used.
    expect(signals[0]?.domain).toBe("api-service");
  });

  it("truncates to the first line of the message", async () => {
    const http = searchAndStats([
      searchItem({
        commit: {
          message:
            "Fix the retry backoff\n\nRefs INTERNAL-4821\nToken: sample-not-a-real-secret",
          committer: { date: "2026-03-09T18:22:11Z" },
        },
      }),
    ]);
    const signals = await adapter(http).fetch(null, "token-value");

    // Bodies carry issue links, internal identifiers, and occasionally pasted
    // secrets. None of it should reach storage or a prompt.
    expect(signals[0]?.summary).toBe("Fix the retry backoff");
    expect(JSON.stringify(signals)).not.toContain("INTERNAL-4821");
    expect(JSON.stringify(signals)).not.toContain("sample-not-a-real-secret");
  });

  it("keeps the summary inside the schema's length limit", () => {
    expect(firstLine("x".repeat(400)).length).toBeLessThanOrEqual(280);
  });
});

describe("GitHub request construction", () => {
  it("fetches incrementally from the last sync", async () => {
    const http = searchAndStats([searchItem()]);
    await adapter(http).fetch("2026-03-01", "token-value");

    const query = searchQuery(http.urls[0] ?? "");
    expect(query).toContain("committer-date:>=2026-03-01");
    expect(query).toContain("author:sample-user");
    expect(query).toContain("repo:octo-sample/api-service");
  });

  it("bounds a first sync to the lookback window", async () => {
    const http = searchAndStats([searchItem()]);
    await adapter(http).fetch(null, "token-value");

    // Seven days before the fixed clock of 2026-03-10. Unbounded, this would
    // reach across all of history for work long since finished.
    expect(searchQuery(http.urls[0] ?? "")).toContain(
      "committer-date:>=2026-03-03",
    );
  });

  it("keeps a later sync incremental even past the lookback window", async () => {
    const http = searchAndStats([searchItem()]);
    // Older than the seven-day horizon, so clamping to the horizon here would
    // skip everything between and lose it permanently.
    await adapter(http).fetch("2026-02-01", "token-value");

    expect(searchQuery(http.urls[0] ?? "")).toContain(
      "committer-date:>=2026-02-01",
    );
  });

  it("searches without a repository qualifier once all repositories are opted in", async () => {
    const http = searchAndStats([searchItem()]);
    const signals = await adapter(http, {
      repositories: [],
      organizations: [],
      all_repositories: true,
    }).fetch(null, "token-value");

    const query = searchQuery(http.urls[0] ?? "");
    expect(query).toContain("author:sample-user");
    expect(query).not.toContain("repo:");
    expect(query).not.toContain("org:");
    expect(signals).toHaveLength(1);
  });

  it("fetches nothing when no repository is in scope", async () => {
    const http = searchAndStats([searchItem()]);
    const signals = await adapter(http, {
      repositories: [],
      organizations: [],
    }).fetch(null, "token-value");

    // Empty scope means no request at all. Searching everything the token can
    // reach would be a privacy decision made on the user's behalf.
    expect(signals).toEqual([]);
    expect(http.urls).toEqual([]);
  });

  it("contacts only api.github.com", async () => {
    const http = searchAndStats([searchItem()]);
    await adapter(http).fetch(null, "token-value");
    for (const url of http.urls) {
      expect(new URL(url).host).toBe("api.github.com");
    }
  });

  it("sends only a query and a credential, never user content", async () => {
    const http = searchAndStats([searchItem()]);
    await adapter(http).fetch("2026-03-01", "token-value");

    // [HC-NO-EXFILTRATION]: this adapter is ingress-only. The request carries an
    // author, a date, a repository, and a page — no goal, value, or message.
    for (const url of http.urls) {
      expect(searchQuery(url)).not.toMatch(
        /goal|value|constraint|journal|mentor|message/i,
      );
    }
  });

  it("uses read-only requests", async () => {
    const methods: string[] = [];
    const httpFetch = ((url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      return Promise.resolve(
        new Response(
          JSON.stringify(
            String(url).includes("/search/commits") ? { items: [searchItem()] } : {},
          ),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;

    await adapter({ httpFetch }).fetch(null, "token-value");
    expect([...new Set(methods)]).toEqual(["GET"]);
  });
});

describe("GitHub failure handling", () => {
  it("reports a 401 without leaking the token", async () => {
    const http = recorder(() => ({ status: 401, body: { message: "Bad credentials" } }));
    const failure = await rejection(adapter(http).fetch(null, "super-secret-token-value"));

    expect(failure.message).toContain("Open Settings");
    // [HC-SECRETS-ENV-ONLY]: not even a truncated credential reaches a message
    // the user or a log will see.
    expect(failure.message).not.toContain("super-secret-token-value");
    expect(failure.message).not.toContain("super-secret");
  });

  it("backs off on a rate-limit response", async () => {
    const http = recorder(() => ({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "retry-after": "120" },
      body: { message: "rate limit exceeded" },
    }));
    const failure = await rejection(adapter(http).fetch(null, "token-value"));

    expect(failure).toBeInstanceOf(GitHubRateLimitError);
    expect(failure.message).toContain("2 minute");
    // Never spin. One request, then stop and tell the user how long to wait.
    expect(http.urls).toHaveLength(1);
  });

  it("explains a 403 that is not a rate limit", async () => {
    const http = recorder(() => ({ status: 403, body: { message: "Forbidden" } }));
    const failure = await rejection(adapter(http).fetch(null, "token-value"));
    expect(failure.message).toContain("may lack access");
    expect(failure).not.toBeInstanceOf(GitHubRateLimitError);
  });

  it("names the setting to fix when a repository is missing", async () => {
    const http = recorder(() => ({ status: 404, body: {} }));
    const failure = await rejection(adapter(http).fetch(null, "token-value"));
    expect(failure.message).toContain("owner/name");
  });

  it("refuses to run without a login", async () => {
    const http = searchAndStats([searchItem()]);
    const failure = await rejection(adapter(http, { login: "" }).fetch(null, "token-value"));

    expect(failure.message).toContain("username");
    expect(http.urls).toEqual([]);
  });

  it("refuses to run without a token", async () => {
    const http = searchAndStats([searchItem()]);
    const failure = await rejection(adapter(http).fetch(null, ""));

    expect(failure.message).toContain("token");
    expect(http.urls).toEqual([]);
  });

  it("keeps the commit when the line-count request fails", async () => {
    const http = recorder((url) =>
      url.includes("/search/commits")
        ? { body: { items: [searchItem()] } }
        : { status: 500, body: {} },
    );
    const signals = await adapter(http).fetch(null, "token-value");

    // Losing a line count is much cheaper than losing the commit.
    expect(signals).toHaveLength(1);
    expect(signals[0]?.metrics).toEqual({});
  });

  it("skips a record with no repository or no date rather than failing the sync", async () => {
    const http = searchAndStats([
      searchItem({ repository: null }),
      searchItem({ sha: "bbbb1111", commit: { message: "x", committer: null } }),
      searchItem({ sha: "cccc2222" }),
    ]);
    const signals = await adapter(http).fetch(null, "token-value");
    expect(signals.map((signal) => signal.id)).toEqual(["github_cccc2222"]);
  });
});

describe("GitHub helpers", () => {
  it("produces a domain the signal schema accepts", () => {
    for (const input of ["Owner/My.Repo", "UPPER", "a--b", "___", "owner/9lives"]) {
      expect(slugifyDomain(input)).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }
  });

  it("prefers an organization mapping when the repository is unmapped", () => {
    const mapped = domainFor(
      config({ domains: { "octo-sample": "career" } }),
      "octo-sample/anything",
    );
    expect(mapped).toBe("career");
  });

  it("builds a qualifier for each repository and organization", () => {
    expect(
      scopeQualifiers(
        config({ repositories: ["a/b"], organizations: ["orgname"] }),
      ),
    ).toEqual(["repo:a/b", "org:orgname"]);
  });
});
