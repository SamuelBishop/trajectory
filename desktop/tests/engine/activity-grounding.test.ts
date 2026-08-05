import { describe, expect, it } from "vitest";

import type { ActivitySignal, DecisionRequest } from "../../src/engine/domain";
import { AttributionError } from "../../src/engine/errors";
import { chatWithMentor, reviewDecision } from "../../src/engine/mentorship";
import {
  ACTIVITY_SIGNAL_LIMIT,
  buildActivityContext,
  selectActivitySignals,
} from "../../src/engine/selection";
import {
  BRIEFING_SYSTEM_PROMPT,
  CHAT_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildUserMessage,
} from "../../src/engine/prompting";
import {
  activityMetrics,
  activitySummary,
} from "../../src/engine/integrations/strava";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import {
  validateChatResponse,
  validateRecommendation,
} from "../../src/engine/validation";
import { mentorDirectory, userDirectory } from "./fixtures";

const directories = { userDirectory, mentorDirectory };
const question =
  "Should I spend another two hours polishing this low-risk pull request?";
const today = "2026-03-10";

/** Matches the demo goal domains: `career` and `health`. */
const goals = [{ domain: "career" }, { domain: "health" }];

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

async function demoResult(signals: readonly ActivitySignal[] = []) {
  return await reviewDecision(
    question,
    new DeterministicProvider(),
    directories,
    { signals, today },
  );
}

describe("units that reach the model", () => {
  /**
   * The path the user actually complained about: a Strava activity, through
   * selection, into the object a provider is handed. Pinned end to end because
   * the adapter converting correctly is worthless if any layer between it and
   * the prompt reintroduces metres.
   */
  const rawStravaActivity = {
    id: 9_876_543_210,
    sport_type: "Run",
    distance: 16_093.44,
    moving_time: 5_400,
    total_elevation_gain: 304.8,
    start_date_local: "2026-03-10T06:12:00Z",
  };

  function workout(): ActivitySignal {
    return signal({
      id: "strava_9876543210",
      integration_id: "strava",
      kind: "workout",
      domain: "health",
      summary: activitySummary(rawStravaActivity),
      metrics: activityMetrics(rawStravaActivity),
    });
  }

  it("hands the model miles, never metres or kilometres", () => {
    const context = buildActivityContext(
      "How much running have I done?",
      goals,
      [workout()],
      today,
    );
    expect(context).not.toBeNull();

    const serialized = JSON.stringify(context);
    expect(serialized).toContain("10.0 mi");
    expect(serialized).not.toContain("km");
    expect(serialized).not.toContain("distance_m\"");

    expect(context?.signals[0]?.metrics).toMatchObject({
      distance_mi: 10,
      elevation_gain_ft: 1_000,
    });
  });

  it("totals the window in miles too, which is what a volume question reads", () => {
    // Rollups are what the prompt tells the model to use for "how much".
    // A summary in miles over a total in metres would be worse than either.
    const context = buildActivityContext(
      "How much running have I done?",
      goals,
      [workout()],
      today,
    );
    const rollup = context?.rollups.find(
      (item) => item.integration_id === "strava",
    );
    expect(rollup?.totals["distance_mi"]).toBe(10);
    expect(rollup?.totals).not.toHaveProperty("distance_m");
  });
});

