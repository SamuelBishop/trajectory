import { describe, expect, it } from "vitest";

import { loadMentorResources, loadUserConfig } from "../../src/engine/config";
import { InsufficientContextError } from "../../src/engine/errors";
import {
  selectGoals,
  selectPrinciples,
  selectSources,
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
});
