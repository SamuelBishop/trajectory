/**
 * One integration, on its own page: connect it, say what it may read, then the
 * settings almost nobody changes.
 *
 * Implements: [HC-RENDERER-IS-UNTRUSTED], [HC-NO-EXFILTRATION], [HC-SECRETS-ENV-ONLY]
 *
 * The order is the order of the questions a person actually has. A credential
 * that lives on a different screen from the scope it authorises produces a
 * half-connected source and no way to see which half is missing, which is why
 * the connection block is here rather than in a shared credentials list.
 *
 * The credential still never travels inside `IntegrationsView`. This page
 * composes the booleans from `getSecretStatus()` with write-only setters, so
 * nothing on the page can read back what is stored.
 */

import { useState } from "react";

import type {
  IntegrationSummary,
  IntegrationsView,
  SecretStatus,
} from "../../../shared/types";
import { useSavedDraft } from "../draft";
import { Field, NumberInput, Toggle } from "../FormKit";
import { countLabel, relativeTime, sourceState } from "../today/derive";
import { Card, Disclosure, StatusDot } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { CredentialField, ServiceAccountField } from "./CredentialField";
import {
  GitHubScopeEditor,
  GoogleSheetsScopeEditor,
  NotionScopeEditor,
  StravaScopeEditor,
} from "./ScopeEditors";

export function IntegrationDetail({
  integration,
  view,
  secretStatus,
  busy,
  onRun,
  onSecretChanged,
  onBack,
}: {
  readonly integration: IntegrationSummary;
  readonly view: IntegrationsView;
  readonly secretStatus: SecretStatus | null;
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
  readonly onSecretChanged: (status: SecretStatus) => void;
  readonly onBack: () => void;
}): React.JSX.Element {
  const encryptionAvailable = secretStatus?.encryptionAvailable !== false;
  const state = sourceState(integration, view.paused);
  const synced = relativeTime(integration.lastSyncedAt, new Date());

  return (
    <div className="detail">
      <button type="button" className="back-link" onClick={onBack}>
        <Icon name="chevron" size={14} />
        All integrations
      </button>

      <header className="detail-header">
        <div>
          <h2>{integration.label}</h2>
          <p className="muted">
            {integration.hosts.length === 0
              ? "Makes no network connection."
              : `Connects only to ${integration.hosts.join(", ")}.`}
          </p>
        </div>
        <StatusDot health={state.health} label={state.label} />
      </header>

      {integration.lastError !== null && (
        <p className="inline-error">
          Last sync failed: {integration.lastError}
        </p>
      )}
      {integration.lastSkippedReason !== undefined && (
        <p className="inline-warning">
          Last refresh did nothing: {integration.lastSkippedReason}
        </p>
      )}

      <Card>
        <h3 className="card-title">Connection</h3>
        <ConnectionBlock
          id={integration.id}
          secretStatus={secretStatus}
          encryptionAvailable={encryptionAvailable}
          busy={busy}
          onSecretChanged={onSecretChanged}
        />
      </Card>

      <Card>
        <h3 className="card-title">What it reads</h3>
        <p className="muted">
          Trajectory reads only what is named here. Nothing is written back.
        </p>
        {integration.id === "github" && (
          <GitHubScopeEditor
            scope={view.github}
            goalDomains={view.goalDomains}
            busy={busy}
            onRun={onRun}
          />
        )}
        {integration.id === "notion" && (
          <NotionScopeEditor
            scope={view.notion}
            goalDomains={view.goalDomains}
            busy={busy}
            onRun={onRun}
          />
        )}
        {integration.id === "strava" && (
          <StravaScopeEditor
            scope={view.strava}
            goalDomains={view.goalDomains}
            busy={busy}
            onRun={onRun}
          />
        )}
        {integration.id === "google_sheets" && (
          <GoogleSheetsScopeEditor
            scope={view.googleSheets}
            goalDomains={view.goalDomains}
            busy={busy}
            onRun={onRun}
          />
        )}
      </Card>

      <Card>
        <h3 className="card-title">Data</h3>
        <p className="muted">
          {synced === null ? "Never synced." : `Last synced ${synced}.`}{" "}
          {countLabel(integration.signalCount)} stored, encrypted on this device.
        </p>
        <DataActions integration={integration} busy={busy} onRun={onRun} />
      </Card>

      <SyncPolicy integration={integration} busy={busy} onRun={onRun} />
    </div>
  );
}

/**
 * The credential this one integration needs.
 *
 * Deliberately not a lookup table shared with the model providers: reading your
 * commits and answering as your mentor are different permissions, and pairing
 * them in one component would invite pairing them on disk.
 */
