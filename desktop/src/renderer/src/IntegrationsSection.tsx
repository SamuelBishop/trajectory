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
  NotionScopeView,
  StravaScopeView,
} from "../../shared/types";
import { attempt, toErrorMessage } from "./errors";
import { useSavedDraft } from "./draft";
import { Field, NumberInput, Select, TagInput, TextInput, Toggle } from "./FormKit";

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
              {integration.id === "notion" && (
                <NotionScopeEditor
                  scope={view.notion}
                  goalDomains={view.goalDomains}
                  busy={busy}
                  onRun={run}
                />
              )}
              {integration.id === "strava" && (
                <StravaScopeEditor
                  scope={view.strava}
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
  const { draft, setDraft, dirty } = useSavedDraft(integration.policy);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
  const { draft, setDraft, dirty } = useSavedDraft(scope);

  const targets = [...draft.repositories, ...draft.organizations].filter(
    (entry) => entry.length > 0,
  );
  const unmapped = targets.filter(
    (entry) => (draft.domains[entry] ?? "").length === 0,
  );

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
        <span className="save-status">
          {dirty ? "Unsaved GitHub settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveGitHubScope(draft))}
        >
          Save GitHub settings
        </button>
      </div>
    </>
  );
}


/**
 * Which Notion database may be read, and how to interpret its columns.
 *
 * Every property name is a field because no two task databases share a schema.
 * Notion has no canonical "status" column — it is whatever the user named it —
 * so a hardcoded name would work for one person and silently return nothing for
 * everyone else. The adapter reports a name that matches nothing rather than
 * storing zero tasks and letting it read as a quiet week.
 */
function NotionScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: NotionScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);
  const domainHint =
    goalDomains.length > 0 ? `e.g. ${goalDomains.join(", ")}` : "a goal domain";

  return (
    <>
      <Field
        label="Database"
        hint="Paste the database URL from Notion, or its ID. Empty means nothing is read at all."
      >
        <TextInput
          value={draft.databaseId}
          disabled={busy}
          placeholder="https://www.notion.so/…"
          onChange={(databaseId) => setDraft({ ...draft, databaseId })}
        />
      </Field>

      <p className="field-hint">
        The database also has to be connected to your integration from
        Notion&rsquo;s ••• menu. Creating the integration does not grant it
        access on its own.
      </p>

      <Field
        label="Where the tasks are"
        hint="Rows: each row is one task. Checkboxes: each row is a day, and the to-do boxes written inside it are the tasks."
      >
        <Select
          value={draft.taskSource}
          disabled={busy}
          options={[
            { value: "rows", label: "Each row is a task" },
            { value: "checkboxes", label: "Checkboxes inside each page" },
          ]}
          onChange={(taskSource) => setDraft({ ...draft, taskSource })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How far the first sync reaches. Later syncs resume from the last one."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      {draft.taskSource === "checkboxes" && (
        <>
          <Field
            label="Date property"
            hint="The date column on each daily page. Every box ticked on that page is dated by it."
          >
            <TextInput
              value={draft.dateProperty}
              disabled={busy}
              placeholder="Date"
              onChange={(dateProperty) => setDraft({ ...draft, dateProperty })}
            />
          </Field>
          <p className="field-hint">
            A real date column rather than the page title. A page called
            &ldquo;July 30&rdquo; carries no year, so dating a task from its name
            means guessing one.
          </p>
        </>
      )}

      {draft.taskSource === "rows" && (
      <>
      <Field label="Title property" hint="The column holding the task name.">
        <TextInput
          value={draft.titleProperty}
          disabled={busy}
          placeholder="Name"
          onChange={(titleProperty) => setDraft({ ...draft, titleProperty })}
        />
      </Field>

      <Field
        label="Status property"
        hint="The column that says whether a task is done. A status, select, or checkbox."
      >
        <TextInput
          value={draft.statusProperty}
          disabled={busy}
          placeholder="Status"
          onChange={(statusProperty) => setDraft({ ...draft, statusProperty })}
        />
      </Field>

      <Field
        label="Values that mean done"
        hint="Comma separated, matched ignoring case. Ignored when the status column is a checkbox."
      >
        <TagInput
          value={draft.doneValues}
          disabled={busy}
          placeholder="Done, Shipped"
          onChange={(doneValues) => setDraft({ ...draft, doneValues })}
        />
      </Field>

      <Field
        label="Completed date property"
        hint="Optional. When a task was finished. Falls back to when it was last edited."
      >
        <TextInput
          value={draft.completedProperty}
          disabled={busy}
          placeholder="Completed on"
          onChange={(completedProperty) =>
            setDraft({ ...draft, completedProperty })
          }
        />
      </Field>

      <Field
        label="Due date property"
        hint="Optional. Used to date tasks that are not finished."
      >
        <TextInput
          value={draft.dueProperty}
          disabled={busy}
          placeholder="Due"
          onChange={(dueProperty) => setDraft({ ...draft, dueProperty })}
        />
      </Field>

      </>
      )}

      <Field
        label="Domain property"
        hint="Optional. A select column naming which goal a task serves."
      >
        <TextInput
          value={draft.domainProperty}
          disabled={busy}
          placeholder="Area"
          onChange={(domainProperty) => setDraft({ ...draft, domainProperty })}
        />
      </Field>

      <Field
        label="Default domain"
        hint="Used when no domain column is mapped, or when a task leaves it blank."
      >
        <TextInput
          value={draft.defaultDomain}
          disabled={busy}
          placeholder={domainHint}
          onChange={(defaultDomain) => setDraft({ ...draft, defaultDomain })}
        />
      </Field>

      <Toggle
        label={
          draft.taskSource === "checkboxes"
            ? "Also collect boxes that are not ticked"
            : "Also collect tasks that are not finished"
        }
        checked={draft.includeOpenTasks}
        disabled={busy}
        onChange={(includeOpenTasks) => setDraft({ ...draft, includeOpenTasks })}
      />

      <p className="field-hint">
        An unfinished item records what you meant to do; a finished one records
        what you did. Trajectory stores which is which, so the mentor can tell
        you what is still outstanding without ever counting it as done.
      </p>

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved Notion settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveNotionScope(draft))}
        >
          Save Notion settings
        </button>
      </div>
    </>
  );
}

