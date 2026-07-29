import { describe, expect, it } from "vitest";

import { ProviderResponseError } from "../../src/engine/errors";
import { parseRecommendation } from "../../src/engine/prompting";

function validRecommendation(): Record<string, unknown> {
  return {
    assessment: "redirect",
    response: "Stop polishing.",
    why_now: "The alternative is more valuable.",
    goal_ids: ["career_001"],
    principle_ids: ["demo_opportunity_cost_001"],
    source_ids: ["demo_source_001"],
    activity_ids: [],
    observations: ["The pull request is described as low risk."],
    inferences: ["More polish may be perfectionism."],
    alternatives_considered: ["Keep polishing.", "Submit after a short check."],
    suggested_next_step: "Run the checklist and submit.",
    confidence: 0.7,
    uncertainties: ["Unreported risk may exist."],
  };
}

describe("structured response parsing", () => {
  it("parses plain and fenced JSON", () => {
    const raw = JSON.stringify(validRecommendation());

    expect(parseRecommendation(raw).assessment).toBe("redirect");
    expect(parseRecommendation(`\`\`\`json\n${raw}\n\`\`\``).assessment).toBe(
      "redirect",
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseRecommendation("not json")).toThrow(ProviderResponseError);
    expect(() => parseRecommendation("not json")).toThrow(/invalid JSON/);
  });

  it("rejects out-of-range confidence", () => {
    const raw = { ...validRecommendation(), confidence: 1.1 };

    expect(() => parseRecommendation(JSON.stringify(raw))).toThrow(
      /schema validation/,
    );
  });

  it("rejects an unknown extra field", () => {
    const raw = { ...validRecommendation(), sneaky: "value" };

    expect(() => parseRecommendation(JSON.stringify(raw))).toThrow(
      /schema validation/,
    );
  });

  it("rejects a response with no uncertainty", () => {
    const raw = { ...validRecommendation(), uncertainties: [] };

    expect(() => parseRecommendation(JSON.stringify(raw))).toThrow(
      /schema validation/,
    );
  });
});
