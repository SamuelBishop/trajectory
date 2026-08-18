/**
 * Settings, in three sections: what you chose, what you connected, and what you
 * almost never touch.
 *
 * The old screen was one scroll carrying provider config, the briefing
 * schedule, sign-in, every integration, and six credential blocks in a row.
 * Splitting it is not tidying: a credential sitting a screen away from the
 * source it authorises is how a half-connected integration goes unnoticed.
 *
 * The route carries the selection so a source row on Today can open the page
 * for that integration directly.
 */

import type { AppSettings, MentorSummary } from "../../../shared/types";
import { routeTo, type Route } from "../route";
import { AdvancedSection } from "./AdvancedSection";
import { AppearanceSection } from "./AppearanceSection";
import { BasicsSection } from "./BasicsSection";
import { IntegrationsPane } from "./IntegrationsPane";

type Section = "basics" | "appearance" | "integrations" | "advanced";

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "appearance", label: "Appearance" },
  { id: "integrations", label: "Integrations" },
  { id: "advanced", label: "Advanced" },
];

/**
 * `sub` is either a section name or an integration id. Anything unrecognised
 * lands on Basics rather than on an empty pane.
 */
function sectionFor(sub: string | null): Section {
  if (sub === null || sub === "basics") return "basics";
  if (sub === "appearance") return "appearance";
  if (sub === "advanced") return "advanced";
  return "integrations";
}

function selectedIntegration(sub: string | null): string | null {
  return sub === null ||
    sub === "basics" ||
    sub === "appearance" ||
    sub === "advanced" ||
    sub === "integrations"
    ? null
    : sub;
}

export function SettingsView({
  route,
  settings,
  mentors,
  onNavigate,
  onSaved,
}: {
  readonly route: Route;
  readonly settings: AppSettings;
  readonly mentors: readonly MentorSummary[];
  readonly onNavigate: (route: Route) => void;
  readonly onSaved: (settings: AppSettings) => void;
}): React.JSX.Element {
  const section = sectionFor(route.sub);

  return (
    <main className="view">
      <header className="view-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Who answers, what they can see, and how often.</p>
        </div>
      </header>

      <nav className="segmented">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? "segment active" : "segment"}
            onClick={() => onNavigate(routeTo("settings", item.id))}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="view-body settings-body">
        {section === "basics" && (
          <BasicsSection
            settings={settings}
            mentors={mentors}
            onSaved={onSaved}
          />
        )}
        {section === "appearance" && (
          <AppearanceSection settings={settings} onSaved={onSaved} />
        )}
        {section === "integrations" && (
          <IntegrationsPane
            selected={selectedIntegration(route.sub)}
            onSelect={(id) =>
              onNavigate(routeTo("settings", id ?? "integrations"))
            }
          />
        )}
        {section === "advanced" && <AdvancedSection />}
      </div>
    </main>
  );
}
