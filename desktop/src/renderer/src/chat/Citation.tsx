/**
 * A cited activity record, as a mark you can hover instead of an id you cannot
 * read.
 *
 * Implements: [HC-BIDIRECTIONAL-ATTRIBUTION], [HC-OBSERVATION-VS-INFERENCE],
 * [SC-NO-PLACEHOLDERS]
 *
 * The mentor cites `[strava_19599421807]`. Printed in the prose that is the
 * least readable thing on the screen and the least useful — a lookup key with
 * nowhere to look it up, which made a trust feature read as debug output.
 *
 * So the id becomes the service's mark, and the record behind it appears on
 * hover: the day it happened and what it was. The claim stays checkable, which
 * was always the point, but checking it is now optional rather than compulsory
 * reading.
 *
 * It is a button, not a decorated span, because a keyboard reaches buttons. The
 * card shows on focus for exactly the same reason it shows on hover.
 */

import { useCallback, useRef, useState } from "react";

import type { Citation } from "../../../shared/types";
import { BrandIcon } from "../ui/BrandIcon";
import { brandFor } from "../today/derive";
import { citationDate } from "./derive";

/** Matches the `bottom`/`top` offset in `.citation-card`. */
const CARD_GAP = 8;

/**
 * Which side of the mark the card can open on without being cut off.
 *
 * The conversation scrolls, and its container clips. A card that opened upward
 * from the first visible line would be sliced in half — the reader would ask
 * for evidence and get the bottom two thirds of it, which is worse than the id
 * this replaced because it looks like a rendering bug rather than a missing
 * feature.
 *
 * Measured on open rather than tracked, because it can only change by scrolling
 * or resizing, and both close the card by moving the pointer off the mark.
 */
export function placementFor(chip: HTMLElement, card: HTMLElement): "above" | "below" {
  const bounds = chip.closest(".messages")?.getBoundingClientRect();
  const top = bounds?.top ?? 0;
  const chipTop = chip.getBoundingClientRect().top;
  return chipTop - card.offsetHeight - CARD_GAP < top ? "below" : "above";
}

function CitationChip({
  citation,
}: {
  readonly citation: Citation;
}): React.JSX.Element {
  // The integration id is the only stable name a record carries. Falling back
  // to it verbatim keeps an unregistered adapter honest — an unnamed source
  // says so, rather than borrowing a nearby brand.
  const { name, brand } = brandFor(citation.integrationId, citation.integrationId);
  const chipRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<"above" | "below">("above");

  const place = useCallback(() => {
    const chip = chipRef.current;
    const card = cardRef.current;
    if (chip !== null && card !== null) setPlacement(placementFor(chip, card));
  }, []);

  return (
    <span className="citation" onMouseEnter={place}>
      <button
        ref={chipRef}
        type="button"
        className="citation-chip"
        onFocus={place}
        // The record itself, so the claim is reachable without a pointing
        // device and without waiting for a hover card to open.
        aria-label={`${name}, ${citationDate(citation.occurredAt)}: ${citation.summary}`}
      >
        <BrandIcon brand={brand} size={11} pad={5} />
      </button>
      <span
        ref={cardRef}
        className={`citation-card citation-card-${placement}`}
        role="presentation"
      >
        <span className="citation-card-head">
          <strong>{name}</strong>
          <span className="citation-card-date">
            {citationDate(citation.occurredAt)}
          </span>
        </span>
        <span className="citation-card-summary">{citation.summary}</span>
        <span className="citation-card-id">{citation.id}</span>
      </span>
    </span>
  );
}

/**
 * One bracketed group of citations, as adjacent marks.
 *
 * One mark per record rather than one per group: the mentor cited four runs,
 * and collapsing them into a single chip would report four records as one.
 */
export function CitationGroup({
  citations,
}: {
  readonly citations: readonly Citation[];
}): React.JSX.Element {
  return (
    <span className="citation-group">
      {citations.map((citation) => (
        <CitationChip key={citation.id} citation={citation} />
      ))}
    </span>
  );
}