describe("activity selection", () => {
  it("selects no signals when an unmatched one is also old, and sends null", () => {
    const stale = signal({
      id: "fixture_unrelated",
      domain: "gardening",
      summary: "Repotted the seedlings",
      occurred_at: "2025-01-01",
    });
    expect(selectActivitySignals(question, goals, [stale], { today })).toEqual(
      [],
    );
    expect(buildActivityContext(question, goals, [stale], today)).toBeNull();
  });

  it("admits a recent signal that matches neither a goal nor the question", () => {
    // Recency is a way in on its own. Requiring a match meant an unmapped
    // repository was not merely hard to interpret but absent, and a model
    // cannot reason about what it was never shown. Deciding that a commit to
    // `gardening` is off-topic is the model's job, not selection's.
    const unrelated = signal({
      id: "fixture_unrelated",
      domain: "gardening",
      summary: "Repotted the seedlings",
    });
    expect(
      selectActivitySignals(question, goals, [unrelated], { today }).map(
        (item) => item.id,
      ),
    ).toEqual(["fixture_unrelated"]);
    expect(
      buildActivityContext(question, goals, [unrelated], today),
    ).not.toBeNull();
  });

  it("still ranks a matching older signal above a recent unrelated one", () => {
    const selected = selectActivitySignals(
      question,
      goals,
      [
        signal({
          id: "fixture_recent_noise",
          domain: "gardening",
          summary: "Repotted the seedlings",
        }),
        signal({
          id: "fixture_old_match",
          domain: "career",
          summary: "Wrote notes",
          occurred_at: "2026-03-04",
        }),
      ],
      { today },
    );
    expect(selected.map((item) => item.id)).toEqual([
      "fixture_old_match",
      "fixture_recent_noise",
    ]);
  });

  it("sends null rather than an empty scaffold when there is no activity", () => {
    // `{signals: [], rollups: []}` would read to a model as "we looked and
    // found nothing", which is a claim about the user.
    expect(buildActivityContext(question, goals, [], today)).toBeNull();
  });

  it("admits a signal that shares a domain with a selected goal", () => {
    const selected = selectActivitySignals(question, goals, [
      signal({ id: "fixture_career", domain: "career", summary: "Wrote notes" }),
    ]);
    expect(selected.map((item) => item.id)).toEqual(["fixture_career"]);
  });

  it("admits a signal whose words overlap the message", () => {
    const selected = selectActivitySignals(question, goals, [
      signal({
        id: "fixture_overlap",
        domain: "gardening",
        summary: "Opened a pull request against the irrigation schedule",
      }),
    ]);
    expect(selected.map((item) => item.id)).toEqual(["fixture_overlap"]);
  });

  it("does not admit a signal on recency alone", () => {
    // Newer, but unrelated to both the goals and the question.
    const recent = signal({
      id: "fixture_recent",
      domain: "gardening",
      summary: "Repotted the seedlings",
      occurred_at: "2026-03-10",
    });
    const older = signal({
      id: "fixture_older",
      domain: "career",
      summary: "Drafted a design proposal",
      occurred_at: "2026-02-01",
    });
    expect(
      selectActivitySignals(question, goals, [recent, older]).map((i) => i.id),
    ).toEqual(["fixture_older"]);
  });

  it("caps the number of signals sent", () => {
    const many = Array.from({ length: ACTIVITY_SIGNAL_LIMIT + 8 }, (_, index) =>
      signal({
        id: `fixture_${String(index).padStart(2, "0")}`,
        domain: "career",
        occurred_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
      }),
    );
    expect(selectActivitySignals(question, goals, many)).toHaveLength(
      ACTIVITY_SIGNAL_LIMIT,
    );

    const context = buildActivityContext(question, goals, many, today);
    expect(context?.signals).toHaveLength(ACTIVITY_SIGNAL_LIMIT);
  });

  it("orders by relevance first and recency second", () => {
    const selected = selectActivitySignals(question, goals, [
      signal({ id: "fixture_old_match", domain: "career", occurred_at: "2026-03-01" }),
      signal({ id: "fixture_new_match", domain: "career", occurred_at: "2026-03-09" }),
    ]);
    expect(selected.map((item) => item.id)).toEqual([
      "fixture_new_match",
      "fixture_old_match",
    ]);
  });

  function manySignals(count: number): ActivitySignal[] {
    return Array.from({ length: count }, (_, index) =>
      signal({
        id: `fixture_${String(index).padStart(3, "0")}`,
        domain: "career",
        occurred_at: `2026-03-${String((index % 10) + 1).padStart(2, "0")}`,
      }),
    );
  }

  it("summarizes the whole window, not only the signals it selected", () => {
    // The rollup counts everything stored, or a streak would become an artifact
    // of selection rather than of behavior.
    const many = manySignals(ACTIVITY_SIGNAL_LIMIT + 8);
    const context = buildActivityContext(question, goals, many, today);
    expect(context?.signals).toHaveLength(ACTIVITY_SIGNAL_LIMIT);
    // The month covers all forty-eight; the week covers only what fell in it.
    const month = context?.rollups.find((item) => item.window_start === "2026-02-09");
    expect(month?.signal_count).toBe(ACTIVITY_SIGNAL_LIMIT + 8);
  });

  it("reports a week and a month separately rather than one blended window", () => {
    // "How did this week go" is the question people actually ask, and a
    // thirty-day count answers a different one. The signals span ten days, so
    // the two windows must disagree — if they matched, the short window would
    // be decorative.
    const many = manySignals(ACTIVITY_SIGNAL_LIMIT + 8);
    const context = buildActivityContext(question, goals, many, today);
    const windows = context?.rollups.map((item) => [
      item.window_start,
      item.window_end,
      item.signal_count,
    ]);
    expect(windows).toEqual([
      ["2026-03-04", today, 33],
      ["2026-02-09", today, ACTIVITY_SIGNAL_LIMIT + 8],
    ]);
  });

  it("says how many signals qualified when the cap truncates them", () => {
    // The bug this exists to prevent: shown twelve of thirty-six commits with
    // no indication of the cut, the model reported the twelve as the total —
    // a false statement about the user's own week, stated confidently.
    const many = manySignals(ACTIVITY_SIGNAL_LIMIT + 8);
    const context = buildActivityContext(question, goals, many, today);
    expect(context?.signals).toHaveLength(ACTIVITY_SIGNAL_LIMIT);
    expect(context?.signals_available).toBe(ACTIVITY_SIGNAL_LIMIT + 8);
  });

  it("says how many qualified when nothing was truncated", () => {
    // Reported even when the numbers agree. A field that appeared only on
    // truncation would teach the model to read its absence as a census, which
    // is the same silence in a different shape.
    const context = buildActivityContext(question, goals, manySignals(3), today);
    expect(context?.signals).toHaveLength(3);
    expect(context?.signals_available).toBe(3);
  });

  it("counts only what qualified, not everything stored", () => {
    // `signals_available` reports the gap selection opened, so a signal the
    // filter rejected must not inflate it into a phantom the model is told
    // exists but cannot see.
    const stale = signal({
      id: "fixture_stale",
      domain: "gardening",
      summary: "Repotted the seedlings",
      occurred_at: "2025-01-01",
    });
    const context = buildActivityContext(
      question,
      goals,
      [...manySignals(3), stale],
      today,
    );
    expect(context?.signals_available).toBe(3);
  });

  it("emits a rollup per window for each contributing integration", () => {
    const context = buildActivityContext(
      question,
      goals,
      [
        signal({ id: "a_1", integration_id: "alpha", domain: "career" }),
        signal({ id: "b_1", integration_id: "beta", domain: "career" }),
        signal({ id: "b_2", integration_id: "beta", domain: "career" }),
      ],
      today,
    );
    // Grouped by integration, so the two windows for one integration stay
    // adjacent and a reader compares like with like.
    expect(context?.rollups.map((item) => item.integration_id)).toEqual([
      "alpha",
      "alpha",
      "beta",
      "beta",
    ]);
  });
});

