import { rm } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { chatWithMentor, reviewDecision } from "../../src/engine/mentorship";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import { copyFixture, mentorDirectory, userDirectory } from "./fixtures";

const question =
  "Should I spend another two hours polishing this low-risk pull request?";

describe("voice runtime context", () => {
  it("adds compact voice context to versioned decision and chat requests", async () => {
    const directories = { userDirectory, mentorDirectory };
    const decision = await reviewDecision(
      question,
      new DeterministicProvider(),
      directories,
    );
    const chat = await chatWithMentor(
      question,
      [],
      new DeterministicProvider(),
      directories,
    );

    expect(decision.request.prompt_version).toBe("decision_v5");
    expect(chat.request.prompt_version).toBe("chat_v5");
    expect(decision.request.voice_context?.examples.length).toBeLessThanOrEqual(2);
    expect(chat.request.voice_context?.patterns).toHaveLength(1);
    expect(chat.request.voice_context?.avoid).toContain("invented evidence");
    expect(JSON.stringify(chat.request.voice_context)).not.toContain(
      "quality_tradeoff",
    );
  });

  it("preserves existing behavior when voice.yaml is absent", async () => {
    const copiedMentor = await copyFixture(mentorDirectory, "mentor");
    await rm(path.join(copiedMentor, "voice.yaml"));

    const result = await reviewDecision(
      question,
      new DeterministicProvider(),
      { userDirectory, mentorDirectory: copiedMentor },
    );

    expect(result.request.voice_context).toBeNull();
    expect(result.recommendation.assessment).toBe(
      "stop_after_correctness_checks",
    );
  });
});
