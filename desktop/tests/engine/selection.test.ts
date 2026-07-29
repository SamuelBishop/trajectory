import { describe, expect, it } from "vitest";

import { loadMentorResources, loadUserConfig } from "../../src/engine/config";
import { InsufficientContextError } from "../../src/engine/errors";
import {
  buildVoiceContext,
  selectGoals,
  selectPrinciples,
  selectSources,
  selectVoiceDepth,
  selectVoiceExamples,
} from "../../src/engine/selection";
import { mentorDirectory, userDirectory } from "./fixtures";

describe("grounding selection", () => {
  it("selects grounding deterministically", async () => {
    const user = await loadUserConfig(userDirectory);
    const resources = await loadMentorResources(mentorDirectory);
    const question = "Should I keep polishing this pull request?";

    const goals = selectGoals(question, user);
    const principles = selectPrinciples(question, goals, resources);
    const sources = selectSources(principles, resources);

    expect(goals.map((goal) => goal.id)).toEqual(["career_001"]);
    expect(principles.map((principle) => principle.id)).toEqual([
      "demo_opportunity_cost_001",
    ]);
    expect(sources.map((source) => source.id)).toEqual(["demo_source_001"]);
  });

  it("fails when no goal matches", async () => {
    const user = await loadUserConfig(userDirectory);

    expect(() => selectGoals("Should I buy a telescope?", user)).toThrow(
      InsufficientContextError,
    );
    expect(() => selectGoals("Should I buy a telescope?", user)).toThrow(
      /No active goal matched/,
    );
  });

  it("fails when no principle matches the selected goals", async () => {
    const user = await loadUserConfig(userDirectory);
    const resources = await loadMentorResources(mentorDirectory);
    const goals = selectGoals("Should I keep polishing this pull request?", user);

    expect(() =>
      selectPrinciples("astronomy telescope aperture", goals, {
        ...resources,
        principles: [],
      }),
    ).toThrow(/No mentor principle matched/);
  });

  it("selects response-relevant voice examples deterministically", async () => {
    const resources = await loadMentorResources(mentorDirectory);
    const voice = resources.voice;
    expect(voice).toBeDefined();
    if (!voice) {
      throw new Error("The demo voice fixture is missing.");
    }

    const selected = selectVoiceExamples(
      "Should I keep polishing for quality?",
      [],
      [],
      voice,
    );

    expect(selected.map((example) => example.id)).toEqual(["quality_tradeoff"]);
  });

  it("omits irrelevant examples and never returns more than two", async () => {
    const resources = await loadMentorResources(mentorDirectory);
    const voice = resources.voice;
    expect(voice).toBeDefined();
    if (!voice) {
      throw new Error("The demo voice fixture is missing.");
    }

    const irrelevant = selectVoiceExamples("quasar telescope", [], [], voice, 10);
    const matched = selectVoiceExamples(
      "quality polish engineering action decision reversible",
      [],
      [],
      voice,
      10,
    );

    expect(irrelevant).toEqual([]);
    expect(matched).toHaveLength(2);
  });

  it("selects brief, standard, and deep response profiles deterministically", () => {
    expect(selectVoiceDepth("Should I ship this?")).toBe("brief");
    expect(
      selectVoiceDepth(
        "I need a clear answer about this decision because several constraints now conflict and the team needs direction soon",
      ),
    ).toBe("standard");
    expect(selectVoiceDepth("Compare the research evidence for both options.")).toBe(
      "deep",
    );
  });

  it("builds compact context with tone, avoid rules, and selected guidance", async () => {
    const resources = await loadMentorResources(mentorDirectory);
    const voice = resources.voice;
    expect(voice).toBeDefined();
    if (!voice) {
      throw new Error("The demo voice fixture is missing.");
    }
    const context = buildVoiceContext(
      "Should I keep polishing for quality?",
      [],
      [],
      voice,
    );
    const serialized = JSON.stringify(context);

    expect(context.examples).toHaveLength(1);
    expect(context.depth).toBe("brief");
    expect(context.tone).toContain("direct");
    expect(context.avoid).toContain("invented evidence");
    expect(serialized).not.toContain("source_ids");
    expect(serialized).not.toContain("Run the smallest correctness check");
    expect(context.patterns).toEqual([
      {
        id: "explicit_tradeoff",
        strength: "very_high",
        instruction:
          "Name what additional effort would displace before deciding whether the effort is justified.",
      },
    ]);
  });
});
