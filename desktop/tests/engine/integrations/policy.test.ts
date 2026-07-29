import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  decideSync,
  integrationPolicySchema,
  integrationsConfigSchema,
  isWithinQuietHours,
  policyFor,
  type IntegrationPolicy,
} from "../../../src/engine/integrations/policy";

function policy(overrides: Partial<{
  enabled: boolean;
  on_app_load: boolean;
  on_demand: boolean;
  timer_minutes: number;
  quiet_start: number;
  quiet_end: number;
}>): IntegrationPolicy {
  return integrationPolicySchema.parse({
    enabled: overrides.enabled ?? true,
    sync: {
      on_app_load: overrides.on_app_load ?? false,
      on_demand: overrides.on_demand ?? true,
      timer_minutes: overrides.timer_minutes ?? 0,
    },
    quiet_hours: {
      start: overrides.quiet_start ?? 0,
      end: overrides.quiet_end ?? 0,
    },
  });
}

const noon = new Date("2026-03-10T12:00:00Z");

describe("integration sync policy", () => {
  it("disables every integration by default", () => {
    expect(DEFAULT_POLICY.enabled).toBe(false);
    const config = integrationsConfigSchema.parse({});
    expect(policyFor(config, "github").enabled).toBe(false);
  });

  it("never syncs a disabled integration, whatever the trigger", () => {
    for (const trigger of ["manual", "app_load", "timer"] as const) {
      const decision = decideSync({
        policy: policy({ enabled: false, on_app_load: true, timer_minutes: 1 }),
        trigger,
        now: noon,
        lastSyncedAt: null,
        globallyPaused: false,
      });
      expect(decision.sync).toBe(false);
      expect(decision.reason).toContain("turned off");
    }
  });

  it("lets an explicit refresh through the global pause", () => {
    const decision = decideSync({
      policy: policy({}),
      trigger: "manual",
      now: noon,
      lastSyncedAt: null,
      globallyPaused: true,
    });
    expect(decision.sync).toBe(true);
  });

  it("stops automatic syncing while paused", () => {
    const decision = decideSync({
      policy: policy({ on_app_load: true }),
      trigger: "app_load",
      now: noon,
      lastSyncedAt: null,
      globallyPaused: true,
    });
    expect(decision.sync).toBe(false);
    expect(decision.reason).toContain("paused");
  });

  it("suppresses a timer sync inside quiet hours", () => {
    const decision = decideSync({
      policy: policy({ timer_minutes: 30, quiet_start: 22, quiet_end: 7 }),
      trigger: "timer",
      // 23:00 local, inside a window that wraps midnight.
      now: new Date(2026, 2, 10, 23, 0, 0),
      lastSyncedAt: null,
      globallyPaused: false,
    });
    expect(decision.sync).toBe(false);
    expect(decision.reason).toContain("quiet hours");
  });

  it("lets an explicit refresh through quiet hours", () => {
    const decision = decideSync({
      policy: policy({ quiet_start: 22, quiet_end: 7 }),
      trigger: "manual",
      now: new Date(2026, 2, 10, 23, 0, 0),
      lastSyncedAt: null,
      globallyPaused: false,
    });
    expect(decision.sync).toBe(true);
  });

  it("waits for the interval to elapse before a timer sync", () => {
    const base = {
      policy: policy({ timer_minutes: 60 }),
      trigger: "timer" as const,
      now: new Date("2026-03-10T12:00:00Z"),
      globallyPaused: false,
    };
    expect(
      decideSync({ ...base, lastSyncedAt: "2026-03-10T11:30:00Z" }).sync,
    ).toBe(false);
    expect(
      decideSync({ ...base, lastSyncedAt: "2026-03-10T10:59:00Z" }).sync,
    ).toBe(true);
  });

  it("syncs on a timer when nothing has ever been stored", () => {
    const decision = decideSync({
      policy: policy({ timer_minutes: 60 }),
      trigger: "timer",
      now: noon,
      lastSyncedAt: null,
      globallyPaused: false,
    });
    expect(decision.sync).toBe(true);
  });

  it("treats a zero timer as off", () => {
    const decision = decideSync({
      policy: policy({ timer_minutes: 0 }),
      trigger: "timer",
      now: noon,
      lastSyncedAt: null,
      globallyPaused: false,
    });
    expect(decision.sync).toBe(false);
    expect(decision.reason).toContain("timer is turned off");
  });

  it("refuses an on-demand refresh when the user turned it off", () => {
    const decision = decideSync({
      policy: policy({ on_demand: false }),
      trigger: "manual",
      now: noon,
      lastSyncedAt: null,
      globallyPaused: false,
    });
    expect(decision.sync).toBe(false);
  });
});

describe("quiet hours", () => {
  it("treats an empty window as no quiet hours", () => {
    expect(isWithinQuietHours(3, { start: 0, end: 0 })).toBe(false);
    expect(isWithinQuietHours(23, { start: 9, end: 9 })).toBe(false);
  });

  it("covers a window that wraps midnight", () => {
    const quiet = { start: 22, end: 7 };
    expect(isWithinQuietHours(22, quiet)).toBe(true);
    expect(isWithinQuietHours(2, quiet)).toBe(true);
    expect(isWithinQuietHours(6, quiet)).toBe(true);
    expect(isWithinQuietHours(7, quiet)).toBe(false);
    expect(isWithinQuietHours(12, quiet)).toBe(false);
    expect(isWithinQuietHours(21, quiet)).toBe(false);
  });

  it("covers a window inside a single day", () => {
    const quiet = { start: 9, end: 17 };
    expect(isWithinQuietHours(9, quiet)).toBe(true);
    expect(isWithinQuietHours(16, quiet)).toBe(true);
    expect(isWithinQuietHours(17, quiet)).toBe(false);
    expect(isWithinQuietHours(3, quiet)).toBe(false);
  });
});
