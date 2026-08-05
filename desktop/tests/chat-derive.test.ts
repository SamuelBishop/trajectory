/**
 * The conversation list's dates and the evidence panel's counts.
 *
 * These are the only parts of the chat pane that state something the user
 * cannot immediately verify by reading the screen, so they are the parts under
 * test.
 */

import { describe, expect, it } from "vitest";

import {
  citationDate,
  conversationStamp,
  evidenceCounts,
  groupConversations,
  splitCitations,
  unreferencedCitations,
} from "../src/renderer/src/chat/derive";
import type {
  Citation,
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

/**
 * Every id and summary below is invented ([HC-NO-PRIVATE-DATA-COMMITS]).
 *
 * The splitter is under test because both of its failure modes are invisible on
 * screen. Eating a bracket the user typed looks like markdown; missing a
 * citation looks like the mentor not citing one.
 */
function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    id: "strava_1",
    integrationId: "strava",
    occurredAt: "2026-08-04",
    summary: "Easy run, 4 mi",
    url: null,
    ...overrides,
  };
}

const CITED = [
  citation(),
  citation({ id: "strava_2", occurredAt: "2026-08-01", summary: "Long run, 6.02 mi" }),
];

describe("splitCitations", () => {
  it("lifts a bracketed id out of the prose", () => {
    expect(splitCitations("You ran 4 mi [strava_1].", CITED)).toEqual([
      { kind: "text", text: "You ran 4 mi " },
      { kind: "citation", citations: [CITED[0]] },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps a group of ids as one segment of many marks", () => {
    const segments = splitCitations("Two runs [strava_1, strava_2]", CITED);

    expect(segments).toHaveLength(2);
    expect(segments[1]).toEqual({ kind: "citation", citations: CITED });
  });

  it("leaves a group alone when any id in it is unaccounted for", () => {
    // Dropping the unknown id would show two marks where the mentor cited
    // three, which reads as a narrower claim than the one it made.
    const text = "Three runs [strava_1, strava_2, strava_missing]";

    expect(splitCitations(text, CITED)).toEqual([{ kind: "text", text }]);
  });

  it("leaves ordinary bracketed prose exactly as written", () => {
    for (const text of [
      "A caveat [see below] applies.",
      "Read the [docs](https://example.invalid) first.",
      "An array literal [1, 2, 3] is not a citation.",
    ]) {
      expect(splitCitations(text, CITED)).toEqual([{ kind: "text", text }]);
    }
  });

  it("returns the text untouched when the message cited nothing", () => {
    const text = "You ran 4 mi [strava_1].";

    expect(splitCitations(text, [])).toEqual([{ kind: "text", text }]);
  });

  it("does not carry state between calls", () => {
    // The pattern is global, so a shared `lastIndex` would make the second
    // call start reading halfway through its own input.
    const text = "First [strava_1] and second [strava_2]";
    const once = splitCitations(text, CITED);

    expect(splitCitations(text, CITED)).toEqual(once);
    expect(once.filter((segment) => segment.kind === "citation")).toHaveLength(2);
  });

  it("handles a citation that opens or closes the run", () => {
    expect(splitCitations("[strava_1] opened it", CITED)[0]?.kind).toBe(
      "citation",
    );
    expect(splitCitations("closed it [strava_1]", CITED)).toHaveLength(2);
  });
});

describe("citationDate", () => {
  it("always names the year", () => {
    // An answer can be re-read a year later, and "Aug 4" beside a date from
    // another year is checkable-looking and not checkable.
    expect(citationDate("2026-08-04")).toContain("2026");
  });

  it("reads the date as written rather than shifting it by timezone", () => {
    expect(citationDate("2026-08-04")).toContain("4");
  });

  it("shows an unparseable date verbatim rather than 'Invalid Date'", () => {
    expect(citationDate("not-a-date")).toBe("not-a-date");
  });
});

describe("unreferencedCitations", () => {
  it("returns every record when the answer names none of them", () => {
    // The common case, and the one that made the marks disappear: the mentor's
    // contract is to cite in `activity_ids`, not in the sentence.
    const answer = "You've run 14.35 mi this week across 4 runs.";

    expect(unreferencedCitations(answer, CITED)).toEqual(CITED);
  });

  it("returns nothing when the answer named them all inline", () => {
    expect(
      unreferencedCitations("Two runs [strava_1, strava_2]", CITED),
    ).toEqual([]);
  });

  it("returns only the ones the prose left out", () => {
    // A record must never be both referenced and unreferenced, or it would get
    // two marks and read as two records.
    expect(unreferencedCitations("One run [strava_1]", CITED)).toEqual([
      CITED[1],
    ]);
  });

  it("does not treat an unresolved group as a reference", () => {
    // The group stays as text because one id is unaccounted for, so neither of
    // the records it does name has been shown to the reader yet.
    const answer = "Three runs [strava_1, strava_2, strava_missing]";

    expect(unreferencedCitations(answer, CITED)).toEqual(CITED);
  });

  it("returns nothing when the message cited nothing", () => {
    expect(unreferencedCitations("No activity was involved.", [])).toEqual([]);
  });
});
