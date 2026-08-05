/**
 * The navigation rail.
 *
 * Four destinations, because the daily loop has four: read the briefing, ask a
 * follow-up, correct what the answer was built on, change how it runs. Mentor
 * configuration and integration internals live one level inside the last two —
 * they are set up once and then left alone, and a permanent tab for each of
 * them would give a weekly task the same standing as the daily one.
 *
 * The privacy line is at the bottom of every screen on purpose. It is the
 * product's central claim, and a claim made only in Settings is one most people
 * never read.
 */

import { HOME, routeTo, type Route, type ViewName } from "../route";
import { Icon, type IconName } from "./Icon";
import { Mark } from "./Mark";

const DESTINATIONS: readonly {
  readonly view: ViewName;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { view: "today", label: "Today", icon: "today" },
  { view: "chat", label: "Chat", icon: "chat" },
  { view: "context", label: "Context", icon: "context" },
];

export function Rail({
  route,
  onNavigate,
}: {
  readonly route: Route;
  readonly onNavigate: (next: Route) => void;
}): React.JSX.Element {
  const button = (
    view: ViewName,
    label: string,
    icon: IconName,
  ): React.JSX.Element => (
    <button
      key={view}
      type="button"
      className={`rail-button ${route.view === view ? "active" : ""}`}
      aria-current={route.view === view ? "page" : undefined}
      onClick={() => onNavigate(view === "today" ? HOME : routeTo(view))}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-brand">
        <div className="brand-mark">
          <Mark />
        </div>
        <div className="rail-brand-text">
          <strong>Trajectory</strong>
          <span>Private. Local. Yours.</span>
        </div>
      </div>

      <div className="rail-nav">
        {DESTINATIONS.map((entry) =>
          button(entry.view, entry.label, entry.icon),
        )}
        <hr className="rail-divider" />
        {button("settings", "Settings", "settings")}
      </div>

      <p className="rail-footer">
        <Icon name="lock" size={15} />
        All data is encrypted and stored only on this device.
      </p>
    </nav>
  );
}
