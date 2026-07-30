/**
 * The set of adapters this build knows about.
 *
 * Implements: [HC-NO-EXFILTRATION], [SC-NO-PLACEHOLDERS]
 *
 * The offline fixture, GitHub commits, and Notion tasks ship today. Registering
 * a hollow entry for Strava would put a switch in Settings that turns nothing
 * on, which is worse than an absent feature because the user believes it. Each
 * real adapter arrives with its own prompt and appears here when it works.
 */

import { FixtureAdapter } from "./fixture";
import { GitHubCommitsAdapter } from "./github";
import { NotionTasksAdapter } from "./notion";
import {
  DEFAULT_INTEGRATIONS_CONFIG,
  type GitHubConfig,
  type NotionConfig,
} from "./policy";
import { describeAdapter, type ActivityAdapter, type AdapterDescription } from "./types";

export interface AdapterOptions {
  now?: () => Date;
  /**
   * Reads the GitHub scope. Injected because the engine resolves no paths of
   * its own — the main process owns userData and hands the config in.
   */
  githubConfig?: () => Promise<GitHubConfig>;
  /** Reads the Notion scope, injected for the same reason. */
  notionConfig?: () => Promise<NotionConfig>;
  /** Injected so tests run against recorded payloads rather than the network. */
  httpFetch?: typeof fetch;
}

export function createAdapters(options: AdapterOptions = {}): ActivityAdapter[] {
  const now = options.now ?? (() => new Date());
  const httpFetch = options.httpFetch ?? globalThis.fetch;
  const githubConfig =
    options.githubConfig ?? (() => Promise.resolve(DEFAULT_INTEGRATIONS_CONFIG.github));
  const notionConfig =
    options.notionConfig ?? (() => Promise.resolve(DEFAULT_INTEGRATIONS_CONFIG.notion));
  return [
    new FixtureAdapter(now),
    new GitHubCommitsAdapter(githubConfig, httpFetch, now),
    new NotionTasksAdapter(notionConfig, httpFetch, now),
  ];
}

export function describeAdapters(
  adapters: readonly ActivityAdapter[],
): AdapterDescription[] {
  return adapters.map(describeAdapter);
}

/**
 * Every host any registered adapter may contact. The constitution names this
 * list; this function is how a test can assert the code agrees with it.
 */
export function declaredHosts(adapters: readonly ActivityAdapter[]): string[] {
  return [...new Set(adapters.flatMap((adapter) => [...adapter.hosts]))].sort();
}

export { FixtureAdapter, FIXTURE_INTEGRATION_ID } from "./fixture";
export {
  GitHubCommitsAdapter,
  GitHubRateLimitError,
  GITHUB_INTEGRATION_ID,
  domainFor,
  firstLine,
  scopeQualifiers,
  slugifyDomain,
} from "./github";
export {
  NotionTasksAdapter,
  NotionAccessError,
  NotionRateLimitError,
  NOTION_INTEGRATION_ID,
  normalizeDatabaseId,
} from "./notion";
export * from "./policy";
export * from "./rollup";
export * from "./runner";
export * from "./types";
