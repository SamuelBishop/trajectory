import { describe, expect, it } from "vitest";

import type { DecisionRequest } from "../../src/engine/domain";
import { AttributionError } from "../../src/engine/errors";
import { reviewDecision } from "../../src/engine/mentorship";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import { validateRecommendation } from "../../src/engine/validation";
import { mentorDirectory, userDirectory } from "./fixtures";

const directories = { userDirectory, mentorDirectory };
const question =
  "Should I spend another two hours polishing this low-risk pull request?";

async function demoResult() {
  return await reviewDecision(question, new DeterministicProvider(), directories);
}

/** Add a second principle backed by its own second source. */
function expand(request: DecisionRequest): DecisionRequest {
  return {
    ...request,
    principles: [
      ...request.principles,
      {
        ...request.principles[0]!,
        id: "demo_opportunity_cost_002",
        source_ids: ["demo_source_002"],
      },
    ],
    sources: [
      ...request.sources,
      { ...request.sources[0]!, id: "demo_source_002" },
    ],
  };
}

describe("attribution validation", () => {
  it("accepts resolved attribution", async () => {
    const { recommendation, request } = await demoResult();

    expect(() => validateRecommendation(recommendation, request)).not.toThrow();
  });

  it("rejects an unknown citation", async () => {
    const { recommendation, request } = await demoResult();

    expect(() =>
      validateRecommendation(
        { ...recommendation, source_ids: ["invented_source"] },
        request,
      ),
    ).toThrow(/unknown sources: invented_source/);
  });

  it("preserves observation and inference fields", async () => {
    const { recommendation } = await demoResult();

    expect(recommendation.observations[0]).toContain("asked");
    expect(recommendation.inferences[0]).toContain("may be perfectionism");
  });

  it("accepts independently sourced principles", async () => {
    const { recommendation, request } = await demoResult();
    const expanded = expand(request);

    expect(() =>
      validateRecommendation(
        {
          ...recommendation,
          principle_ids: [
            "demo_opportunity_cost_001",
            "demo_opportunity_cost_002",
          ],
          source_ids: ["demo_source_001", "demo_source_002"],
        },
        expanded,
      ),
    ).not.toThrow();
  });

  it("rejects a principle with no cited support", async () => {
    const { recommendation, request } = await demoResult();
    const expanded = expand(request);

    expect(() =>
      validateRecommendation(
        {
          ...recommendation,
          principle_ids: [
            "demo_opportunity_cost_001",
            "demo_opportunity_cost_002",
          ],
        },
        expanded,
      ),
    ).toThrow(/have no cited supporting source/);
  });

  it("rejects a source not linked to a cited principle", async () => {
    const { recommendation, request } = await demoResult();
    const expanded: DecisionRequest = {
      ...request,
      sources: [
        ...request.sources,
        { ...request.sources[0]!, id: "demo_source_002" },
      ],
    };

    expect(() =>
      validateRecommendation(
        { ...recommendation, source_ids: ["demo_source_001", "demo_source_002"] },
        expanded,
      ),
    ).toThrow(AttributionError);
    expect(() =>
      validateRecommendation(
        { ...recommendation, source_ids: ["demo_source_001", "demo_source_002"] },
        expanded,
      ),
    ).toThrow(/not linked to a cited principle/);
  });
});
