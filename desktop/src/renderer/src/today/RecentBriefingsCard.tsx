/**
 * The last few days, side by side.
 *
 * Implements: [SC-UNCERTAINTY-DECLARED]
 *
 * A briefing read alone is an opinion; three days of "mostly on track" about
 * the same goal is the signal. That drift is invisible when each day is its own
 * conversation, which is why this list sits next to today's verdict rather than
 * behind a menu.
 */

import type { BriefingView } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import {
  formatClock,
  formatConfidence,
  formatDate,
  ON_TRACK_LABEL,
  onTrackHealth,
} from "./derive";

const SHOWN = 5;

export function RecentBriefingsCard({
  records,
  today,
  selectedDate,
  onSelect,
  onNavigate,
}: {
  readonly records: readonly BriefingView[];
  readonly today: string;
  readonly selectedDate: string | null;
  readonly onSelect: (date: string) => void;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader
        title="Recent briefings"
        action={
          <span className="card-action muted">
            <Icon name="calendar" size={15} />
            90-day history
          </span>
        }
      />

      {records.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <div className="briefing-rows">
          {records.slice(0, SHOWN).map((record) => {
            const clock = formatClock(record.generatedAt);
            const summary =
              record.briefing === null
                ? (record.error ?? "Did not finish")
                : `${
                    ON_TRACK_LABEL[record.briefing.on_track] ??
                    record.briefing.on_track
                  } · Confidence ${formatConfidence(record.briefing.confidence)}`;
            return (
              <button
                key={record.date}
                type="button"
                className={`briefing-row ${
                  record.date === selectedDate ? "active" : ""
                }`}
                aria-current={record.date === selectedDate ? "true" : undefined}
                onClick={() => onSelect(record.date)}
              >
                <span className="briefing-row-main">
                  <span className="briefing-row-date">
                    {formatDate(record.date, today, "short")}
                  </span>
                  <span
                    className={`briefing-row-summary verdict-${
                      record.briefing === null
                        ? "bad"
                        : onTrackHealth(record.briefing.on_track)
                    }`}
                  >
                    {summary}
                  </span>
                </span>
                {clock !== null && <span className="muted">{clock}</span>}
                <Icon name="chevron" size={16} />
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="wide-button"
        onClick={() => onNavigate(routeTo("today", "history"))}
      >
        View all briefings
      </button>
    </Card>
  );
}
