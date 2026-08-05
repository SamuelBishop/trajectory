/**
 * Whether the briefing was working from fresh information.
 *
 * Implements: [HC-NO-EXFILTRATION]
 *
 * On the home screen rather than buried in Settings because an assessment is
 * only as good as the last sync behind it. A confident "you have not trained
 * this week" that really means "Strava failed on Monday" is the failure mode,
 * and the only cheap defence is showing the user which sources are actually
 * current before they act on the verdict.
 *
 * Counts are records held on this device. Nothing here reveals what is in them.
 */

import type { IntegrationsView } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { Card, CardHeader, NavRow, StatusDot } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { countLabel, relativeTime, sourceState } from "./derive";

export function SourcesCard({
  view,
  problem,
  busy,
  now,
  onRefreshAll,
  onNavigate,
}: {
  readonly view: IntegrationsView | null;
  readonly problem: string | null;
  readonly busy: boolean;
  readonly now: Date;
  readonly onRefreshAll: () => void;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  const freshest =
    view === null
      ? null
      : view.integrations
          .map((integration) => integration.lastSyncedAt)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null;

  const updated = relativeTime(freshest, now);

  return (
    <Card>
      <CardHeader
        title="Sources"
        action={
          <div className="card-action">
            <span className="muted">
              {updated === null ? "Never synced" : `Updated ${updated}`}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh every enabled source"
              title="Refresh every enabled source"
              disabled={busy || view === null}
              onClick={onRefreshAll}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
        }
      />

      {problem !== null && <p className="inline-error">{problem}</p>}

      {view === null ? (
        <p className="muted">Loading…</p>
      ) : !view.encryptionAvailable ? (
        <p className="muted">
          This device cannot encrypt local storage, so Trajectory collects no
          activity here.
        </p>
      ) : view.integrations.length === 0 ? (
        <p className="muted">No integrations are registered in this build.</p>
      ) : (
        <div className="source-rows">
          {view.integrations.map((integration) => {
            const state = sourceState(integration, view.paused);
            return (
              <NavRow
                key={integration.id}
                title={integration.label}
                detail={<StatusDot health={state.health} label={state.label} />}
                trailing={
                  <span className="muted">
                    {countLabel(integration.signalCount)}
                  </span>
                }
                onOpen={() => onNavigate(routeTo("settings", integration.id))}
              />
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="wide-button"
        onClick={() => onNavigate(routeTo("settings"))}
      >
        <Icon name="sliders" size={16} />
        Manage integrations
      </button>
    </Card>
  );
}
