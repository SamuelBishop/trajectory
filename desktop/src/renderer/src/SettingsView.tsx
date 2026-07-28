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
  MentorSummary,
  ProviderName,
  SecretStatus,
} from "../../shared/types";
import { toErrorMessage } from "./errors";
import { Field, SaveBar, Select, TextInput } from "./FormKit";

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
    void window.trajectory
      .saveSettings(draft)
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
    void action()
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
