import { describe, expect, it } from "vitest";

import { briefingSchema } from "../../src/engine/domain";
import type { ActivitySignal } from "../../src/engine/domain";
import { AttributionError, InsufficientContextError } from "../../src/engine/errors";
import { dailyBriefing } from "../../src/engine/mentorship";
import { BRIEFING_SYSTEM_PROMPT } from "../../src/engine/prompting";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import type { MentorProvider } from "../../src/engine/providers/types";
import { copyFixture, editYaml, mentorDirectory, userDirectory } from "./fixtures";
import path from "node:path";

const directories = { userDirectory, mentorDirectory };
const today = "2026-03-10";

function signal(overrides: Partial<ActivitySignal> = {}): ActivitySignal {
  return {
    id: "fixture_1",
    integration_id: "fixture",
    kind: "code_commit",
    occurred_at: today,
    summary: "Invented record for a test",
    domain: "career",
    completed: null,
    metrics: {},
    url: null,
    provenance: {
      fetched_at: "2026-03-10T12:00:00.000Z",
      adapter_version: "fixture-1",
      account_label: "sample",
      manually_reviewed: false,
    },
    ...overrides,
  };
}

describe("daily briefing", () => {
  it("grounds itself without anyone asking a question", async () => {
    // The whole point of a briefing is that no message exists to match goals
    // against. Chat refuses when selection finds nothing; this must not.
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.request.goals.length).toBeGreaterThan(0);
    expect(result.request.principles.length).toBeGreaterThan(0);
    expect(result.request.sources.length).toBeGreaterThan(0);
    expect(result.briefing.goal_ids).toEqual(["career_001"]);
    expect(result.request.today).toBe(today);
  });

  it("carries the covered date so a stale briefing cannot be mistaken for today", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today: "2026-03-11" },
    );

    expect(result.request.today).toBe("2026-03-11");
  });

  it("selects only active goals, highest priority first", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.request.goals.every((goal) => goal.status === "active")).toBe(
      true,
    );
    const priorities = result.request.goals.map((goal) => goal.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it("refuses rather than briefing on a life with no active goals", async () => {
    // Silence is the correct output here. A briefing assembled from paused and
    // completed goals would be confidently about nothing.
    const directory = await copyFixture(userDirectory, "user");
    await editYaml(path.join(directory, "goals.yaml"), (raw) => {
      for (const goal of raw.goals) {
        goal.status = "paused";
      }
    });

    await expect(
      dailyBriefing(
        new DeterministicProvider(),
        { userDirectory: directory, mentorDirectory },
        { signals: [], today },
      ),
    ).rejects.toThrow(InsufficientContextError);
  });

  it("passes observed activity through to the request", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [signal()], today },
    );

    expect(result.request.activity_context).not.toBeNull();
    expect(
      result.request.activity_context?.signals.map((item) => item.id),
    ).toContain("fixture_1");
  });

  it("sends no activity context when nothing relevant was observed", async () => {
    // Deliberately null rather than an empty scaffold: `{signals: [],
    // rollups: []}` would read to a model as "we looked and found nothing",
    // which is a claim about the user rather than about the data. Stale
    // sources are reported separately, because a failed sync is a third thing
    // — neither evidence of activity nor evidence of its absence.
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.request.activity_context).toBeNull();
  });

  it("names stale sources so silence is not read as inactivity", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
      ["strava"],
    );

    expect(result.request.stale_sources).toEqual(["strava"]);
  });

  it("reports no stale sources when every sync succeeded", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.request.stale_sources).toEqual([]);
  });

  it("copies stale sources rather than aliasing the caller's array", async () => {
    const stale = ["strava"];
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
      stale,
    );
    stale.push("notion");

    expect(result.request.stale_sources).toEqual(["strava"]);
  });

  it("stamps its own prompt version, not chat's", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.request.prompt_version).toBe("briefing_v1");
  });

  it("returns a headline short enough for a notification", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.briefing.headline.length).toBeLessThanOrEqual(120);
    expect(result.briefing.headline.length).toBeGreaterThan(0);
  });

  it("caps priorities at three so the answer stays a priority list", async () => {
    const result = await dailyBriefing(
      new DeterministicProvider(),
      directories,
      { signals: [], today },
    );

    expect(result.briefing.priorities.length).toBeLessThanOrEqual(3);
    expect(result.briefing.priorities.length).toBeGreaterThan(0);
  });
});

