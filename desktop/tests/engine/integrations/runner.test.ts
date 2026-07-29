import { describe, expect, it } from "vitest";

import type { ActivitySignal } from "../../../src/engine/domain";
import { FixtureAdapter } from "../../../src/engine/integrations/fixture";
import { integrationPolicySchema } from "../../../src/engine/integrations/policy";
import { runSync, type SignalSink } from "../../../src/engine/integrations/runner";
import { declaredHosts, createAdapters } from "../../../src/engine/integrations";
import type { ActivityAdapter } from "../../../src/engine/integrations/types";

class RecordingSink implements SignalSink {
  readonly merged: ActivitySignal[] = [];
  readonly failures: string[] = [];
  latest: string | null = null;

  latestOccurredAt(): Promise<string | null> {
    return Promise.resolve(this.latest);
  }

  merge(
    _integrationId: string,
    incoming: readonly ActivitySignal[],
  ): Promise<number> {
    this.merged.push(...incoming);
    return Promise.resolve(this.merged.length);
  }

  recordFailure(_integrationId: string, message: string): Promise<void> {
    this.failures.push(message);
    return Promise.resolve();
  }
}

const enabled = integrationPolicySchema.parse({ enabled: true });
const disabled = integrationPolicySchema.parse({ enabled: false });
const now = new Date("2026-03-10T12:00:00Z");

function fixtureAdapter(): FixtureAdapter {
  return new FixtureAdapter(() => now);
}

describe("runSync", () => {
  it("stores the signals an adapter returns", async () => {
    const sink = new RecordingSink();
    const outcome = await runSync({
      adapter: fixtureAdapter(),
      policy: enabled,
      trigger: "manual",
      sink,
      globallyPaused: false,
      now,
    });

    expect(outcome.status).toBe("synced");
    expect(sink.merged).toHaveLength(5);
    expect(sink.failures).toEqual([]);
  });

  it("never touches an adapter that is turned off", async () => {
    const sink = new RecordingSink();
    let fetched = false;
    const adapter: ActivityAdapter = {
      id: "watched",
      version: "1",
      hosts: [],
      label: "Watched",
      requiresCredential: false,
      fetch: () => {
        fetched = true;
        return Promise.resolve([]);
      },
    };

    const outcome = await runSync({
      adapter,
      policy: disabled,
      trigger: "manual",
      sink,
      globallyPaused: false,
      now,
    });

    expect(fetched).toBe(false);
    expect(outcome.status).toBe("skipped");
    expect(sink.merged).toEqual([]);
  });

  it("passes the stored high-water mark to the adapter as the starting point", async () => {
    const sink = new RecordingSink();
    sink.latest = "2026-03-09";

    const outcome = await runSync({
      adapter: fixtureAdapter(),
      policy: enabled,
      trigger: "manual",
      sink,
      globallyPaused: false,
      now,
    });

    expect(outcome.status).toBe("synced");
    // Only the seeds on 2026-03-09 and 2026-03-10 survive the `since` filter.
    expect(sink.merged).toHaveLength(2);
  });

  it("records an adapter failure instead of throwing", async () => {
    const sink = new RecordingSink();
    const adapter: ActivityAdapter = {
      id: "flaky",
      version: "1",
      hosts: [],
      label: "Flaky",
      requiresCredential: false,
      fetch: () => Promise.reject(new Error("Rate limit reached.")),
    };

    const outcome = await runSync({
      adapter,
      policy: enabled,
      trigger: "manual",
      sink,
      globallyPaused: false,
      now,
    });

    expect(outcome).toEqual({
      status: "failed",
      integrationId: "flaky",
      problem: "Rate limit reached.",
    });
    expect(sink.failures).toEqual(["Rate limit reached."]);
  });

  it("refuses to run an adapter that needs a credential it does not have", async () => {
    const sink = new RecordingSink();
    let fetched = false;
    const adapter: ActivityAdapter = {
      id: "needy",
      version: "1",
      hosts: ["api.example.com"],
      label: "Needy",
      requiresCredential: true,
      fetch: () => {
        fetched = true;
        return Promise.resolve([]);
      },
    };

    const outcome = await runSync({
      adapter,
      policy: enabled,
      trigger: "manual",
      sink,
      globallyPaused: false,
      now,
    });

    expect(fetched).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(sink.failures[0]).toContain("needs a credential");
  });
});

describe("adapter registry", () => {
  it("ships only the offline fixture for now", () => {
    const adapters = createAdapters(() => now);
    expect(adapters.map((adapter) => adapter.id)).toEqual(["fixture"]);
  });

  it("declares no outbound hosts, because nothing here makes a call", () => {
    expect(declaredHosts(createAdapters(() => now))).toEqual([]);
  });
});

describe("FixtureAdapter", () => {
  it("invents records anchored to the injected clock", async () => {
    const signals = await fixtureAdapter().fetch(null);
    expect(signals[0]?.occurred_at).toBe("2026-03-10");
    expect(new Set(signals.map((signal) => signal.domain))).toEqual(
      new Set(["engineering", "training"]),
    );
  });

  it("gives every record a unique id", async () => {
    const signals = await fixtureAdapter().fetch(null);
    expect(new Set(signals.map((signal) => signal.id)).size).toBe(signals.length);
  });
});
