/**
 * The contract every activity adapter satisfies.
 *
 * Implements: [HC-NO-EXFILTRATION]
 *
 * This directory is the second of two permitted to make outbound calls, and the
 * narrower one. Providers send user content to a model; adapters send a
 * credential and a query and receive data back. `hosts` is the machine-readable
 * half of that promise: it is exhaustive, it matches the allowlist named in
 * `[HC-NO-EXFILTRATION]`, and an adapter that reaches a host outside it is a
 * violation rather than a bug.
 *
 * An offline adapter — a fixture, or the reviewed manual import lane — declares
 * an empty `hosts` array and makes no call at all.
 */

import type { ActivitySignal } from "../domain";

export interface ActivityAdapter {
  /** Stable slug. Matches `ActivitySignal.integration_id`. */
  readonly id: string;
  /** Recorded in provenance, so a re-parse can be told from a re-fetch. */
  readonly version: string;
  /** Exhaustive. Empty means this adapter never touches the network. */
  readonly hosts: readonly string[];
  /** Human-readable name for the Settings pane. */
  readonly label: string;
  /** True when the adapter cannot run until a credential is stored. */
  readonly requiresCredential: boolean;

  /**
   * Return signals that occurred on or after `since`, or everything available
   * when `since` is null. Adapters fetch incrementally: a full refetch on every
   * run burns rate limit and, on a long history, gets the integration throttled
   * into uselessness.
   */
  fetch(since: string | null, credential?: string): Promise<ActivitySignal[]>;
}

/** What the Settings pane needs in order to describe an integration. */
export interface AdapterDescription {
  id: string;
  label: string;
  hosts: readonly string[];
  requiresCredential: boolean;
}

export function describeAdapter(adapter: ActivityAdapter): AdapterDescription {
  return {
    id: adapter.id,
    label: adapter.label,
    hosts: adapter.hosts,
    requiresCredential: adapter.requiresCredential,
  };
}
