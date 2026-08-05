/**
 * The integrations list, and the state every one of its pages shares.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED]
 *
 * One owner for `IntegrationsView`, because every integrations verb returns the
 * whole view. Letting a detail page hold its own copy would mean two screens
 * disagreeing about whether syncing is paused.
 *
 * The list itself has no form fields. It answers "is this source working" and
 * nothing else; everything you can change lives one click in, on the page for
 * the integration it belongs to.
 */

import { useEffect, useState } from "react";

import type {
  IntegrationsView,
  SecretStatus,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { countLabel, relativeTime, sourceState } from "../today/derive";
import { Card, NavRow, StatusDot } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { IntegrationDetail } from "./IntegrationDetail";

export function IntegrationsPane({
  selected,
  onSelect,
}: {
  /** The integration id whose page is open, or null for the list. */
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}): React.JSX.Element {
  const [view, setView] = useState<IntegrationsView | null>(null);
  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.trajectory
      .listIntegrations()
      .then(setView)
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      });
    void window.trajectory
      .getSecretStatus()
      .then(setSecretStatus)
      .catch(() => undefined);
  }, []);

  const run = (action: () => Promise<IntegrationsView>): void => {
    setBusy(true);
    setProblem(null);
    // `attempt` so a synchronous throw is reported rather than wedging `busy`
    // on forever.
    void attempt(action)
      .then(setView)
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  if (view === null) {
    return (
      <Card>
        <p className="muted">{problem ?? "Loading integrations…"}</p>
      </Card>
    );
  }

  if (!view.encryptionAvailable) {
    return (
      <Card tone="warning">
        <h3 className="card-title">Storage cannot be encrypted</h3>
        <p className="muted">
          This device cannot encrypt local storage, so Trajectory will not
          collect or store activity here. No integration can be connected until
          that changes.
        </p>
      </Card>
    );
  }

  const active =
    selected === null
      ? null
      : (view.integrations.find((item) => item.id === selected) ?? null);

  if (active !== null) {
    return (
      <>
        {problem !== null && <p className="inline-error">{problem}</p>}
        <IntegrationDetail
          integration={active}
          view={view}
          secretStatus={secretStatus}
          busy={busy}
          onRun={run}
          onSecretChanged={setSecretStatus}
          onBack={() => onSelect(null)}
        />
      </>
    );
  }

  const now = new Date();

  return (
    <>
      <p className="muted">
        Integrations let the mentor see what you actually did, not only what you
        wrote down. Everything collected stays encrypted on this device.
      </p>

      {problem !== null && <p className="inline-error">{problem}</p>}

      <Card className="list-card">
        {view.integrations.map((integration) => {
          const state = sourceState(integration, view.paused);
          const synced = relativeTime(integration.lastSyncedAt, now);
          return (
            <NavRow
              key={integration.id}
              icon={<Icon name="target" size={16} />}
              title={integration.label}
              detail={
                <>
                  {countLabel(integration.signalCount)}
                  {synced !== null && ` · ${synced}`}
                </>
              }
              trailing={<StatusDot health={state.health} label={state.label} />}
              onOpen={() => onSelect(integration.id)}
            />
          );
        })}
      </Card>

      <Card>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={view.paused}
            disabled={busy}
            onChange={(event) =>
              run(() =>
                window.trajectory.setIntegrationsPaused(event.target.checked),
              )
            }
          />
          <span>
            <strong>Pause all automatic syncing</strong>
            <span className="muted">
              An explicit refresh still works while paused. This only stops
              Trajectory acting on its own.
            </span>
          </span>
        </label>
      </Card>
    </>
  );
}
