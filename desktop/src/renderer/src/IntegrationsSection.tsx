/**
 * Activity integrations: what Trajectory may collect about you, and when.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-NO-EXFILTRATION]
 *
 * Every control here is a restraint. The point of the pane is that a background
 * timer collecting a record of your days is only acceptable if you can see what
 * it holds, see where it would connect, stop it, and delete it — so the host
 * list, the signal count, the pause, and the delete button are all first-class
 * rather than buried.
 *
 * Nothing is validated here. The main process re-parses the policy before
 * writing it, because that is the value deciding whether an adapter may reach
 * the network at all.
 */

import { useEffect, useState } from "react";

import type {
  IntegrationPolicyView,
  IntegrationSummary,
  IntegrationsView,
} from "../../shared/types";
import { toErrorMessage } from "./errors";
import { Field, NumberInput, Toggle } from "./FormKit";

function formatSyncedAt(value: string | null): string {
  if (value === null) return "Never synced.";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Never synced."
    : `Last synced ${parsed.toLocaleString()}.`;
}

function describeHosts(hosts: readonly string[]): string {
  return hosts.length === 0
    ? "Makes no network connection."
    : `Connects only to ${hosts.join(", ")}.`;
}

export function IntegrationsSection(): React.JSX.Element {
  const [view, setView] = useState<IntegrationsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.trajectory
      .listIntegrations()
      .then(setView)
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      });
  }, []);

  const run = (action: () => Promise<IntegrationsView>): void => {
    setBusy(true);
    setProblem(null);
    void action()
      .then(setView)
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <h2 className="section-title">Activity</h2>
      <p className="empty-note">
        Integrations let the mentor see what you actually did, not only what you
        wrote down. Everything collected stays encrypted on this device.
      </p>

      {problem !== null && <p className="empty-note">{problem}</p>}

      {view === null ? (
        <p className="empty-note">Loading…</p>
      ) : !view.encryptionAvailable ? (
        <p className="empty-note">
          This device cannot encrypt local storage, so Trajectory will not
          collect or store activity here.
        </p>
      ) : (
        <>
          <Toggle
            label="Pause all automatic syncing"
            checked={view.paused}
            disabled={busy}
            onChange={(paused) =>
              run(() => window.trajectory.setIntegrationsPaused(paused))
            }
          />
          <p className="field-hint">
            An explicit refresh still works while paused. This only stops
            Trajectory acting on its own.
          </p>

          {view.integrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              busy={busy}
              onRun={run}
            />
          ))}
        </>
      )}
    </>
  );
}

function IntegrationCard({
  integration,
  busy,
  onRun,
}: {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<IntegrationPolicyView>(integration.policy);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setDraft(integration.policy);
  }, [integration.policy]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(integration.policy);

  return (
    <div className="integration-card">
      <h3 className="field-label">{integration.label}</h3>
      <p className="field-hint">{describeHosts(integration.hosts)}</p>
      <p className="field-hint">
        {formatSyncedAt(integration.lastSyncedAt)}{" "}
        {integration.signalCount === 1
          ? "1 record stored."
          : `${String(integration.signalCount)} records stored.`}
      </p>
      {integration.lastError !== null && (
        <p className="empty-note">Last sync failed: {integration.lastError}</p>
      )}
      {integration.lastSkippedReason !== undefined && (
        <p className="empty-note">
          Last refresh did nothing: {integration.lastSkippedReason}
        </p>
      )}

      <Toggle
        label="Enabled"
        checked={draft.enabled}
        disabled={busy}
        onChange={(enabled) => setDraft({ ...draft, enabled })}
      />
      <Toggle
        label="Sync when the app starts"
        checked={draft.sync.on_app_load}
        disabled={busy || !draft.enabled}
        onChange={(on_app_load) =>
          setDraft({ ...draft, sync: { ...draft.sync, on_app_load } })
        }
      />
      <Toggle
        label="Allow manual refresh"
        checked={draft.sync.on_demand}
        disabled={busy || !draft.enabled}
        onChange={(on_demand) =>
          setDraft({ ...draft, sync: { ...draft.sync, on_demand } })
        }
      />

      <Field label="Sync every (minutes)" hint="Zero turns the timer off.">
        <NumberInput
          value={draft.sync.timer_minutes}
          min={0}
          max={10_080}
          disabled={busy || !draft.enabled}
          onChange={(timer_minutes) =>
            setDraft({ ...draft, sync: { ...draft.sync, timer_minutes } })
          }
        />
      </Field>

      <Field
        label="Quiet hours start"
        hint="Automatic syncing stops between these hours. Set both to the same value for no quiet window."
      >
        <NumberInput
          value={draft.quiet_hours.start}
          min={0}
          max={23}
          disabled={busy || !draft.enabled}
          onChange={(start) =>
            setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, start } })
          }
        />
      </Field>
      <Field label="Quiet hours end">
        <NumberInput
          value={draft.quiet_hours.end}
          min={0}
          max={23}
          disabled={busy || !draft.enabled}
          onChange={(end) =>
            setDraft({ ...draft, quiet_hours: { ...draft.quiet_hours, end } })
          }
        />
      </Field>

      <Field
        label="Keep history for (days)"
        hint="Older records are deleted the next time this integration syncs."
      >
        <NumberInput
          value={draft.retention_days}
          min={1}
          max={3650}
          disabled={busy || !draft.enabled}
          onChange={(retention_days) => setDraft({ ...draft, retention_days })}
        />
      </Field>

      <div className="save-bar">
        <span className="save-status">
          {confirmingDelete ? "Delete every stored record? This cannot be undone." : ""}
        </span>
        {confirmingDelete ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmingDelete(false);
                onRun(() =>
                  window.trajectory.deleteIntegrationData(integration.id),
                );
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || integration.signalCount === 0}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete data
          </button>
        )}
        <button
          type="button"
          disabled={busy || !integration.policy.enabled}
          onClick={() =>
            onRun(() => window.trajectory.refreshIntegration(integration.id))
          }
        >
          Refresh now
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() =>
            onRun(() =>
              window.trajectory.saveIntegrationPolicy(integration.id, draft),
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
