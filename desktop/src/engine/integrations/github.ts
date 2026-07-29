/**
 * The first real activity adapter: commits authored on GitHub.
 *
 * Implements: [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY],
 * [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * Ingress-only. Every request is a GET to `api.github.com` carrying a bearer
 * token, a search query built from a login, a date, and the repositories the
 * user put in scope. No goal, value, constraint, journal line, chat message, or
 * mentor text is ever part of a request — that is the line the amended
 * `[HC-NO-EXFILTRATION]` draws, and this adapter stays on the ingress side of it.
 *
 * `GET /users/{username}/events` is deliberately not used. It reaches back only
 * 90 days and shows only public activity, so it omits exactly the private work
 * that matters most here. It is the endpoint that looks obvious and is a trap.
 *
 * `fetch` is injected so the tests run against recorded payloads. A suite that
 * needs a live endpoint and a valid token is a suite that stops being run.
 */

import type { ActivitySignal } from "../domain";
import type { GitHubConfig } from "./policy";
import type { ActivityAdapter } from "./types";

export const GITHUB_INTEGRATION_ID = "github";
const GITHUB_API_HOST = "api.github.com";
const API_ROOT = `https://${GITHUB_API_HOST}`;

/** Search caps out at 1000 results; this bounds a first sync well short of it. */
const MAX_PAGES = 3;
const PER_PAGE = 100;

/**
 * How many commits get a follow-up request for line counts.
 *
 * Search results carry no diff stats, so each one costs an extra call. That
 * budget is the core API's 5000/hour rather than search's 30/minute, but an
 * unbounded first sync would still fire hundreds of requests, so it is capped.
 * Enrichment is best-effort: a commit whose stats fail still becomes a signal
 * with empty metrics, because losing a line count is much cheaper than losing
 * the commit.
 */
const MAX_ENRICHED = 25;

/** Raised when GitHub asks us to stop. Carried to the user, never retried in a loop. */
export class GitHubRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubRateLimitError";
  }
}

interface SearchItem {
  sha: string;
  html_url: string;
  commit: { message: string; committer: { date: string } | null };
  repository: { full_name: string } | null;
}

/**
 * Turn any repository name into something `ActivitySignal.domain` accepts.
 *
 * The schema requires lowercase alphanumerics, underscores, and hyphens, so
 * `SamuelBishop/Trajectory.App` cannot be a domain as written.
 */
export function slugifyDomain(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/^[^/]*\//, "")
    .replaceAll(/[^a-z0-9_-]+/g, "-")
    .replaceAll(/-{2,}/g, "-")
    .replace(/^[-_]+/, "")
    .replace(/[-_]+$/, "");
  return slug.length > 0 ? slug : "github";
}

