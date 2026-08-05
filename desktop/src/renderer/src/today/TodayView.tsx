/**
 * Today: the home screen and the centre of the product.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-OBSERVATION-VS-INFERENCE],
 * [SC-UNCERTAINTY-DECLARED]
 *
 * The daily loop is: read the verdict, see whether the sources behind it are
 * current, act, and occasionally ask one grounded follow-up. That is what is
 * above the fold, in that order. Everything else — the prose, the citations,
 * the history, the integration settings — is one deliberate click away.
 *
 * "Run now" is not a convenience. Without it the only way to see this feature
 * work is to wait until noon.
 */

import { useCallback, useEffect, useState } from "react";

import type {
  AppSettings,
  BriefingView,
  IntegrationsView,
  MentorSummary,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { routeTo, type Route } from "../route";
import { Card, EmptyState } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { AssessmentCard } from "./AssessmentCard";
import {
  greetingLine,
  localDateKey,
  recordFor,
  relativeTime,
  streakDays,
} from "./derive";
import { HistoryView } from "./HistoryView";
import { MomentumStrip } from "./MomentumStrip";
import { PrioritiesCard, WatchOutCard } from "./PrioritiesCard";
import { RecentBriefingsCard } from "./RecentBriefingsCard";
import { SourcesCard } from "./SourcesCard";

/**
 * How many goals are live, read from the same file the mentor was grounded in.
 *
 * Returns null rather than zero when the file cannot be understood, so a
 * corrupt goals file shows no tile instead of claiming the user has no goals.
 */
function activeGoalCount(data: unknown): number | null {
  if (typeof data !== "object" || data === null) return null;
  const goals = (data as { goals?: unknown }).goals;
  if (!Array.isArray(goals)) return null;
  return goals.filter(
    (goal) =>
      typeof goal === "object" &&
      goal !== null &&
      (goal as { status?: unknown }).status === "active",
  ).length;
}

export function TodayView({
  route,
  settings,
  mentor,
  onNavigate,
  onAsk,
}: {
  readonly route: Route;
  readonly settings: AppSettings;
  readonly mentor: MentorSummary | null;
  readonly onNavigate: (next: Route) => void;
  readonly onAsk: (question: string) => void;
}): React.JSX.Element {
  const [records, setRecords] = useState<BriefingView[] | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsView | null>(
    null,
  );
  const [activeGoals, setActiveGoals] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sourceProblem, setSourceProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Re-read on a timer so "4m ago" does not quietly become a lie in a window
  // left open all afternoon.
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const loadBriefings = useCallback((): void => {
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

  useEffect(loadBriefings, [loadBriefings]);

  useEffect(() => {
    void attempt(() => window.trajectory.listIntegrations())
      .then(setIntegrations)
      .catch((error: unknown) => {
        setSourceProblem(toErrorMessage(error));
      });
    // The goals file is read for one number. A failure is silent on purpose:
    // the tile disappears rather than pushing an editor error onto a screen
    // whose job is the briefing.
    void window.trajectory
      .readUserConfig("goals")
      .then((document) => setActiveGoals(activeGoalCount(document.data)))
      .catch(() => setActiveGoals(null));
  }, []);

  const today = localDateKey(now);

  const runNow = useCallback((): void => {
    setRunning(true);
    setProblem(null);
    void attempt(() => window.trajectory.runBriefingNow())
      .then((result) => {
        if (result.status !== "completed") {
          // A failed run is reported here rather than as a notification, so
          // this is the only place the user finds out.
          setProblem(result.reason);
        }
        // Re-read rather than trusting the returned record, so the screen shows
        // what was stored.
        setSelectedDate(null);
        loadBriefings();
      })
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setRunning(false);
      });
  }, [loadBriefings]);

  const refreshAll = useCallback((): void => {
    if (integrations === null) return;
    const targets = integrations.integrations
      .filter((entry) => entry.policy.enabled && entry.policy.sync.on_demand)
      .map((entry) => entry.id);
    if (targets.length === 0) {
      setSourceProblem("No enabled source allows a manual refresh.");
      return;
    }
    setSyncing(true);
    setSourceProblem(null);
    void (async () => {
      try {
        for (const id of targets) {
          // Sequential: every verb returns the whole view, and two in flight
          // would race to write the older one last.
          setIntegrations(await window.trajectory.refreshIntegration(id));
        }
        setNow(new Date());
      } catch (error) {
        setSourceProblem(toErrorMessage(error));
      } finally {
        setSyncing(false);
      }
    })();
  }, [integrations]);

  if (route.sub === "history") {
    return (
      <HistoryView
        records={records ?? []}
        today={today}
        onNavigate={onNavigate}
      />
    );
  }

  const todayRecord = records === null ? null : recordFor(records, today);
  const shown =
    records === null
      ? null
      : selectedDate !== null
        ? recordFor(records, selectedDate)
        : (todayRecord ?? records[0] ?? null);

  const lastRun = relativeTime(records?.[0]?.generatedAt ?? null, now);

  const subtitle = (): string => {
    if (records === null) return "Reading what is stored on this device…";
    if (records.length === 0) {
      return "No briefing has run yet.";
    }
    if (todayRecord === null) {
      return settings.briefingEnabled
        ? "Today's briefing has not run yet."
        : "The daily briefing is turned off. You can still run one now.";
    }
    if (todayRecord.error !== null) return "Today's briefing did not finish.";
    if (todayRecord.staleSources.length > 0) {
      return "Today's briefing ran, but some sources could not be refreshed.";
    }
    return "Today's briefing is ready.";
  };

  return (
    <main className="chat-panel full today">
      <header className="today-header">
        <div className="today-greeting">
          <h1>{greetingLine(now, settings.displayName)}</h1>
          <span>{subtitle()}</span>
        </div>
        <div className="today-run">
          <button
            type="button"
            className="primary"
            disabled={running}
            onClick={runNow}
          >
            <Icon name="play" size={15} />
            {running ? "Running…" : "Run briefing now"}
          </button>
          <span className="muted">
            {lastRun === null ? "Never run" : `Last run ${lastRun}`}
          </span>
        </div>
      </header>

      <section className="view-body today-body">
        {problem !== null && <div className="error-banner">{problem}</div>}

        <div className="today-grid">
          <div className="today-column">
            {records === null ? (
              <Card>
                <p className="muted">Loading…</p>
              </Card>
            ) : shown === null ? (
              <Card>
                <EmptyState
                  icon="today"
                  title="No briefing yet"
                  action={
                    <button
                      type="button"
                      className="primary"
                      disabled={running}
                      onClick={runNow}
                    >
                      {running ? "Running…" : "Run briefing now"}
                    </button>
                  }
                >
                  Trajectory reads your goals and everything your connected
                  sources have observed, then says whether you are on track. Run
                  one now instead of waiting for the scheduled time.
                </EmptyState>
              </Card>
            ) : (
              <>
                <AssessmentCard
                  record={shown}
                  today={today}
                  onNavigate={onNavigate}
                />
                {shown.briefing && (
                  <>
                    <PrioritiesCard
                      priorities={shown.briefing.priorities}
                      onAsk={onAsk}
                    />
                    <WatchOutCard
                      text={shown.briefing.watch_out}
                      onAsk={onAsk}
                    />
                  </>
                )}
              </>
            )}
          </div>

          <div className="today-column">
            <SourcesCard
              view={integrations}
              problem={sourceProblem}
              busy={syncing}
              now={now}
              onRefreshAll={refreshAll}
              onNavigate={onNavigate}
            />
            <RecentBriefingsCard
              records={records ?? []}
              today={today}
              selectedDate={shown?.date ?? null}
              onSelect={setSelectedDate}
              onNavigate={onNavigate}
            />
          </div>
        </div>

        <MomentumStrip
          mentor={mentor}
          streak={records === null ? 0 : streakDays(records, today)}
          priorityCount={shown?.briefing?.priorities.length ?? 0}
          activeGoals={activeGoals}
          onNavigate={onNavigate}
        />

        {!settings.briefingEnabled && (
          <p className="today-footnote">
            The daily briefing is turned off, so nothing runs on its own.{" "}
            <button
              type="button"
              className="text-link"
              onClick={() => onNavigate(routeTo("settings"))}
            >
              Turn it on in Settings
            </button>
            .
          </p>
        )}
      </section>
    </main>
  );
}
