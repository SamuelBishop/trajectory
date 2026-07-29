/**
 * The set of adapters this build knows about.
 *
 * Implements: [HC-NO-EXFILTRATION], [SC-NO-PLACEHOLDERS]
 *
 * Only the offline fixture ships today. Registering a hollow entry for GitHub,
 * Notion, or Strava would put a switch in Settings that turns nothing on, which
 * is worse than an absent feature because the user believes it. Each real
 * adapter arrives with its own prompt and appears here when it works.
 */

import { FixtureAdapter } from "./fixture";
import { describeAdapter, type ActivityAdapter, type AdapterDescription } from "./types";

export function createAdapters(now: () => Date = () => new Date()): ActivityAdapter[] {
  return [new FixtureAdapter(now)];
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
export * from "./policy";
export * from "./rollup";
export * from "./runner";
export * from "./types";
