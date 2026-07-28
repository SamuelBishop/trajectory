import { describe, expect, it, vi } from "vitest";

import {
  chunkChatAnswer,
  revealChatAnswer,
} from "../src/main/chat-stream";

describe("chat stream", () => {
  it("reconstructs the validated answer exactly across multiple deltas", async () => {
    const answer =
      "## Recommendation\n\nBuild capacity; do not **perform** it.\n\n- First\n- Second";
    const deltas: string[] = [];
    const wait = vi.fn(async () => undefined);

    await revealChatAnswer(answer, (content) => deltas.push(content), wait);

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(answer);
    expect(wait).toHaveBeenCalledTimes(deltas.length - 1);
  });

  it("does not emit an invented delta for an empty answer", async () => {
    const emit = vi.fn();
    await revealChatAnswer("", emit, async () => undefined);
    expect(emit).not.toHaveBeenCalled();
  });

  it("bounds chunk size for long unbroken tokens", () => {
    const chunks = chunkChatAnswer("x".repeat(1_000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(
      80,
    );
  });
});