/**
 * Strava's scope is short because there is nothing to interpret.
 *
 * A recorded activity has one shape, so unlike Notion there are no column names
 * to configure — only which application to use and which goal the training
 * serves. The two credentials are not here: they live in Settings under
 * Credentials, where every other secret is, and no channel reads one back.
 */
function StravaScopeEditor({
  scope,
  goalDomains,
  busy,
  onRun,
}: {
  readonly scope: StravaScopeView;
  readonly goalDomains: readonly string[];
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(scope);
  const domainHint =
    goalDomains.length > 0 ? `e.g. ${goalDomains.join(", ")}` : "a goal domain";

  return (
    <>
      <Field
        label="Client ID"
        hint="From strava.com/settings/api. Empty means nothing is read at all."
      >
        <TextInput
          value={draft.clientId}
          disabled={busy}
          placeholder="123456"
          onChange={(clientId) => setDraft({ ...draft, clientId })}
        />
      </Field>

      <p className="field-hint">
        The client secret and refresh token go under Credentials. Authorize the
        application with the <code>activity:read_all</code> scope, or reuse a
        refresh token you already minted for it.
      </p>

      <Field
        label="Goal domain"
        hint={`Which goal these workouts count towards — ${domainHint}.`}
      >
        <TextInput
          value={draft.defaultDomain}
          disabled={busy}
          placeholder="running"
          onChange={(defaultDomain) => setDraft({ ...draft, defaultDomain })}
        />
      </Field>

      <Field
        label="Days to look back"
        hint="How far the first sync reaches. Later syncs resume from the last one."
      >
        <NumberInput
          value={draft.lookbackDays}
          min={1}
          max={365}
          disabled={busy}
          onChange={(lookbackDays) => setDraft({ ...draft, lookbackDays })}
        />
      </Field>

      <p className="field-hint">
        Every activity type is collected, not only runs. A training plan fails
        through overtraining as often as through undertraining, so the recovery
        and cross-training days are the ones that answer whether you are on
        track. Routes and GPS coordinates are never read or stored.
      </p>

      <div className="save-bar">
        <span className="save-status">
          {dirty ? "Unsaved Strava settings." : ""}
        </span>
        <button
          type="button"
          className={dirty ? "primary" : undefined}
          disabled={busy || !dirty}
          onClick={() => onRun(() => window.trajectory.saveStravaScope(draft))}
        >
          Save Strava settings
        </button>
      </div>
    </>
  );
}
