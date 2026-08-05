/**
 * The four things a new user has to decide, and nothing else.
 *
 * Provider and model live here rather than under Advanced because a wrong
 * provider is the difference between an answer and an error, and the user has
 * to be able to find it. Credentials do not: they are a consequence of the
 * choice made here, and they belong next to what they authorise.
 */

import { useEffect, useState } from "react";

import type {
  AppSettings,
  MentorSummary,
  ProviderName,
} from "../../../shared/types";
import { attempt, toErrorMessage } from "../errors";
import { Field, SaveBar, Select, TextInput, Toggle } from "../FormKit";

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

/** Minutes since local midnight, shown as a 24-hour clock. */
export function formatMinute(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

/**
 * Parses "12:00" back to minutes. Returns null for anything unparseable so the
 * caller keeps the previous value rather than storing a NaN that would make the
 * schedule silently never fire.
 */
export function parseMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function BasicsSection({
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

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty =
    draft.displayName !== settings.displayName ||
    draft.provider !== settings.provider ||
    draft.model !== settings.model ||
    draft.activeMentorId !== settings.activeMentorId ||
    draft.briefingEnabled !== settings.briefingEnabled ||
    draft.briefingMinute !== settings.briefingMinute ||
    draft.briefingHeadlineInNotification !==
      settings.briefingHeadlineInNotification;

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
    <div className="settings-card">
      <div className="settings-card-body">
        <Field
          label="Your name"
          hint="Used only in the greeting on Today. Stays on this device."
        >
          <TextInput
            value={draft.displayName}
            placeholder="Optional"
            disabled={saving}
            onChange={(displayName) => setDraft({ ...draft, displayName })}
          />
        </Field>

        <Field
          label="Provider"
          hint="Trajectory never falls back to another provider if this one fails."
        >
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
          hint="Whose principles and sources ground every answer. Edit them under Context."
        >
          <Select
            value={draft.activeMentorId}
            disabled={saving || loadable.length === 0}
            options={loadable.map((mentor) => ({
              value: mentor.id,
              label: mentor.name,
            }))}
            onChange={(activeMentorId) => setDraft({ ...draft, activeMentorId })}
          />
        </Field>

        <hr className="settings-divider" />

        <Field
          label="Daily briefing"
          hint="Once a day, Trajectory reads your goals and everything the connected integrations have observed, then tells you whether you are on track and what to prioritise."
        >
          <Toggle
            checked={draft.briefingEnabled}
            disabled={saving}
            label="Run a daily briefing"
            onChange={(briefingEnabled) =>
              setDraft({ ...draft, briefingEnabled })
            }
          />
        </Field>

        <Field
          label="Time"
          hint="Local time. If the app is closed at this time, the briefing runs when you next open it — the same day only."
        >
          <TextInput
            value={formatMinute(draft.briefingMinute)}
            placeholder="12:00"
            disabled={saving || !draft.briefingEnabled}
            onChange={(value) => {
              const parsed = parseMinute(value);
              setDraft({
                ...draft,
                briefingMinute: parsed ?? draft.briefingMinute,
              });
            }}
          />
        </Field>

        <Field
          label="Notification text"
          hint="With this on, the notification carries a one-line summary written by the mentor. macOS may show it on the lock screen and mirror it to a paired iPhone. With it off, the notification says only that a briefing is ready; the summary stays in the app."
        >
          <Toggle
            checked={draft.briefingHeadlineInNotification}
            disabled={saving || !draft.briefingEnabled}
            label="Show the summary in the notification"
            onChange={(briefingHeadlineInNotification) =>
              setDraft({ ...draft, briefingHeadlineInNotification })
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
  );
}
