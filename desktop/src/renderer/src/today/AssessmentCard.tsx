/**
 * Today's verdict, above the fold.
 *
 * Implements: [HC-OBSERVATION-VS-INFERENCE], [SC-UNCERTAINTY-DECLARED]
 *
 * Four things decide whether the two-minute loop works: whether you are on
 * track, how sure the mentor is, why, and what to do next. They are on the
 * surface; the prose and the citations are one disclosure away.
 *
 * "Reason" is drawn from `inferences` — the mentor's reading, not a record of
 * what happened. The caption under the columns says so, and the observations it
 * was built from stay in their own labelled region inside the evidence panel.
 * Merging the two into one confident paragraph is the failure this product
 * exists to avoid.
 */

import type { BriefingView } from "../../../shared/types";
import type { Route } from "../route";
import { Card, StatusDot } from "../ui/Card";
import { Disclosure } from "../ui/Card";
import { Icon } from "../ui/Icon";
import {
  formatConfidence,
  formatDate,
  ON_TRACK_LABEL,
  onTrackHealth,
} from "./derive";
import { EvidencePanel } from "./EvidencePanel";
import { Prose } from "./Prose";

function Column({
  label,
  value,
  fallback,
}: {
  readonly label: string;
  readonly value: string;
  readonly fallback: string;
}): React.JSX.Element {
  return (
    <div className="assessment-column">
      <h4>{label}</h4>
      {value.trim().length > 0 ? (
        <p>{value}</p>
      ) : (
        <p className="muted">{fallback}</p>
      )}
    </div>
  );
}

export function AssessmentCard({
  record,
  today,
  onNavigate,
}: {
  readonly record: BriefingView;
  readonly today: string;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  const briefing = record.briefing;

  return (
    <Card tone="accent" className="assessment">
      <header className="card-header">
        <h2 className="card-title">
          {record.date === today
            ? "Today's assessment"
            : formatDate(record.date, today)}
        </h2>
        {briefing && (
          <div className="assessment-confidence">
            <strong>{formatConfidence(briefing.confidence)}</strong>
            <span>Confidence</span>
          </div>
        )}
      </header>

      {record.staleSources.length > 0 && (
        // Never let a failed sync read as an absence of activity. A confident
        // "you haven't trained this week" that really means "Strava failed" is
        // worse than no briefing at all.
        <p className="inline-warning">
          <Icon name="warning" size={16} />
          Could not refresh {record.staleSources.join(", ")}. Anything from{" "}
          {record.staleSources.length === 1 ? "that source" : "those sources"} is
          unknown rather than absent.
        </p>
      )}

      {record.error !== null || briefing === null ? (
        <div className="assessment-failed">
          <StatusDot health="bad" label="Did not finish" />
          <p>{record.error ?? "This run produced no briefing."}</p>
        </div>
      ) : (
        <>
          <div className="assessment-verdict">
            <span
              className={`verdict-mark verdict-${onTrackHealth(briefing.on_track)}`}
            >
              <Icon
                name={briefing.on_track === "yes" ? "check" : "warning"}
                size={22}
              />
            </span>
            <h3 className={`verdict-${onTrackHealth(briefing.on_track)}`}>
              {ON_TRACK_LABEL[briefing.on_track] ?? briefing.on_track}
            </h3>
          </div>

          <p className="assessment-headline">{briefing.headline}</p>

          <div className="assessment-columns">
            <Column
              label="Reason"
              value={briefing.inferences.join(" ")}
              fallback="The mentor recorded no reasoning."
            />
            <Column
              label="Risk"
              value={briefing.watch_out}
              fallback="Nothing flagged."
            />
            <Column
              label="Next decision"
              value={briefing.priorities[0] ?? ""}
              fallback="No priority named."
            />
          </div>

          <p className="assessment-caption">
            Reason is the mentor's reading of what it saw. The observations
            behind it are in the evidence below.
          </p>

          <Disclosure summary="Read the full briefing">
            <Prose text={briefing.body} />
          </Disclosure>

          <EvidencePanel briefing={briefing} onNavigate={onNavigate} />
        </>
      )}
    </Card>
  );
}
