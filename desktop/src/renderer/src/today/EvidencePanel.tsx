/**
 * The evidence behind one briefing.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE], [SC-UNCERTAINTY-DECLARED],
 * [HC-BIDIRECTIONAL-ATTRIBUTION]
 *
 * Grounding used to read as debug output at the bottom of a card — a sentence
 * counting ids. It is not debug output; it is the reason to believe the
 * briefing, and the fastest route to correcting it when it is wrong. So it is a
 * disclosure the user opens deliberately, the reading and the reasoning stay in
 * separate labelled regions, and every cited goal and principle is a control
 * that opens the file it came from.
 *
 * Closed by default because the daily loop is meant to take two minutes. A user
 * who accepts today's answer should not have to scroll past its footnotes.
 */

import type { BriefingView } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { Disclosure } from "../ui/Card";
import { countLabel, formatConfidence } from "./derive";

type Briefing = NonNullable<BriefingView["briefing"]>;

function Section({
  title,
  note,
  items,
  empty,
}: {
  readonly title: string;
  readonly note: string;
  readonly items: readonly string[];
  readonly empty: string;
}): React.JSX.Element {
  return (
    <div className="evidence-section">
      <h4>{title}</h4>
      <p className="evidence-note">{note}</p>
      {items.length === 0 ? (
        <p className="evidence-empty">{empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidencePanel({
  briefing,
  onNavigate,
}: {
  readonly briefing: Briefing;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  return (
    <Disclosure summary="Evidence and uncertainty">
      <div className="evidence">
        <Section
          title="What it read"
          note="Your configuration and the records your sources reported."
          items={briefing.observations}
          empty="No observations were recorded for this briefing."
        />

        <p className="evidence-count">
          Drawn from{" "}
          {countLabel(briefing.activity_ids.length, "observed record")} across
          your connected sources.
        </p>

        <Section
          title="What it concluded"
          note="The mentor's reasoning. You can disagree with this without doubting what it read."
          items={briefing.inferences}
          empty="No reasoning was recorded for this briefing."
        />

        <Section
          title="What it could not see"
          note="Named by the mentor, not inferred by this screen."
          items={briefing.uncertainties}
          empty="Nothing was declared uncertain, which on a consequential day is a smell rather than a strength."
        />

        <div className="evidence-section">
          <h4>Grounded in</h4>
          <p className="evidence-note">
            Open any of these to change what the next briefing is built from.
          </p>
          <div className="evidence-links">
            {briefing.goal_ids.map((id) => (
              <button
                key={`goal:${id}`}
                type="button"
                className="chip chip-link"
                onClick={() => onNavigate(routeTo("context", "goals"))}
              >
                {id}
              </button>
            ))}
            {briefing.principle_ids.map((id) => (
              <button
                key={`principle:${id}`}
                type="button"
                className="chip chip-link"
                onClick={() =>
                  onNavigate(routeTo("context", "mentor:principles"))
                }
              >
                {id}
              </button>
            ))}
            {briefing.source_ids.map((id) => (
              <button
                key={`source:${id}`}
                type="button"
                className="chip chip-link"
                onClick={() => onNavigate(routeTo("context", "mentor:sources"))}
              >
                {id}
              </button>
            ))}
          </div>
          <p className="evidence-count">
            Confidence {formatConfidence(briefing.confidence)}, reported by the
            mentor.
          </p>
        </div>
      </div>
    </Disclosure>
  );
}