describe("activity on the request", () => {
  it("still answers correctly with every integration disabled", async () => {
    // The overwhelmingly common case: no integration enabled, nothing supplied.
    const { recommendation, request } = await reviewDecision(
      question,
      new DeterministicProvider(),
      directories,
    );
    expect(request.activity_context).toBeNull();
    expect(recommendation.activity_ids).toEqual([]);
    expect(() => {
      validateRecommendation(recommendation, request);
    }).not.toThrow();
  });

  it("bumps the prompt version so a cached older prompt cannot be reused", async () => {
    const { request } = await demoResult();
    expect(request.prompt_version).toBe("decision_v6");
  });

  it("keeps measured activity out of the user's own claims", async () => {
    const { request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    // Three separate fields: what the user claims, what was measured, what the
    // model concluded ([HC-OBSERVATION-VS-INFERENCE]).
    expect(request.activity_context?.signals).toHaveLength(1);
    expect(JSON.stringify(request.current_state)).not.toContain(
      "fixture_career",
    );
  });

  it("carries an unfinished task to the model as unfinished", async () => {
    // The field is only worth having if it survives the trip. It is serialized
    // with the rest of the request, and the rules have to say what it means —
    // a value the prompt never explains is one the model will guess at.
    const { request } = await demoResult([
      signal({ id: "fixture_open", domain: "career", completed: false }),
    ]);
    const message = buildUserMessage(request);

    expect(request.activity_context?.signals[0]?.completed).toBe(false);
    expect(message).toContain('"completed":false');
    // Both prompts, because a rule in only one of them drifts ([HC-PROVIDER-PARITY]
    // applied to the prompts). A value the prompt never explains is one the
    // model will guess at, and the guess here is "this got done".
    for (const prompt of [SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT]) {
      expect(prompt).toContain("stated intention, not evidence of activity");
    }
  });

  it("tells both prompts that overlapping rollup windows must not be added", () => {
    // Two rollups per integration means the same commit is counted in both.
    // Without this rule a model asked "how many this month" could sum the week
    // and the month and report a number that never happened.
    for (const prompt of [SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT]) {
      expect(prompt).toContain("Never add two");
      expect(prompt).toContain("rollups overlap");
    }
  });

  it("tells every prompt to report a measurement in the unit it arrived in", () => {
    // The adapter converts metres to miles so the model never has to. This is
    // the other half: a model that helpfully converts back to kilometres is
    // doing arithmetic inside a sentence, where a wrong answer looks exactly
    // like a right one.
    for (const prompt of [
      SYSTEM_PROMPT,
      CHAT_SYSTEM_PROMPT,
      BRIEFING_SYSTEM_PROMPT,
    ]) {
      expect(prompt).toContain("distance_mi is miles");
      expect(prompt).toContain("never convert it to another one");
    }
  });

  it("keeps observations and inferences in separate fields when activity is present", async () => {    const { recommendation, request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(request.activity_context?.signals).toHaveLength(1);
    // Supplying measured activity must not collapse the two fields. What was
    // observed and what was concluded from it stay independently rejectable.
    expect(Array.isArray(recommendation.observations)).toBe(true);
    expect(Array.isArray(recommendation.inferences)).toBe(true);
    expect(recommendation.observations).not.toBe(recommendation.inferences);
  });

  it("puts the activity in front of the model rather than only on the request object", async () => {
    const { request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    // Both hosted providers serialize the whole request, so this is what makes
    // [HC-PROVIDER-PARITY] hold without a per-provider edit. A future refactor
    // that filtered fields out of the payload would fail here.
    const payload = buildUserMessage(request);
    expect(payload).toContain("fixture_career");
    expect(payload).toContain("activity_context");
  });

  it("keeps signals out of the mentor's evidence lane", async () => {
    const { request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    // A signal reaching `sources` would let a commit count as support for a
    // principle and silently gut [HC-BIDIRECTIONAL-ATTRIBUTION].
    expect(request.sources.map((source) => source.id)).not.toContain(
      "fixture_career",
    );
    expect(
      request.principles.flatMap((principle) => principle.source_ids),
    ).not.toContain("fixture_career");
  });
});

describe("activity attribution", () => {
  it("accepts a response citing no activity IDs at all", async () => {
    const { recommendation, request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    // Signals are context, not support: being shown six commits and mentioning
    // none is legitimate.
    expect(recommendation.activity_ids).toEqual([]);
    expect(() => {
      validateRecommendation(recommendation, request);
    }).not.toThrow();
  });

  it("accepts a response citing a signal it was shown", async () => {
    const { recommendation, request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(() => {
      validateRecommendation(
        { ...recommendation, activity_ids: ["fixture_career"] },
        request,
      );
    }).not.toThrow();
  });

  it("rejects a response citing an activity ID that was not in the request", async () => {
    const { recommendation, request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(() => {
      validateRecommendation(
        { ...recommendation, activity_ids: ["fixture_invented"] },
        request,
      );
    }).toThrow(AttributionError);
  });

  it("rejects a cited signal when no activity was sent at all", async () => {
    const { recommendation, request } = await demoResult();
    expect(request.activity_context).toBeNull();
    expect(() => {
      validateRecommendation(
        { ...recommendation, activity_ids: ["fixture_career"] },
        request,
      );
    }).toThrow(AttributionError);
  });

  it("does not accept a real source ID in the activity lane", async () => {
    const { recommendation, request } = await demoResult([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    const sourceId = request.sources[0]?.id ?? "";
    expect(sourceId.length).toBeGreaterThan(0);
    expect(() => {
      validateRecommendation(
        { ...recommendation, activity_ids: [sourceId] },
        request as DecisionRequest,
      );
    }).toThrow(AttributionError);
  });
});

describe("activity in chat", () => {
  async function chat(signals: readonly ActivitySignal[] = []) {
    return await chatWithMentor(
      question,
      [],
      new DeterministicProvider(),
      directories,
      { signals, today },
    );
  }

  it("still answers correctly with every integration disabled", async () => {
    const { response, request } = await chatWithMentor(
      question,
      [],
      new DeterministicProvider(),
      directories,
    );
    expect(request.activity_context).toBeNull();
    expect(response.activity_ids).toEqual([]);
    expect(() => {
      validateChatResponse(response, request);
    }).not.toThrow();
  });

  it("carries measured activity alongside, not inside, the user's claims", async () => {
    const { request } = await chat([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(request.activity_context?.signals.map((item) => item.id)).toEqual([
      "fixture_career",
    ]);
    expect(JSON.stringify(request.current_state)).not.toContain(
      "fixture_career",
    );
    expect(request.prompt_version).toBe("chat_v6");
  });

  it("rejects a reply citing an activity ID that was not in the request", async () => {
    const { response, request } = await chat([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(() => {
      validateChatResponse({ ...response, activity_ids: ["fixture_invented"] }, request);
    }).toThrow(AttributionError);
  });

  it("accepts a reply citing no activity at all", async () => {
    const { response, request } = await chat([
      signal({ id: "fixture_career", domain: "career" }),
    ]);
    expect(() => {
      validateChatResponse({ ...response, activity_ids: [] }, request);
    }).not.toThrow();
  });
});
