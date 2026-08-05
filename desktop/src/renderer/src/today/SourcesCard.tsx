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

import type { IntegrationSummary, IntegrationsView } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { BrandIcon } from "../ui/BrandIcon";
import { Card, CardHeader, StatusDot } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { countLabel, relativeTime, sourceBrand, sourceState } from "./derive";

/**
 * One source, as three aligned columns.
 *
 * Not the shared `NavRow`: that stacks a subtitle under its title, which buries
 * the sync status underneath the name and leaves the reader scanning a ragged
 * edge down the card. Here the status and the count each get their own column,
 * so "which of my sources is stale" is answerable in one vertical glance —
 * which is the entire reason this card is on the home screen.
 *
 * It reuses `.nav-row` for its hover, focus and disabled behaviour, and only
 * overrides the layout.
 */
function SourceRow({
  integration,
  paused,
  onOpen,
}: {
  readonly integration: IntegrationSummary;
  readonly paused: boolean;
  readonly onOpen: () => void;
}): React.JSX.Element {
  const state = sourceState(integration, paused);
  const { name, brand } = sourceBrand(integration);

  return (
    <button type="button" className="nav-row source-row" onClick={onOpen}>
      <BrandIcon brand={brand} />
      <span className="source-row-name" title={name}>
        {name}
      </span>
      <StatusDot health={state.health} label={state.label} />
      <span className="source-row-count muted">
        {countLabel(integration.signalCount)}
      </span>
      <Icon name="chevron" size={16} />
    </button>
  );
}

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
          // Plain text, not a control. The freshness is a statement; only the
          // refresh beside it does anything, and wrapping both in a bordered
          // pill made the button look like it was nested inside another one.
          <div className="source-freshness">
            <span>{updated === null ? "Never synced" : `Updated ${updated}`}</span>
            <button
              type="button"
              className="icon-button bare"
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
          {view.integrations.map((integration) => (
            <SourceRow
              key={integration.id}
              integration={integration}
              paused={view.paused}
              onOpen={() => onNavigate(routeTo("settings", integration.id))}
            />
          ))}
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
