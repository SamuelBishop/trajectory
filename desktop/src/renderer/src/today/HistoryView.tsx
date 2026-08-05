/**
 * Every stored briefing, oldest kept for ninety days.
 *
 * A separate screen rather than an ever-growing home page: Today answers "what
 * now", this answers "what has been happening", and the second question is
 * asked weekly at most.
 */

import type { BriefingView } from "../../../shared/types";
import { HOME, type Route } from "../route";
import { Card, Disclosure, EmptyState, StatusDot } from "../ui/Card";
import { Icon } from "../ui/Icon";
import {
  formatClock,
  formatConfidence,
  formatDate,
  ON_TRACK_LABEL,
  onTrackHealth,
} from "./derive";
import { EvidencePanel } from "./EvidencePanel";
import { Prose } from "./Prose";

export function HistoryView({
  records,
  today,
  onNavigate,
}: {
  readonly records: readonly BriefingView[];
  readonly today: string;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  return (
    <main className="chat-panel full">
      <header className="chat-header">
        <div>
          <button
            type="button"
            className="back-link"
            onClick={() => onNavigate(HOME)}
          >
            <Icon name="chevron" size={14} />
            Today
          </button>
          <h1>All briefings</h1>
          <span>
            Kept on this device for ninety days, then deleted. Read down the
            column: three days saying the same thing is the signal.
          </span>
        </div>
      </header>

      <section className="view-body history">
        {records.length === 0 ? (
          <EmptyState icon="calendar" title="No briefings yet">
            Nothing has run. Return to Today and run one without waiting for the
            scheduled time.
          </EmptyState>
        ) : (
          records.map((record) => {
            const clock = formatClock(record.generatedAt);
            return (
              <Card key={record.date}>
                <header className="card-header">
                  <h2 className="card-title">
                    {formatDate(record.date, today)}
                  </h2>
                  <div className="card-action">
                    {record.briefing === null ? (
                      <StatusDot health="bad" label="Did not finish" />
                    ) : (
                      <>
                        <StatusDot
                          health={onTrackHealth(record.briefing.on_track)}
                          label={
                            ON_TRACK_LABEL[record.briefing.on_track] ??
                            record.briefing.on_track
                          }
                        />
                        <span className="muted">
                          {formatConfidence(record.briefing.confidence)}
                        </span>
                      </>
                    )}
                    {clock !== null && <span className="muted">{clock}</span>}
                  </div>
                </header>

                {record.staleSources.length > 0 && (
                  <p className="inline-warning">
                    <Icon name="warning" size={16} />
                    Could not refresh {record.staleSources.join(", ")}. Anything
                    from{" "}
                    {record.staleSources.length === 1
                      ? "that source"
                      : "those sources"}{" "}
                    is unknown rather than absent.
                  </p>
                )}

                {record.briefing === null ? (
                  <p className="inline-error">
                    {record.error ?? "This run produced no briefing."}
                  </p>
                ) : (
                  <>
                    <p className="assessment-headline">
                      {record.briefing.headline}
                    </p>
                    <Disclosure summary="Read this briefing">
                      <Prose text={record.briefing.body} />
                      <h4 className="history-subhead">Priorities</h4>
                      <ol className="history-priorities">
                        {record.briefing.priorities.map((priority) => (
                          <li key={priority}>{priority}</li>
                        ))}
                      </ol>
                      <h4 className="history-subhead">Watch out for</h4>
                      <p>{record.briefing.watch_out}</p>
                    </Disclosure>
                    <EvidencePanel
                      briefing={record.briefing}
                      onNavigate={onNavigate}
                    />
                  </>
                )}
              </Card>
            );
          })
        )}
      </section>
    </main>
  );
}
