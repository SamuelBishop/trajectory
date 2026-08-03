/**
 * Provider, model, active mentor, and the stored credentials.
 *
 * Implements: [HC-SECRETS-ENV-ONLY], [HC-RENDERER-IS-UNTRUSTED]
 *
 * The key field is write-only. This view can tell you that a key is stored and
 * let you replace or remove it, but it never receives one, so a compromised
 * renderer dependency has nothing to read.
 */

import { useEffect, useState } from "react";

import type {
  AppSettings,
  CopilotAuthStatus,
  LoginPrompt,
  MentorSummary,
  ProviderName,
  SecretStatus,
} from "../../shared/types";
import { attempt, toErrorMessage } from "./errors";
import { Field, SaveBar, Select, TextInput } from "./FormKit";
import { IntegrationsSection } from "./IntegrationsSection";

const PROVIDERS: readonly { value: ProviderName; label: string }[] = [
  { value: "copilot", label: "GitHub Copilot" },
  { value: "openai", label: "OpenAI-compatible" },
  { value: "deterministic", label: "Demo (offline)" },
];

const MODEL_HINTS: Readonly<Record<ProviderName, string>> = {
  copilot: "Leave blank for 'auto', the only model every account can use.",
  openai: "For example gpt-4o-mini. Required for this provider.",
  deterministic: "Ignored. The demo provider makes no network calls.",
};