/** First line only. Bodies carry issue links, internal IDs, and pasted secrets. */
export function firstLine(message: string, limit = 280): string {
  const line = message.split(/\r\n|\r|\n/, 1)[0]?.trim() ?? "";
  if (line.length === 0) {
    return "(no commit message)";
  }
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

/**
 * Scope qualifiers for the search query.
 *
 * An empty array with `all_repositories` off means the user has chosen nothing,
 * and the adapter must make no request rather than searching everything the
 * token can reach. With it on, an empty array is the whole point: the query
 * carries an author and a date and no repository restriction.
 */
export function scopeQualifiers(config: GitHubConfig): string[] {
  if (config.all_repositories) {
    return [];
  }
  return [
    ...config.repositories
      .filter((entry) => entry.length > 0)
      .map((entry) => `repo:${entry}`),
    ...config.organizations
      .filter((entry) => entry.length > 0)
      .map((entry) => `org:${entry}`),
  ];
}

/**
 * The earliest commit date worth asking for.
 *
 * The last sync when there is one, and the lookback horizon otherwise. The
 * horizon bounds the *first* sync, which would otherwise reach across all of
 * history and return hundreds of commits about work long since finished.
 *
 * It deliberately does not also clamp later syncs. Taking the later of the two
 * would mean that going a fortnight without opening the app silently loses the
 * commits in between: they are newer than the last sync, so nothing will ask
 * for them again, but older than the horizon, so this sync skips them. A gap
 * that depends on when the user happened to open an app is not a window, it is
 * data loss. Page count already bounds the size of any single fetch.
 */
export function earliestDate(
  since: string | null,
  lookbackDays: number,
  today: Date,
): string {
  if (since !== null) {
    return since;
  }
  return new Date(today.getTime() - lookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Explicit map first, then a slug of the repository name. */
export function domainFor(config: GitHubConfig, repositoryFullName: string): string {
  const [owner] = repositoryFullName.split("/");
  const mapped =
    config.domains[repositoryFullName] ?? (owner ? config.domains[owner] : undefined);
  return slugifyDomain(mapped && mapped.length > 0 ? mapped : repositoryFullName);
}

// Not `implements ActivityAdapter`: that type is a union pairing
// `requiresCredential` with `credentialHint`, and a class cannot implement a
// union. `createAdapters` returns `ActivityAdapter[]`, so the pairing is still
// checked — at registration, which is where the registry actually forms.
export class GitHubCommitsAdapter {
  readonly id = GITHUB_INTEGRATION_ID;
  readonly version = "github-1";
  readonly hosts: readonly string[] = [GITHUB_API_HOST];
  readonly label = "GitHub commits";
  readonly requiresCredential = true;
  readonly credentialHint =
    "Store a GitHub token in Settings, under GitHub credential, with read " +
    "access to the repositories you want counted. Signing in with GitHub for " +
    "the model is a separate thing: that credential is held by the Copilot " +
    "runtime and carries no permission to read your commits.";

  constructor(
    private readonly readConfig: () => Promise<GitHubConfig>,
    private readonly httpFetch: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(since: string | null, credential?: string): Promise<ActivitySignal[]> {
    const config = await this.readConfig();
    const qualifiers = scopeQualifiers(config);

    if (config.login.length === 0) {
      throw new Error(
        "GitHub needs the username whose commits to read. Add it in Settings.",
      );
    }
    // No scope means no request, unless the user explicitly asked for every
    // repository. Reading everything a token permits is a decision that has to
    // be theirs rather than a default.
    if (qualifiers.length === 0 && !config.all_repositories) {
      return [];
    }
    const token = credential ?? "";
    if (token.length === 0) {
      throw new Error("GitHub needs a token before it can read commits.");
    }

    const items = await this.search(config, qualifiers, since, token);
    const fetchedAt = this.now().toISOString();
    const signals: ActivitySignal[] = [];

    for (const [index, item] of items.entries()) {
      const repository = item.repository?.full_name ?? "";
      const occurredAt = (item.commit.committer?.date ?? "").slice(0, 10);
      if (repository.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(occurredAt)) {
        continue;
      }
      signals.push({
        id: `${GITHUB_INTEGRATION_ID}_${item.sha.toLowerCase().slice(0, 12)}`,
        integration_id: GITHUB_INTEGRATION_ID,
        kind: "code_commit",
        occurred_at: occurredAt,
        summary: firstLine(item.commit.message),
        domain: domainFor(config, repository),
        metrics:
          index < MAX_ENRICHED
            ? await this.stats(repository, item.sha, token)
            : {},
        url: item.html_url,
        provenance: {
          fetched_at: fetchedAt,
          adapter_version: this.version,
          account_label: config.login,
          manually_reviewed: false,
        },
      });
    }

    return signals;
  }

  private async search(
    config: GitHubConfig,
    qualifiers: string[],
    since: string | null,
    token: string,
  ): Promise<SearchItem[]> {
    // Always date-bounded. A full refetch on every run burns the search budget
    // and, on a long history, throttles the integration into uselessness.
    const terms = [
      `author:${config.login}`,
      ...qualifiers,
      `committer-date:>=${earliestDate(since, config.lookback_days, this.now())}`,
    ];

    const collected: SearchItem[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url =
        `${API_ROOT}/search/commits?q=${encodeURIComponent(terms.join(" "))}` +
        `&sort=committer-date&order=desc&per_page=${String(PER_PAGE)}&page=${String(page)}`;
      const response = await this.httpFetch(url, {
        method: "GET",
        headers: this.headers(token),
      });
      this.assertUsable(response);

      const body = (await response.json()) as { items?: SearchItem[] };
      const items = body.items ?? [];
      collected.push(...items);
      if (items.length < PER_PAGE) {
        break;
      }
    }
    return collected;
  }

  /** Best-effort. A failure here costs a line count, not the commit. */
  private async stats(
    repository: string,
    sha: string,
    token: string,
  ): Promise<Record<string, number>> {
    try {
      const response = await this.httpFetch(
        `${API_ROOT}/repos/${repository}/commits/${sha}`,
        { method: "GET", headers: this.headers(token) },
      );
      if (!response.ok) {
        return {};
      }
      const body = (await response.json()) as {
        stats?: { additions?: number; deletions?: number };
        files?: unknown[];
      };
      const additions = body.stats?.additions;
      const deletions = body.stats?.deletions;
      const metrics: Record<string, number> = {};
      if (typeof additions === "number") {
        metrics["additions"] = additions;
      }
      if (typeof deletions === "number") {
        metrics["deletions"] = deletions;
      }
      if (Array.isArray(body.files)) {
        metrics["files"] = body.files.length;
      }
      return metrics;
    } catch {
      return {};
    }
  }

  private headers(token: string): Record<string, string> {
    return {
      // `cloak` is what makes commit search available; the version pin keeps a
      // future default from changing the payload shape underneath us.
      Accept: "application/vnd.github.cloak-preview+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Trajectory",
    };
  }

  /**
   * Convert an unhappy response into a message the user can act on.
   *
   * Implements: [HC-SECRETS-ENV-ONLY]
   *
   * The token is never part of any message here, not even truncated. A 401 says
   * to re-authorize; it does not show what was sent.
   */
  private assertUsable(response: Response): void {
    if (response.ok) {
      return;
    }
    if (response.status === 401) {
      throw new Error(
        "GitHub rejected the stored token. Open Settings and store a current one.",
      );
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const retryAfter = response.headers.get("retry-after");
      const reset = response.headers.get("x-ratelimit-reset");
      // Surface the wait and stop. Never spin: search allows 30 requests per
      // minute, and retrying inside that window is how an integration gets
      // itself throttled for longer.
      if (remaining === "0" || retryAfter !== null) {
        throw new GitHubRateLimitError(
          `GitHub rate limit reached. ${describeWait(retryAfter, reset)}`,
        );
      }
      throw new Error(
        "GitHub refused the request. The token may lack access to a repository in scope.",
      );
    }
    if (response.status === 404) {
      throw new Error(
        "GitHub could not find a repository in scope. Check the owner/name entries in Settings.",
      );
    }
    throw new Error(`GitHub replied ${String(response.status)}.`);
  }
}

function describeWait(retryAfter: string | null, reset: string | null): string {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return `Try again in about ${String(Math.ceil(seconds / 60))} minute(s).`;
  }
  const resetAt = Number(reset);
  if (Number.isFinite(resetAt) && resetAt > 0) {
    return `Try again after ${new Date(resetAt * 1000).toISOString().slice(11, 16)} UTC.`;
  }
  return "Try again shortly.";
}
