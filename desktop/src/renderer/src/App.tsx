/**
 * Application shell: four destinations over one window.
 *
 * Settings are loaded once here and passed down, so the chat header's provider
 * control and the Settings view cannot disagree about which provider is
 * selected. Navigation is held here for the same reason — see `route.ts`.
 */

import { useCallback, useEffect, useState } from "react";

import type {
  AppSettings,
  MentorSummary,
  ProviderName,
} from "../../shared/types";
import { ChatView } from "./chat/ChatView";
import { ContextView } from "./context/ContextView";
import { toErrorMessage } from "./errors";
import { HOME, routeTo, type Route } from "./route";
import { SettingsView } from "./settings/SettingsView";
import { TodayView } from "./today/TodayView";
import { Rail } from "./ui/Rail";

const FALLBACK_SETTINGS: AppSettings = {
  provider: "copilot",
  model: "",
  displayName: "",
  activeMentorId: "demo_mentor",
  briefingEnabled: false,
  briefingMinute: 12 * 60,
  briefingHeadlineInNotification: true,
  zoomPercent: 100,
};

export function App(): React.JSX.Element {
  const [route, setRoute] = useState<Route>(HOME);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [mentors, setMentors] = useState<MentorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * A question Today handed to Chat. Consumed once, so returning to Chat later
   * does not refill the composer with a priority the user already dismissed.
   */
  const [chatSeed, setChatSeed] = useState<string | null>(null);

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
        // Settings are a convenience; the briefing still renders on defaults,
        // so surface the problem rather than blocking the window on it.
        setError(toErrorMessage(settingsError));
        setSettings(FALLBACK_SETTINGS);
      });
    refreshMentors();
  }, [refreshMentors]);

  useEffect(() => {
    // Clicking the notification should land on the briefing it was about, not
    // on whatever view happened to be open when the window was last closed.
    return window.trajectory.onShowBriefing(() => {
      setRoute(HOME);
    });
  }, []);

  const navigate = useCallback(
    (next: Route): void => {
      setRoute(next);
      if (next.view !== "chat") {
        refreshMentors();
      }
    },
    [refreshMentors],
  );

  const askInChat = useCallback((question: string): void => {
    setChatSeed(question);
    setRoute(routeTo("chat"));
  }, []);

  const persist = useCallback((next: AppSettings): void => {
    setSettings(next);
    void window.trajectory.saveSettings(next).catch((saveError: unknown) => {
      setError(toErrorMessage(saveError));
    });
  }, []);

  if (!settings) {
    return <div className="center-state">Starting Trajectory…</div>;
  }

  const activeMentor =
    mentors.find((mentor) => mentor.id === settings.activeMentorId) ?? null;

  return (
    <div className="app-shell">
      <Rail route={route} onNavigate={navigate} />

      {error && <div className="error-banner floating">{error}</div>}

      {route.view === "today" && (
        <TodayView
          route={route}
          settings={settings}
          mentor={activeMentor}
          onNavigate={navigate}
          onAsk={askInChat}
        />
      )}
      {route.view === "chat" && (
        <ChatView
          provider={settings.provider}
          mentorName={activeMentor?.name ?? "Context-aware mentorship"}
          mentorDisclaimer={activeMentor?.disclaimer ?? ""}
          displayName={settings.displayName}
          onNavigate={navigate}
          seed={chatSeed}
          onSeedUsed={() => setChatSeed(null)}
          onChangeProvider={(provider: ProviderName) => {
            persist({ ...settings, provider });
          }}
        />
      )}
      {route.view === "context" && (
        <ContextView
          route={route}
          mentors={mentors}
          activeMentorId={settings.activeMentorId}
          onNavigate={navigate}
          onMentorsChanged={setMentors}
          onActivate={(id) => {
            persist({ ...settings, activeMentorId: id });
          }}
        />
      )}
      {route.view === "settings" && (
        <SettingsView
          route={route}
          settings={settings}
          mentors={mentors}
          onNavigate={navigate}
          onSaved={(next) => {
            setSettings(next);
            refreshMentors();
          }}
        />
      )}
    </div>
  );
}
