/**
 * Who is answering, and three counts that are actually true.
 *
 * Implements: [HC-MENTOR-IDENTITY-INTEGRITY]
 *
 * The mentor's name and disclaimer sit here rather than only in Settings,
 * because the person reading a verdict about their own week should be able to
 * see, without navigating, whose principles produced it and what that mentor
 * does not claim to be.
 *
 * No quote. The only quotable mentor text this app holds is the voice profile's
 * examples, which exist to demonstrate cadence and say so — attributing one to
 * the mentor as advice would be putting words in the mouth of a named person.
 */

import type { MentorSummary } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { Metric } from "../ui/Card";
import { Icon } from "../ui/Icon";

export function MomentumStrip({
  mentor,
  streak,
  priorityCount,
  activeGoals,
  onNavigate,
}: {
  readonly mentor: MentorSummary | null;
  readonly streak: number;
  readonly priorityCount: number;
  /** Null when the goals file could not be read, so the tile says nothing. */
  readonly activeGoals: number | null;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  return (
    <section className="momentum">
      <div className="momentum-mentor">
        <strong>{mentor?.name ?? "No mentor selected"}</strong>
        <span>
          {mentor?.disclaimer ??
            "Choose a mentor in Context before relying on a briefing."}
        </span>
      </div>

      <div className="momentum-metrics">
        <Metric value={String(streak)} label="Day streak" />
        <Metric value={String(priorityCount)} label="Priorities today" />
        {activeGoals !== null && (
          <Metric value={String(activeGoals)} label="Active goals" />
        )}
      </div>

      <button
        type="button"
        className="primary"
        onClick={() => onNavigate(routeTo("chat"))}
      >
        <Icon name="chat" size={16} />
        Open chat
      </button>
    </section>
  );
}
