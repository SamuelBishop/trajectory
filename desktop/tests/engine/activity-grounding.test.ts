import { describe, expect, it } from "vitest";

import type { ActivitySignal, DecisionRequest } from "../../src/engine/domain";
import { AttributionError } from "../../src/engine/errors";
import { chatWithMentor, reviewDecision } from "../../src/engine/mentorship";
import {
  ACTIVITY_SIGNAL_LIMIT,
  buildActivityContext,
  selectActivitySignals,
} from "../../src/engine/selection";
import { buildUserMessage } from "../../src/engine/prompting";
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

describe("activity selection", () => {
  it("selects no signals when nothing matches, and sends null", async () => {
    const unrelated = signal({
      id: "fixture_unrelated",
      domain: "gardening",
      summary: "Repotted the seedlings",
    });
    expect(selectActivitySignals(question, goals, [unrelated])).toEqual([]);
    expect(buildActivityContext(question, goals, [unrelated], today)).toBeNull();
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

  it("summarizes the whole window, not only the signals it selected", () => {
    // Selection caps at a dozen; the rollup still counts everything stored, or
    // a streak would become an artifact of selection rather than of behavior.
    const many = Array.from({ length: 20 }, (_, index) =>
      signal({
        id: `fixture_${String(index).padStart(2, "0")}`,
        domain: "career",
        occurred_at: `2026-03-${String((index % 10) + 1).padStart(2, "0")}`,
      }),
    );
    const context = buildActivityContext(question, goals, many, today);
    expect(context?.signals).toHaveLength(ACTIVITY_SIGNAL_LIMIT);
    expect(context?.rollups[0]?.signal_count).toBe(20);
  });

  it("emits one rollup per contributing integration", () => {
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
    expect(context?.rollups.map((item) => item.integration_id)).toEqual([
      "alpha",
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
    expect(request.prompt_version).toBe("decision_v5");
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

  it("keeps observations and inferences in separate fields when activity is present", async () => {
    const { recommendation, request } = await demoResult([
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
    expect(request.prompt_version).toBe("chat_v5");
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
