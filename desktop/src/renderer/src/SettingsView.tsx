/**
 * Provider, model, active mentor, and the OpenAI credential.
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
  const [keyDraft, setKeyDraft] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyNote, setKeyNote] = useState<string | null>(null);

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

  const runKeyAction = (
    action: () => Promise<SecretStatus>,
    note: string,
  ): void => {
    setKeyBusy(true);
    setKeyNote(null);
    void action()
      .then((next) => {
        setSecretStatus(next);
        setKeyDraft("");
        setKeyNote(note);
      })
      .catch((error: unknown) => {
        setKeyNote(toErrorMessage(error));
      })
      .finally(() => {
        setKeyBusy(false);
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
            <h2 className="section-title">OpenAI credential</h2>
            {secretStatus?.encryptionAvailable === false ? (
              <p className="empty-note">
                This device cannot encrypt local storage, so Trajectory will not
                save a key here. Set <code>OPENAI_API_KEY</code> in the
                environment instead.
              </p>
            ) : (
              <>
                <p className="empty-note">
                  {secretStatus?.hasOpenAiKey
                    ? "A key is stored and encrypted on this device. It is never displayed again."
                    : "No key stored. The OpenAI provider will use OPENAI_API_KEY from the environment if it is set."}
                </p>
                <Field
                  label={secretStatus?.hasOpenAiKey ? "Replace key" : "API key"}
                  hint="Stored encrypted on this device and never shown again."
                >
                  <input
                    className="text-input"
                    type="password"
                    value={keyDraft}
                    placeholder="sk-…"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={keyBusy}
                    onChange={(event) => setKeyDraft(event.target.value)}
                  />
                </Field>
                <div className="save-bar">
                  <span className="save-status">{keyNote ?? ""}</span>
                  {secretStatus?.hasOpenAiKey && (
                    <button
                      type="button"
                      disabled={keyBusy}
                      onClick={() =>
                        runKeyAction(
                          () => window.trajectory.clearOpenAiKey(),
                          "Key removed.",
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary"
                    disabled={keyBusy || keyDraft.trim().length === 0}
                    onClick={() =>
                      runKeyAction(
                        () => window.trajectory.setOpenAiKey(keyDraft),
                        "Key stored.",
                      )
                    }
                  >
                    {keyBusy ? "Saving…" : "Store key"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
