/**
 * The evidence behind one answer, beside the answer itself.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE], [SC-UNCERTAINTY-DECLARED],
 * [HC-BIDIRECTIONAL-ATTRIBUTION], [SC-NO-PLACEHOLDERS]
 *
 * Chat used to hide grounding in a disclosure at the foot of the message, where
 * it read as debug output. It is the opposite: it is the reason to believe the
 * answer, and the route to fixing it when it is wrong. So it stands next to the
 * reply, every count opens the ids behind it, and each id is a control that
 * opens the file it came from.
 *
 * Nothing here is computed by this screen. Counts are lengths of lists the
 * mentor reported, and a list the stored message never carried is left out
 * rather than shown as zero.
 */

import type { Grounding } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { Icon, type IconName } from "../ui/Icon";
import { formatConfidence } from "../today/derive";
import { evidenceCounts } from "./derive";

const ROW_ICON: Readonly<Record<string, IconName>> = {
  goals: "target",
  principles: "diamond",
  activity: "pulse",
  sources: "stack",
};

/** Where each cited id lives, so the chip can open it. */
const ROW_ROUTE: Readonly<Record<string, Route>> = {
  goals: routeTo("context", "goals"),
  principles: routeTo("context", "mentor:principles"),
  sources: routeTo("context", "mentor:sources"),
};

function CountRow({
  row,
  onNavigate,
}: {
  readonly row: { key: string; label: string; ids: readonly string[] };
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  const target = ROW_ROUTE[row.key];
  return (
    <details className="evidence-row">
      <summary>
        <Icon name={ROW_ICON[row.key] ?? "stack"} size={16} />
        <span className="evidence-row-label">
          <strong>{row.ids.length}</strong> {row.label}
        </span>
        <Icon name="chevron" size={15} />
      </summary>
      {row.ids.length === 0 ? (
        <p className="evidence-empty">
          The mentor cited none for this answer.
        </p>
      ) : (
        <div className="evidence-links">
          {row.ids.map((id) =>
            target === undefined ? (
              <span key={id} className="chip">
                {id}
              </span>
            ) : (
              <button
                key={id}
                type="button"
                className="chip chip-link"
                onClick={() => onNavigate(target)}
              >
                {id}
              </button>
            ),
          )}
        </div>
      )}
    </details>
  );
}

function List({
  title,
  note,
  items,
}: {
  readonly title: string;
  readonly note: string;
  readonly items: readonly string[];
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <section className="evidence-block">
      <h3>{title}</h3>
      <p className="evidence-note">{note}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function EvidenceSidebar({
  grounding,
  mentorName,
  mentorDisclaimer,
  onNavigate,
}: {
  readonly grounding: Grounding | null;
  readonly mentorName: string;
  readonly mentorDisclaimer: string;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  return (
    <aside className="evidence-pane">
      {grounding === null ? (
        <section className="evidence-block">
          <h3>Evidence</h3>
          <p className="evidence-note">
            Every answer records the goals, principles, activity and sources it
            was built from. They appear here once the mentor replies.
          </p>
        </section>
      ) : (
        <>
          <header className="evidence-head">
            <h3>Evidence</h3>
            <span className="chip chip-good">
              {formatConfidence(grounding.confidence)} confidence
            </span>
          </header>

          <div className="evidence-rows">
            {evidenceCounts(grounding).map((row) => (
              <CountRow key={row.key} row={row} onNavigate={onNavigate} />
            ))}
          </div>

          <List
            title="What it saw"
            note="Records, not conclusions."
            items={grounding.observations ?? []}
          />
          <List
            title="What it concluded"
            note="You can disagree with this without doubting what it saw."
            items={grounding.inferences ?? []}
          />
          <List
            title="Uncertainties"
            note="Named by the mentor, not inferred here."
            items={grounding.uncertainties}
          />
        </>
      )}

      <section className="evidence-block mentor-block">
        <h3>Mentor</h3>
        <button
          type="button"
          className="mentor-row"
          onClick={() => onNavigate(routeTo("context", "mentor:profile"))}
        >
          <span className="mentor-mark">{mentorName.slice(0, 1)}</span>
          <span className="mentor-row-text">
            <strong>{mentorName}</strong>
            {mentorDisclaimer && <span>{mentorDisclaimer}</span>}
          </span>
          <Icon name="chevron" size={15} />
        </button>
      </section>
    </aside>
  );
}
