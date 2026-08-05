/**
 * The conversation list's dates and the evidence panel's counts.
 *
 * These are the only parts of the chat pane that state something the user
 * cannot immediately verify by reading the screen, so they are the parts under
 * test.
 */

import { describe, expect, it } from "vitest";

import {
  conversationStamp,
  evidenceCounts,
  groupConversations,
} from "../src/renderer/src/chat/derive";
import type {
  ConversationSummary,
  Grounding,
} from "../src/shared/types";

const NOW = new Date(2026, 7, 4, 16, 32);

function summary(id: string, updatedAt: string): ConversationSummary {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    messageCount: 2,
  };
}

function grounding(overrides: Partial<Grounding> = {}): Grounding {
  return {
    goalIds: ["goal_a", "goal_b"],
    principleIds: ["principle_a"],
    sourceIds: ["source_a", "source_b", "source_c"],
    confidence: 0.86,
    uncertainties: ["No sentiment data."],
    ...overrides,
  };
}

describe("conversationStamp", () => {
  it("shows a clock time for today", () => {
    const stamp = conversationStamp(new Date(2026, 7, 4, 9, 5).toISOString(), NOW);
    expect(stamp).toMatch(/9[:.]05/);
  });

  it("names yesterday rather than counting hours", () => {
    // 20 hours earlier, but a different calendar day: the user thinks in days.
    expect(
      conversationStamp(new Date(2026, 7, 3, 20, 0).toISOString(), NOW),
    ).toBe("Yesterday");
  });

  it("uses a weekday inside the last week", () => {
    expect(
      conversationStamp(new Date(2026, 7, 1, 12, 0).toISOString(), NOW),
    ).toBe(
      new Date(2026, 7, 1).toLocaleDateString(undefined, { weekday: "short" }),
    );
  });

  it("falls back to a date once a weekday would be ambiguous", () => {
    expect(
      conversationStamp(new Date(2026, 6, 20, 12, 0).toISOString(), NOW),
    ).toBe(
      new Date(2026, 6, 20).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  });

  it("returns null rather than an invalid date", () => {
    expect(conversationStamp("not a timestamp", NOW)).toBeNull();
  });
});

describe("groupConversations", () => {
  it("orders by last activity, newest first", () => {
    const groups = groupConversations(
      [
        summary("older", new Date(2026, 7, 2, 9, 0).toISOString()),
        summary("newest", new Date(2026, 7, 4, 9, 0).toISOString()),
        summary("middle", new Date(2026, 7, 3, 9, 0).toISOString()),
      ],
      NOW,
    );
    expect(groups.recent.map((item) => item.id)).toEqual([
      "newest",
      "middle",
      "older",
    ]);
    expect(groups.earlier).toEqual([]);
  });

  it("splits anything older than the last seven days into earlier", () => {
    const groups = groupConversations(
      [
        summary("this-week", new Date(2026, 6, 30, 9, 0).toISOString()),
        summary("last-month", new Date(2026, 6, 2, 9, 0).toISOString()),
      ],
      NOW,
    );
    expect(groups.recent.map((item) => item.id)).toEqual(["this-week"]);
    expect(groups.earlier.map((item) => item.id)).toEqual(["last-month"]);
  });

  it("does not claim an unreadable timestamp is from this week", () => {
    const groups = groupConversations([summary("broken", "nonsense")], NOW);
    expect(groups.recent).toEqual([]);
    expect(groups.earlier.map((item) => item.id)).toEqual(["broken"]);
  });
});

describe("evidenceCounts", () => {
  it("counts what the answer cited", () => {
    const rows = evidenceCounts(
      grounding({ activityIds: ["activity_a", "activity_b"] }),
    );
    expect(rows.map((row) => [row.label, row.ids.length])).toEqual([
      ["Goals", 2],
      ["Principles", 1],
      ["Activity records", 2],
      ["Sources", 3],
    ]);
  });

  it("keeps a real zero", () => {
    const rows = evidenceCounts(grounding({ activityIds: [] }));
    expect(rows.find((row) => row.key === "activity")?.ids).toEqual([]);
  });

  it("omits the row entirely when the message never recorded it", () => {
    // Messages stored before activity ids were kept must not be reported as
    // having cited no activity: that is a claim the record does not support.
    const rows = evidenceCounts(grounding());
    expect(rows.some((row) => row.key === "activity")).toBe(false);
  });
});
