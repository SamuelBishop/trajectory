import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../src/engine/domain";
import { ProviderError } from "../../src/engine/errors";
import { chatWithMentor } from "../../src/engine/mentorship";
import { DeterministicProvider } from "../../src/engine/providers/deterministic";
import { mentorDirectory, userDirectory } from "./fixtures";

const directories = { userDirectory, mentorDirectory };
const QUESTION =
  "Should I spend another two hours polishing this low-risk pull request?";

describe("chat orchestration", () => {
  it("includes bounded history", async () => {
    const history: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
      role: "user" as const,
      content: `Earlier message ${index}`,
    }));

    const result = await chatWithMentor(
      QUESTION,
      history,
      new DeterministicProvider(),
      directories,
    );

    expect(result.request.history).toEqual(history);
    expect(result.response.goal_ids).toEqual(["career_001"]);
  });

  it("truncates history beyond the bound", async () => {
    const history: ChatMessage[] = Array.from({ length: 25 }, (_, index) => ({
      role: "user" as const,
      content: `Earlier message ${index}`,
    }));

    const result = await chatWithMentor(
      QUESTION,
      history,
      new DeterministicProvider(),
      directories,
    );

    expect(result.request.history).toHaveLength(20);
    expect(result.request.history[0]?.content).toBe("Earlier message 5");
  });

  it("falls back to priority context but still refuses to improvise", async () => {
    await expect(
      chatWithMentor(
        "What should I focus on this week?",
        [],
        new DeterministicProvider(),
        directories,
      ),
    ).rejects.toThrow(ProviderError);
    await expect(
      chatWithMentor(
        "What should I focus on this week?",
        [],
        new DeterministicProvider(),
        directories,
      ),
    ).rejects.toThrow(/supports only the committed/);
  });
});