function ConnectionBlock({
  id,
  secretStatus,
  encryptionAvailable,
  busy,
  onSecretChanged,
}: {
  readonly id: string;
  readonly secretStatus: SecretStatus | null;
  readonly encryptionAvailable: boolean;
  readonly busy: boolean;
  readonly onSecretChanged: (status: SecretStatus) => void;
}): React.JSX.Element {
  if (id === "github") {
    return (
      <CredentialField
        title="GitHub activity token"
        stored={secretStatus?.hasGithubActivityToken === true}
        encryptionAvailable={encryptionAvailable}
        placeholder="ghp_…"
        storedNote="A token is stored and encrypted on this device. It is never displayed again."
        emptyNote="A token with read access to the repositories you want counted. Kept separate from the Copilot credential under Advanced on purpose: reading your commits and answering as your mentor are different permissions, and either can be revoked without losing the other."
        unavailableNote={
          <>
            This device cannot encrypt local storage, so Trajectory will not save
            a token here. The GitHub commits integration stays unavailable until
            encryption is.
          </>
        }
        onStore={(value) => window.trajectory.setGithubActivityToken(value)}
        onClear={() => window.trajectory.clearGithubActivityToken()}
        onChanged={onSecretChanged}
      />
    );
  }

  if (id === "notion") {
    return (
      <CredentialField
        title="Notion token"
        stored={secretStatus?.hasNotionToken === true}
        encryptionAvailable={encryptionAvailable}
        placeholder="ntn_…"
        storedNote="A token is stored and encrypted on this device. It is never displayed again."
        emptyNote="Create an internal integration at notion.so/my-integrations and copy its secret. Then open your task database in Notion and connect it to that integration from the ••• menu — creating the integration grants it access to nothing on its own, and a database it cannot see is reported as missing rather than empty."
        unavailableNote={
          <>
            This device cannot encrypt local storage, so Trajectory will not save
            a token here. The Notion tasks integration stays unavailable until
            encryption is.
          </>
        }
        onStore={(value) => window.trajectory.setNotionToken(value)}
        onClear={() => window.trajectory.clearNotionToken()}
        onChanged={onSecretChanged}
      />
    );
  }

  if (id === "strava") {
    return (
      <>
        <CredentialField
          title="Client secret"
          stored={secretStatus?.hasStravaClientSecret === true}
          encryptionAvailable={encryptionAvailable}
          placeholder="Client secret from strava.com/settings/api"
          storedNote="A secret is stored and encrypted on this device. It is never displayed again."
          emptyNote="Create an API application at strava.com/settings/api — Strava allows one per account — and copy its client secret. The client ID is not a secret and goes under What it reads."
          unavailableNote={
            <>
              This device cannot encrypt local storage, so Trajectory will not
              save a secret here. The Strava integration stays unavailable until
              encryption is.
            </>
          }
          onStore={(value) => window.trajectory.setStravaClientSecret(value)}
          onClear={() => window.trajectory.clearStravaClientSecret()}
          onChanged={onSecretChanged}
        />
        <CredentialField
          title="Refresh token"
          stored={secretStatus?.hasStravaRefreshToken === true}
          encryptionAvailable={encryptionAvailable}
          placeholder="Refresh token with activity:read_all"
          storedNote="A token is stored and encrypted on this device. Trajectory replaces it automatically when Strava rotates it."
          emptyNote="Authorize your Strava application with the activity:read_all scope and store the refresh token it returns. Strava invalidates the old token whenever it issues a new one, so anything else using the same application will need re-authorizing if that happens."
          unavailableNote={
            <>
              This device cannot encrypt local storage, so Trajectory will not
              save a token here. The Strava integration stays unavailable until
              encryption is.
            </>
          }
          onStore={(value) => window.trajectory.setStravaRefreshToken(value)}
          onClear={() => window.trajectory.clearStravaRefreshToken()}
          onChanged={onSecretChanged}
        />
      </>
    );
  }

  if (id === "google_sheets") {
    return (
      <ServiceAccountField
        stored={secretStatus?.hasGoogleServiceAccountKey === true}
        encryptionAvailable={encryptionAvailable}
        onChanged={onSecretChanged}
      />
    );
  }

  return (
    <p className="muted">
      {busy ? "" : "This integration needs no credential."}
    </p>
  );
}

/** Refresh and delete, with the confirm step delete has always had. */
function DataActions({
  integration,
  busy,
  onRun,
}: {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="save-bar">
      <span className="save-status">
        {confirmingDelete
          ? "Delete every stored record? This cannot be undone."
          : ""}
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
    </div>
  );
}

/**
 * Enabled, schedule, quiet hours, retention.
 *
 * Collapsed, because the defaults are the right answer for almost everyone and
 * a page that opens on six numbers reads as configuration rather than as a
 * decision about what an app may see. Nothing is validated here — the main
 * process re-parses the policy before it decides whether an adapter may reach
 * the network at all.
 */
function SyncPolicy({
  integration,
  busy,
  onRun,
}: {
  readonly integration: IntegrationSummary;
  readonly busy: boolean;
  readonly onRun: (action: () => Promise<IntegrationsView>) => void;
}): React.JSX.Element {
  const { draft, setDraft, dirty } = useSavedDraft(integration.policy);

  return (
    <Card>
      <Disclosure summary="Sync schedule and retention">
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
            {dirty ? "Unsaved schedule changes." : ""}
          </span>
          <button
            type="button"
            className={dirty ? "primary" : undefined}
            disabled={busy || !dirty}
            onClick={() =>
              onRun(() =>
                window.trajectory.saveIntegrationPolicy(integration.id, draft),
              )
            }
          >
            Save schedule
          </button>
        </div>
      </Disclosure>
    </Card>
  );
}
