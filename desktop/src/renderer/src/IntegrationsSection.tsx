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
  GitHubScopeView,
  IntegrationPolicyView,
  IntegrationSummary,
  IntegrationsView,
} from "../../shared/types";
import { toErrorMessage } from "./errors";
import { Field, NumberInput, TagInput, TextInput, Toggle } from "./FormKit";

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
            >
              {integration.id === "github" && (
                <GitHubScopeEditor
                  scope={view.github}
                  goalDomains={view.goalDomains}
                  busy={busy}
                  onRun={run}
                />
              )}
            </IntegrationCard>
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
  children,
}: {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
  readonly children?: React.ReactNode;
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

      {children}

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

/**
 * Which repositories GitHub may be read from, and which goal each one serves.
 *
 * The domain map is the part that makes the mentor useful rather than merely
 * informed. `ActivitySignal.domain` has to equal a `Goal.domain` before
 * selection will connect a commit to a goal, and a repository name almost never
 * does — so the goals you actually have are offered here as suggestions, and an
 * unmapped repository is called out rather than left to fail quietly.
 */
function GitHubScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: GitHubScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<GitHubScopeView>(scope);

  useEffect(() => {
    setDraft(scope);
  }, [scope]);

  const targets = [...draft.repositories, ...draft.organizations].filter(
    (entry) => entry.length > 0,
  );
  const unmapped = targets.filter(
    (entry) => (draft.domains[entry] ?? "").length === 0,
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(scope);

  return (
    <>
      <Field
        label="GitHub username"
        hint="Whose commits to read. Only commits you authored are collected."
      >
        <TextInput
          value={draft.login}
          disabled={busy}
          placeholder="octocat"
          onChange={(login) => setDraft({ ...draft, login })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How recent a commit must be. A week keeps the mentor on what you are doing now."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      <Toggle
        label="Read every repository I can access"
        checked={draft.allRepositories}
        disabled={busy}
        onChange={(allRepositories) => setDraft({ ...draft, allRepositories })}
      />

      {!draft.allRepositories && (
        <>
          <Field
            label="Repositories"
            hint="Comma separated, as owner/name. Empty means nothing is read at all."
          >
            <TagInput
              value={draft.repositories}
              disabled={busy}
              placeholder="octocat/api-service, octocat/side-project"
              onChange={(repositories) => setDraft({ ...draft, repositories })}
            />
          </Field>

          <Field
            label="Organizations"
            hint="Comma separated. Widens scope to every repository in the organization."
          >
            <TagInput
              value={draft.organizations}
              disabled={busy}
              placeholder="my-org"
              onChange={(organizations) => setDraft({ ...draft, organizations })}
            />
          </Field>
        </>
      )}

      {!draft.allRepositories && targets.length > 0 && (
        <>
          <p className="field-hint">
            Optional. Recent commits reach the mentor either way, and it reads
            the repository name and commit message to work out which goal they
            serve. Map one only when its name says nothing useful.
          </p>
          {targets.map((entry) => (
            <Field key={entry} label={entry}>
              <TextInput
                value={draft.domains[entry] ?? ""}
                disabled={busy}
                placeholder={
                  goalDomains.length > 0
                    ? `e.g. ${goalDomains.join(", ")}`
                    : "a goal domain"
                }
                onChange={(domain) =>
                  setDraft({
                    ...draft,
                    domains: { ...draft.domains, [entry]: domain },
                  })
                }
              />
            </Field>
          ))}
        </>
      )}

      {unmapped.length > 0 && (
        <p className="field-hint">
          Not yet mapped to a goal: {unmapped.join(", ")}.
        </p>
      )}

      <div className="save-bar">
        <span className="save-status" />
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveGitHubScope(draft))}
        >
          Save scope
        </button>
      </div>
    </>
  );
}