describe("briefing schema", () => {
  const valid = {
    headline: "Design proposal still waiting — worth the afternoon.",
    body: "Something useful.",
    on_track: "partly",
    priorities: ["One", "Two"],
    watch_out: "Polishing instead of designing.",
    goal_ids: ["career_001"],
    principle_ids: ["demo_opportunity_cost_001"],
    source_ids: ["demo_source_001"],
    activity_ids: [],
    observations: [],
    inferences: [],
    confidence: 0.7,
    uncertainties: ["Cannot see work away from connected sources."],
  };

  it("accepts a well-formed briefing", () => {
    expect(briefingSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a headline too long for a notification", () => {
    // The cap is a privacy control, not cosmetics: whatever lands here is
    // displayed by the operating system, so an unbounded field is an
    // unbounded disclosure.
    const result = briefingSchema.safeParse({
      ...valid,
      headline: "a".repeat(121),
    });

    expect(result.success).toBe(false);
  });

  it("accepts a headline exactly at the cap", () => {
    expect(
      briefingSchema.safeParse({ ...valid, headline: "a".repeat(120) }).success,
    ).toBe(true);
  });

  it("rejects more than three priorities", () => {
    // Four priorities is a to-do list. The point of the briefing is to say
    // what matters most, which requires leaving things out.
    const result = briefingSchema.safeParse({
      ...valid,
      priorities: ["One", "Two", "Three", "Four"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty priority list", () => {
    expect(
      briefingSchema.safeParse({ ...valid, priorities: [] }).success,
    ).toBe(false);
  });

  it("rejects an on_track value outside the four it defines", () => {
    expect(
      briefingSchema.safeParse({ ...valid, on_track: "probably" }).success,
    ).toBe(false);
  });
});

describe("briefing attribution", () => {
  /** Returns whatever it is handed, so the test controls the model's output. */
  function stubProvider(briefing: unknown): MentorProvider {
    return {
      name: "deterministic",
      generate: () => Promise.reject(new Error("not used")),
      chat: () => Promise.reject(new Error("not used")),
      briefing: () => Promise.resolve(briefing as never),
    };
  }

  const grounded = {
    headline: "A plausible headline.",
    body: "A plausible body.",
    on_track: "partly" as const,
    priorities: ["One"],
    watch_out: "Something.",
    goal_ids: ["career_001"],
    principle_ids: ["demo_opportunity_cost_001"],
    source_ids: ["demo_source_001"],
    activity_ids: [],
    observations: [],
    inferences: [],
    confidence: 0.7,
    uncertainties: ["Something unknown."],
  };

  it("refuses a briefing citing a goal that does not exist", async () => {
    // Attribution is the entire product claim. A briefing nobody asked for is
    // exactly where an invented citation would go unnoticed.
    await expect(
      dailyBriefing(
        stubProvider({ ...grounded, goal_ids: ["invented_goal"] }),
        directories,
        { signals: [], today },
      ),
    ).rejects.toThrow(AttributionError);
  });

  it("refuses a briefing citing a principle that does not exist", async () => {
    await expect(
      dailyBriefing(
        stubProvider({ ...grounded, principle_ids: ["invented_principle"] }),
        directories,
        { signals: [], today },
      ),
    ).rejects.toThrow(AttributionError);
  });

  it("refuses a briefing citing a source no cited principle rests on", async () => {
    await expect(
      dailyBriefing(
        stubProvider({ ...grounded, source_ids: ["demo_source_999"] }),
        directories,
        { signals: [], today },
      ),
    ).rejects.toThrow(AttributionError);
  });

  it("refuses a briefing citing an activity signal that was never supplied", async () => {
    await expect(
      dailyBriefing(
        stubProvider({ ...grounded, activity_ids: ["invented_signal"] }),
        directories,
        { signals: [signal()], today },
      ),
    ).rejects.toThrow(AttributionError);
  });

  it("accepts a briefing whose citations all resolve", async () => {
    const result = await dailyBriefing(stubProvider(grounded), directories, {
      signals: [],
      today,
    });

    expect(result.briefing.goal_ids).toEqual(["career_001"]);
  });
});

describe("briefing prompt", () => {
  it("tells the model the headline leaves the application", () => {
    // This instruction is the only thing standing between a private detail and
    // a lock screen, so assert it exists rather than trusting the prose.
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/lock screen/i);
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/operating system/i);
  });

  it("forbids the specific categories that must not reach a lock screen", () => {
    // Matched with flexible whitespace because the prompt is hard-wrapped and
    // any of these phrases can straddle a line break.
    for (const forbidden of [
      /health condition/i,
      /diagnosis/i,
      /relationship\s+detail/i,
      /financial\s+figure/i,
      /employer/i,
    ]) {
      expect(BRIEFING_SYSTEM_PROMPT).toMatch(forbidden);
    }
  });

  it("says a stale source is unknown rather than zero", () => {
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/stale_sources/);
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/unknown, not zero/i);
  });

  it("protects rest from being read as failure", () => {
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/rest or leisure/i);
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/Recovery, relationships, and\s+health are goals/i);
  });

  it("keeps the shared activity rules so the two prompts cannot drift", () => {
    expect(BRIEFING_SYSTEM_PROMPT).toMatch(/window_start and window_end/);
  });
});
