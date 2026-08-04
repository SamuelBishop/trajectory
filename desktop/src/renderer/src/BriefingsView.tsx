/**
 * The daily briefing, today and recently.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-OBSERVATION-VS-INFERENCE]
 *
 * A dedicated pane rather than a chat message, so drift across days is visible:
 * three days of "partly on track" about the same goal is the signal, and it is
 * invisible when each day is a separate conversation.
 *
 * "Run now" is not a convenience. Without it the only way to see this feature
 * work is to wait until noon.
 */

import { useCallback, useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { BriefingView } from "../../shared/types";
import { attempt, toErrorMessage } from "./errors";

const ON_TRACK_LABEL: Readonly<Record<string, string>> = {
  yes: "On track",
  partly: "Partly on track",
  no: "Off track",
  unclear: "Not enough to say",
};

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) {
    return date;
  }
  // Constructed as a local date. `new Date("2026-03-10")` parses as UTC and
  // renders as the 9th for anyone west of Greenwich.
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function BriefingCard({
  record,
  expanded,
}: {
  readonly record: BriefingView;
  readonly expanded: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(expanded);

  return (
    <article className={`integration-card briefing-card ${record.error ? "failed" : ""}`}>
      <header className="briefing-card-header">
        <div>
          <h3>{formatDate(record.date)}</h3>
          {record.briefing && (
            <span className={`briefing-status ${record.briefing.on_track}`}>
              {ON_TRACK_LABEL[record.briefing.on_track] ??
                record.briefing.on_track}
            </span>
          )}
        </div>
        <button className="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Show"}
        </button>
      </header>

      {record.staleSources.length > 0 && (
        // Never let a failed sync read as an absence of activity. A confident
        // "you haven't trained this week" that really means "Strava failed" is
        // worse than no briefing at all.
        <p className="briefing-stale">
          Could not refresh {record.staleSources.join(", ")}. Anything from{" "}
          {record.staleSources.length === 1 ? "that source" : "those sources"} is
          unknown rather than absent.
        </p>
      )}

      {record.error ? (
        <p className="briefing-error">{record.error}</p>
      ) : (
        record.briefing && (
          <>
            <p className="briefing-headline">{record.briefing.headline}</p>
            {open && (
              <div className="briefing-body">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ children, href }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {record.briefing.body}
                </Markdown>

                <h4>Priorities</h4>
                <ol className="briefing-priorities">
                  {record.briefing.priorities.map((priority) => (
                    <li key={priority}>{priority}</li>
                  ))}
                </ol>

                <h4>Watch out for</h4>
                <p>{record.briefing.watch_out}</p>

                {record.briefing.uncertainties.length > 0 && (
                  <>
                    <h4>What this could not see</h4>
                    <ul className="briefing-uncertainties">
                      {record.briefing.uncertainties.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="briefing-grounding">
                  Grounded in {record.briefing.goal_ids.length} goal
                  {record.briefing.goal_ids.length === 1 ? "" : "s"},{" "}
                  {record.briefing.principle_ids.length} principle
                  {record.briefing.principle_ids.length === 1 ? "" : "s"}, and{" "}
                  {record.briefing.activity_ids.length} observed record
                  {record.briefing.activity_ids.length === 1 ? "" : "s"}.
                  Confidence {Math.round(record.briefing.confidence * 100)}%.
                </p>
              </div>
            )}
          </>
        )
      )}
    </article>
  );
}

export function BriefingsView({
  briefingEnabled,
}: {
  readonly briefingEnabled: boolean;
}): React.JSX.Element {
  const [records, setRecords] = useState<BriefingView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void attempt(() => window.trajectory.listBriefings())
      .then((loaded) => {
        setRecords(loaded);
        setProblem(null);
      })
      .catch((error: unknown) => {
        setRecords([]);
        setProblem(toErrorMessage(error));
      });
  }, []);

  useEffect(refresh, [refresh]);

  const runNow = useCallback((): void => {
    setRunning(true);
    setStatus(null);
    setProblem(null);
    void attempt(() => window.trajectory.runBriefingNow())
      .then((result) => {
        if (result.status === "completed") {
          setStatus("Briefing ready.");
        } else {
          // A failed run is reported here rather than as a notification, so
          // this is the only place the user finds out.
          setProblem(result.reason);
        }
        refresh();
      })
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setRunning(false);
      });
  }, [refresh]);

  return (
    <main className="chat-panel full">
      <header className="chat-header">
        <div>
          <h1>Daily briefing</h1>
          <span>
            {briefingEnabled
              ? "Runs once a day and tells you whether you are on track."
              : "Turned off. Enable it in Settings to get a daily notification."}
          </span>
        </div>
        <button className="primary" onClick={runNow} disabled={running}>
          {running ? "Running…" : "Run now"}
        </button>
      </header>

      <section className="view-body">
        {problem && <div className="error-banner">{problem}</div>}
        {status && <p className="save-status">{status}</p>}

        {records === null ? (
          <p className="empty-note">Loading…</p>
        ) : records.length === 0 ? (
          <p className="empty-note">
            No briefings yet. Press <strong>Run now</strong> to see one without
            waiting for the scheduled time.
          </p>
        ) : (
          records.map((record, index) => (
            <BriefingCard
              key={record.date}
              record={record}
              expanded={index === 0}
            />
          ))
        )}
      </section>
    </main>
  );
}