export function SettingsView({
  settings,
  mentors,
  onSaved,
}: {
  readonly settings: AppSettings;
  readonly mentors: readonly MentorSummary[];
  readonly onSaved: (settings: AppSettings) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [secretStatus, setSecretStatus] = useState<SecretStatus | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    void window.trajectory
      .getSecretStatus()
      .then(setSecretStatus)
      .catch(() => undefined);
  }, []);

  const dirty =
    draft.provider !== settings.provider ||
    draft.model !== settings.model ||
    draft.activeMentorId !== settings.activeMentorId;

  const save = (): void => {
    setSaving(true);
    setStatus(null);
    setProblem(null);
    void attempt(() => window.trajectory.saveSettings(draft))
      .then((saved) => {
        onSaved(saved);
        setStatus("Saved");
      })
      .catch((error: unknown) => {
        setProblem(toErrorMessage(error));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const loadable = mentors.filter((mentor) => mentor.loadable);

  return (
    <main className="chat-panel full">
      <header className="chat-header">
        <div>
          <h1>Settings</h1>
          <span>Who answers, and with what.</span>
        </div>
      </header>

      <section className="view-body">
        <div className="editor">
          <div className="editor-body">
            <Field label="Provider" hint="Trajectory never falls back to another provider if this one fails.">
              <Select
                value={draft.provider}
                options={PROVIDERS}
                disabled={saving}
                onChange={(provider) => setDraft({ ...draft, provider })}
              />
            </Field>

            <Field label="Model" hint={MODEL_HINTS[draft.provider]}>
              <TextInput
                value={draft.model}
                placeholder="auto"
                disabled={saving || draft.provider === "deterministic"}
                onChange={(model) => setDraft({ ...draft, model })}
              />
            </Field>

            <Field
              label="Active mentor"
              hint="Whose principles and sources ground every answer."
            >
              <Select
                value={draft.activeMentorId}
                disabled={saving || loadable.length === 0}
                options={loadable.map((mentor) => ({
                  value: mentor.id,
                  label: mentor.name,
                }))}
                onChange={(activeMentorId) =>
                  setDraft({ ...draft, activeMentorId })
                }
              />
            </Field>
          </div>

          <SaveBar
            dirty={dirty}
            saving={saving}
            status={status}
            problem={problem}
            onSave={save}
            onRevert={() => {
              setDraft(settings);
              setStatus(null);
            }}
          />
        </div>

        <div className="editor">
<div className="editor-body">
            <SignInSection />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <IntegrationsSection />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="GitHub Copilot credential"
              stored={secretStatus?.hasGithubToken === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="ghp_…"
              storedNote="A token is stored and encrypted on this device. It is never displayed again."
              emptyNote="No token stored. Copilot will use the login from the Copilot CLI if there is one. An app launched from Finder inherits no shell environment, so a token is required on a machine that has never signed in."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a token here. Sign in with the Copilot CLI, or set{" "}
                  <code>COPILOT_GITHUB_TOKEN</code> in the environment instead.
                </>
              }
              onStore={(value) => window.trajectory.setGithubToken(value)}
              onClear={() => window.trajectory.clearGithubToken()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="GitHub activity token"
              stored={secretStatus?.hasGithubActivityToken === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="ghp_…"
              storedNote="A token is stored and encrypted on this device. It is never displayed again."
              emptyNote="Only needed for the GitHub commits integration. A token with read access to the repositories you want counted. Kept separate from the Copilot credential above on purpose: reading your commits and answering as your mentor are different permissions, and either can be revoked without losing the other."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a token here. The GitHub commits integration stays
                  unavailable until encryption is.
                </>
              }
              onStore={(value) =>
                window.trajectory.setGithubActivityToken(value)
              }
              onClear={() => window.trajectory.clearGithubActivityToken()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="Notion token"
              stored={secretStatus?.hasNotionToken === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="ntn_…"
              storedNote="A token is stored and encrypted on this device. It is never displayed again."
              emptyNote="Only needed for the Notion tasks integration. Create an internal integration at notion.so/my-integrations and copy its secret. Then open your task database in Notion and connect it to that integration from the ••• menu — creating the integration grants it access to nothing on its own, and a database it cannot see is reported as missing rather than empty."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a token here. The Notion tasks integration stays
                  unavailable until encryption is.
                </>
              }
              onStore={(value) => window.trajectory.setNotionToken(value)}
              onClear={() => window.trajectory.clearNotionToken()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="Strava client secret"
              stored={secretStatus?.hasStravaClientSecret === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="Client secret from strava.com/settings/api"
              storedNote="A secret is stored and encrypted on this device. It is never displayed again."
              emptyNote="Only needed for the Strava integration. Create an API application at strava.com/settings/api — Strava allows one per account — and copy its client secret. The client ID is not a secret and goes in the Activity pane instead."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a secret here. The Strava integration stays
                  unavailable until encryption is.
                </>
              }
              onStore={(value) => window.trajectory.setStravaClientSecret(value)}
              onClear={() => window.trajectory.clearStravaClientSecret()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="Strava refresh token"
              stored={secretStatus?.hasStravaRefreshToken === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="Refresh token with activity:read_all"
              storedNote="A token is stored and encrypted on this device. Trajectory replaces it automatically when Strava rotates it."
              emptyNote="Authorize your Strava application with the activity:read_all scope and store the refresh token it returns. Strava invalidates the old token whenever it issues a new one, so anything else using the same application will need re-authorizing if that happens."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a token here. The Strava integration stays
                  unavailable until encryption is.
                </>
              }
              onStore={(value) => window.trajectory.setStravaRefreshToken(value)}
              onClear={() => window.trajectory.clearStravaRefreshToken()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <ServiceAccountSection
              stored={secretStatus?.hasGoogleServiceAccountKey === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              onChanged={setSecretStatus}
            />
          </div>
        </div>

        <div className="editor">
          <div className="editor-body">
            <CredentialSection
              title="OpenAI credential"
              stored={secretStatus?.hasOpenAiKey === true}
              encryptionAvailable={secretStatus?.encryptionAvailable !== false}
              placeholder="sk-…"
              storedNote="A key is stored and encrypted on this device. It is never displayed again."
              emptyNote="No key stored. The OpenAI provider will use OPENAI_API_KEY from the environment if it is set."
              unavailableNote={
                <>
                  This device cannot encrypt local storage, so Trajectory will
                  not save a key here. Set <code>OPENAI_API_KEY</code> in the
                  environment instead.
                </>
              }
              onStore={(value) => window.trajectory.setOpenAiKey(value)}
              onClear={() => window.trajectory.clearOpenAiKey()}
              onChanged={setSecretStatus}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * One stored credential: a write-only field, a note about what is on disk, and
 * the two actions that change it.
 *
 * Each instance owns its own draft and busy state, so storing a token cannot
 * clear the other field's input or claim its status message. The value is only
 * ever sent outward — nothing here reads a credential back
 * ([HC-SECRETS-ENV-ONLY]).
 */
function CredentialSection({
  title,
  stored,
  encryptionAvailable,
  placeholder,
  storedNote,
  emptyNote,
  unavailableNote,
  onStore,
  onClear,
  onChanged,
}: {
  readonly title: string;
  readonly stored: boolean;
  readonly encryptionAvailable: boolean;
  readonly placeholder: string;
  readonly storedNote: string;
  readonly emptyNote: string;
  readonly unavailableNote: React.ReactNode;
  readonly onStore: (value: string) => Promise<SecretStatus>;
  readonly onClear: () => Promise<SecretStatus>;
  readonly onChanged: (status: SecretStatus) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = (action: () => Promise<SecretStatus>, done: string): void => {
    setBusy(true);
    setNote(null);
    // `attempt` because a bridge method the preload does not have throws
    // synchronously, and the whole point of this screen is that a credential
    // either stored or told you why not.
    void attempt(action)
      .then((next) => {
        onChanged(next);
        setDraft("");
        setNote(done);
      })
      .catch((error: unknown) => {
        setNote(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <h2 className="section-title">{title}</h2>
      {!encryptionAvailable ? (
        <p className="empty-note">{unavailableNote}</p>
      ) : (
        <>
          <p className="empty-note">{stored ? storedNote : emptyNote}</p>
          <Field
            label={stored ? "Replace" : "Value"}
            hint="Stored encrypted on this device and never shown again."
          >
            <input
              className="text-input"
              type="password"
              value={draft}
              placeholder={placeholder}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            {stored && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(onClear, "Removed.")}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() => run(() => onStore(draft), "Stored.")}
            >
              {busy ? "Saving…" : "Store"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The Google service account key, pasted whole.
 *
 * Not a `CredentialSection`, for two reasons. The value is a JSON file rather
 * than a token, so it needs room and must be readable while pasting — a masked
 * one-line box gives no way to tell a truncated paste from a complete one. And
 * only part of it is secret: the private key goes to the encrypted store, the
 * account's address goes to integrations config, because that address is what
 * the user has to type into Google's share dialog afterwards.
 *
 * Taking the whole file rather than asking for the PEM is deliberate. That key
 * is a multi-line value with escaped newlines inside a JSON string; extracting
 * it by hand is a step people get wrong, and `JSON.parse` does it correctly.
 */
function ServiceAccountSection({
  stored,
  encryptionAvailable,
  onChanged,
}: {
  readonly stored: boolean;
  readonly encryptionAvailable: boolean;
  readonly onChanged: (status: SecretStatus) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const settle = (
    action: () => Promise<{ ok: boolean; problem: string | null }>,
    done: string,
  ): void => {
    setBusy(true);
    setNote(null);
    // `attempt` because a bridge method an older preload does not have throws
    // synchronously, which would otherwise leave the button disabled forever.
    void attempt(action)
      .then(async (outcome) => {
        setNote(outcome.ok ? done : outcome.problem);
        if (outcome.ok) {
          setDraft("");
        }
        onChanged(await window.trajectory.getSecretStatus());
      })
      .catch((error: unknown) => {
        setNote(toErrorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      <h2 className="section-title">Google service account</h2>
      {!encryptionAvailable ? (
        <p className="empty-note">
          This device cannot encrypt local storage, so Trajectory will not save
          a key here. The spreadsheet integration stays unavailable until
          encryption is.
        </p>
      ) : (
        <>
          <p className="empty-note">
            {stored
              ? "A key is stored and encrypted on this device. It is never displayed again."
              : "Only needed to read a Google Sheet. In the Google Cloud console: create a project, enable the Google Sheets API, create a service account, then create a JSON key and download it. Paste the whole file below."}
          </p>
          <Field
            label={stored ? "Replace" : "Key file"}
            hint="The private key is stored encrypted. The account's address is kept in plain sight, because you need it to share the sheet."
          >
            <textarea
              className="text-input"
              rows={5}
              value={draft}
              placeholder={'{ "type": "service_account", … }'}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          </Field>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            {stored && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setNote(null);
                  void attempt(() =>
                    window.trajectory.clearGoogleServiceAccount(),
                  )
                    .then((next) => {
                      onChanged(next);
                      setNote("Removed.");
                    })
                    .catch((error: unknown) => {
                      setNote(toErrorMessage(error));
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Remove
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={busy || draft.trim().length === 0}
              onClick={() =>
                settle(
                  () => window.trajectory.saveGoogleServiceAccount(draft),
                  "Stored. Share the sheet with the address shown in the Activity pane.",
                )
              }
            >
              {busy ? "Saving…" : "Store"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Interactive GitHub sign-in.
 *
 * The device flow is the honest default for a desktop app: the browser handles
 * the credential, and the runtime stores it in the system keychain. This view
 * only ever sees a short-lived user code.
 *
 * Status comes from the runtime rather than from anything this app remembers,
 * so it stays accurate when the credential is changed or revoked elsewhere. It
 * costs a runtime start, so it is checked on demand and after signing in — not
 * on every render.
 */
function SignInSection(): React.JSX.Element {
  const [status, setStatus] = useState<CopilotAuthStatus | null>(null);
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = (): void => {
    setBusy(true);
    void attempt(() => window.trajectory.getAuthStatus())
      .then(setStatus)
      .catch(() => setStatus({ isAuthenticated: false }))
      .finally(() => setBusy(false));
  };

  const signIn = (): void => {
    setBusy(true);
    setNote(null);
    void attempt(() => window.trajectory.startSignIn())
      .then((next) => {
        setPrompt(next);
        return window.trajectory.waitForSignIn();
      })
      .then((result) => {
        setPrompt(null);
        setNote(result.ok ? "Signed in." : (result.problem ?? "Sign-in failed."));
        if (result.ok) refresh();
      })
      .catch((error: unknown) => {
        setPrompt(null);
        setNote(toErrorMessage(error));
      })
      .finally(() => setBusy(false));
  };

  const cancel = (): void => {
    void window.trajectory.cancelSignIn().catch(() => undefined);
    setPrompt(null);
  };

  return (
    <>
      <h2 className="section-title">GitHub sign-in</h2>
      {prompt ? (
        <>
          <p className="empty-note">
            Your browser should have opened. Enter this code to finish signing
            in.
          </p>
          <p className="device-code">{prompt.userCode}</p>
          <p className="empty-note">
            If the browser did not open, go to{" "}
            <code>{prompt.verificationUri}</code>.
          </p>
          <div className="save-bar">
            <span className="save-status">Waiting for authorization…</span>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="empty-note">
            {status === null
              ? "Sign in with GitHub to use Copilot, or check whether this device is already signed in."
              : status.isAuthenticated
                ? `Signed in${status.login ? ` as ${status.login}` : ""}. Copilot is ready to use.`
                : "Not signed in. Copilot needs either a sign-in or a token below."}
          </p>
          <div className="save-bar">
            <span className="save-status">{note ?? ""}</span>
            <button type="button" disabled={busy} onClick={refresh}>
              {busy ? "Checking…" : "Check status"}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={signIn}
            >
              {status?.isAuthenticated ? "Sign in again" : "Sign in with GitHub"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
