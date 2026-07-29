/**
 * Application shell: a rail of views over one window.
 *
 * Settings are loaded once here and passed down, so the chat header's provider
 * control and the Settings view cannot disagree about which provider is
 * selected.
 */

import { useCallback, useEffect, useState } from "react";

import type {
  AppSettings,
  MentorSummary,
  ProviderName,
} from "../../shared/types";
import { ChatView } from "./ChatView";
import { toErrorMessage } from "./errors";
import { MentorsView } from "./MentorsView";
import { ProfileView } from "./ProfileView";
import { SettingsView } from "./SettingsView";

type ViewName = "chat" | "profile" | "mentors" | "settings";

const VIEWS: readonly { name: ViewName; label: string; icon: string }[] = [
  { name: "chat", label: "Chat", icon: "◆" },
  { name: "profile", label: "Profile", icon: "◇" },
  { name: "mentors", label: "Mentors", icon: "◈" },
  { name: "settings", label: "Settings", icon: "⚙" },
];

const FALLBACK_SETTINGS: AppSettings = {
  provider: "copilot",
  model: "",
  activeMentorId: "demo_mentor",
};

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewName>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mentors, setMentors] = useState<MentorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshMentors = useCallback((): void => {
    void window.trajectory
      .listMentors()
      .then(setMentors)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.trajectory
      .getSettings()
      .then(setSettings)
      .catch((settingsError: unknown) => {
        // Settings are a convenience; chat still works on defaults, so surface
        // the problem rather than blocking the window on it.
        setError(toErrorMessage(settingsError));
        setSettings(FALLBACK_SETTINGS);
      });
    refreshMentors();
  }, [refreshMentors]);

  const persist = useCallback((next: AppSettings): void => {
    setSettings(next);
    void window.trajectory.saveSettings(next).catch((saveError: unknown) => {
      setError(toErrorMessage(saveError));
    });
  }, []);

  const activate = useCallback(
    (id: string): void => {
      setSettings((current) => {
        const next = { ...(current ?? FALLBACK_SETTINGS), activeMentorId: id };
        void window.trajectory.saveSettings(next).catch((saveError: unknown) => {
          setError(toErrorMessage(saveError));
        });
        return next;
      });
    },
    [],
  );

  if (!settings) {
    return <div className="center-state">Starting Trajectory…</div>;
  }

  const activeMentor = mentors.find(
    (mentor) => mentor.id === settings.activeMentorId,
  );

  return (
    <div className="app-shell">
      <nav className="rail">
        <div className="brand-mark" title="Trajectory">
          T
        </div>
        {VIEWS.map((entry) => (
          <button
            key={entry.name}
            className={`rail-button ${view === entry.name ? "active" : ""}`}
            title={entry.label}
            aria-label={entry.label}
            aria-current={view === entry.name}
            onClick={() => {
              setView(entry.name);
              if (entry.name !== "chat") {
                refreshMentors();
              }
            }}
          >
            <span aria-hidden>{entry.icon}</span>
            <em>{entry.label}</em>
          </button>
        ))}
      </nav>

      {error && <div className="error-banner floating">{error}</div>}

      {view === "chat" && (
        <ChatView
          provider={settings.provider}
          mentorName={activeMentor?.name ?? "Context-aware mentorship"}
          mentorDisclaimer={activeMentor?.disclaimer ?? ""}
          onChangeProvider={(provider: ProviderName) => {
            persist({ ...settings, provider });
          }}
        />
      )}
      {view === "profile" && <ProfileView />}
      {view === "mentors" && (
        <MentorsView
          activeMentorId={settings.activeMentorId}
          onActivate={activate}
        />
      )}
      {view === "settings" && (
        <SettingsView
          settings={settings}
          mentors={mentors}
          onSaved={(next) => {
            setSettings(next);
            refreshMentors();
          }}
        />
      )}
    </div>
  );
}
