/**
 * That a citation actually reaches the screen as a mark.
 *
 * Everything cited here is invented ([HC-NO-PRIVATE-DATA-COMMITS]).
 *
 * `splitCitations` is tested on its own, but it only decides *what* to swap.
 * The substitution itself walks the tree react-markdown produced, and that walk
 * is where a citation would silently stay as text — the splitter would keep
 * passing while the screen kept showing `[strava_1]`. So this renders the real
 * component and reads the output.
 *
 * Static markup rather than a DOM: the questions here are all about what was
 * produced, and nothing on this path depends on layout or events.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Message } from "../src/renderer/src/chat/Message";
import { placementFor } from "../src/renderer/src/chat/Citation";
import type { ChatMessage, Citation, Grounding } from "../src/shared/types";

const CITATION: Citation = {
  id: "strava_1",
  integrationId: "strava",
  occurredAt: "2026-08-04",
  summary: "Easy run, 4 mi",
  url: null,
};

function grounding(citations: Citation[]): Grounding {
  return {
    goalIds: [],
    principleIds: [],
    sourceIds: [],
    activityIds: citations.map((citation) => citation.id),
    citations,
    confidence: 0.8,
    uncertainties: [],
  };
}

function render(content: string, citations: Citation[] = [CITATION]): string {
  const message: ChatMessage = {
    id: "m1",
    role: "assistant",
    content,
    createdAt: "2026-08-05T12:00:00.000Z",
    grounding: grounding(citations),
  };
  return renderToStaticMarkup(
    <Message
      message={message}
      youMark="S"
      selected={false}
      onSelect={() => undefined}
    />,
  );
}

describe("Message citations", () => {
  it("replaces the bracketed id with a mark", () => {
    const html = render("You ran 4 mi [strava_1].");

    expect(html).toContain("citation-chip");
    expect(html).not.toContain("[strava_1]");
  });

  it("puts the date and the record on the hover card", () => {
    const html = render("You ran 4 mi [strava_1].");

    expect(html).toContain("Easy run, 4 mi");
    expect(html).toContain("2026");
    expect(html).toContain("Strava");
  });

  it("keeps the id reachable for quoting back when something is wrong", () => {
    expect(render("You ran 4 mi [strava_1].")).toContain("strava_1");
  });

  it("substitutes inside a list item, not only a paragraph", () => {
    const html = render("- Monday [strava_1]\n- Tuesday off");

    expect(html).toContain("citation-chip");
    expect(html).not.toContain("[strava_1]");
  });

  it("substitutes inside emphasis, which nests below the paragraph", () => {
    const html = render("You ran **4 mi [strava_1]** already.");

    expect(html).not.toContain("[strava_1]");
  });

  it("leaves an id inside code exactly as the mentor wrote it", () => {
    // Inside a code span the id is being shown, not cited. Turning it into a
    // control would misrepresent the text.
    expect(render("The record is `[strava_1]` verbatim.")).toContain(
      "[strava_1]",
    );
  });

  it("leaves the text alone when the message carried no citations", () => {
    const html = render("You ran 4 mi [strava_1].", []);

    expect(html).toContain("[strava_1]");
    expect(html).not.toContain("citation-chip");
  });

  it("renders one mark per cited record, not one per group", () => {
    const second: Citation = {
      id: "strava_2",
      integrationId: "strava",
      occurredAt: "2026-08-01",
      summary: "Long run, 6.02 mi",
      url: null,
    };
    const html = render("Two runs [strava_1, strava_2].", [CITATION, second]);

    expect(html.split("citation-chip").length - 1).toBe(2);
  });

  it("names the record in the button label, so a keyboard reaches it", () => {
    expect(render("You ran 4 mi [strava_1].")).toContain(
      "aria-label=\"Strava, Aug 4, 2026: Easy run, 4 mi\"",
    );
  });
});

describe("placementFor", () => {
  /**
   * The measurements a real chip and card would report. Faked because the
   * question is arithmetic — "does the card fit above the mark" — and a real
   * layout would only make the answer harder to read.
   */
  function elements(chipTop: number, cardHeight: number, containerTop = 0) {
    const container = {
      getBoundingClientRect: () => ({ top: containerTop }) as DOMRect,
    };
    const chip = {
      closest: () => container,
      getBoundingClientRect: () => ({ top: chipTop }) as DOMRect,
    } as unknown as HTMLElement;
    const card = { offsetHeight: cardHeight } as HTMLElement;
    return [chip, card] as const;
  }

  it("opens upward when the card fits above the mark", () => {
    expect(placementFor(...elements(300, 86))).toBe("above");
  });

  it("opens downward when the scroll container would cut the card off", () => {
    // The case that matters: a citation on the first visible line. Upward, the
    // reader would be shown the bottom two thirds of the evidence.
    expect(placementFor(...elements(16, 86))).toBe("below");
  });

  it("measures against the scroll container, not the window", () => {
    // 300px down the window is still the top line when the conversation starts
    // 290px down, which is where the header and rail leave it.
    expect(placementFor(...elements(300, 86, 290))).toBe("below");
  });

  it("respects the gap the stylesheet leaves between mark and card", () => {
    // Exactly the card plus the gap fits; one pixel less does not.
    expect(placementFor(...elements(94, 86))).toBe("above");
    expect(placementFor(...elements(93, 86))).toBe("below");
  });
});

describe("Message citations the prose never names", () => {
  it("still shows a mark for every cited record", () => {
    // The answer the user actually got: four records cited in `activity_ids`,
    // none named in the sentence. Before this, the evidence simply vanished.
    const second: Citation = {
      id: "strava_2",
      integrationId: "strava",
      occurredAt: "2026-08-01",
      summary: "Long run, 6.02 mi",
      url: null,
    };
    const html = render("You've run 14.35 mi this week across 4 runs.", [
      CITATION,
      second,
    ]);

    expect(html).toContain("citation-row");
    expect(html.split("citation-chip").length - 1).toBe(2);
    expect(html).toContain("Long run, 6.02 mi");
  });

  it("does not repeat a record the prose already named", () => {
    const html = render("You ran 4 mi [strava_1].");

    expect(html).not.toContain("citation-row");
    expect(html.split("citation-chip").length - 1).toBe(1);
  });

  it("shows no row at all when the answer cited no activity", () => {
    expect(render("Nothing to report.", [])).not.toContain("citation-row");
  });
});
