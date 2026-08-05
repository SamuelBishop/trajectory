/**
 * The surfaces every view is built from.
 *
 * Presentational only — nothing here touches `window.trajectory`. A card that
 * fetched its own data would be a card that cannot be reused by the next
 * screen, and the whole point of pulling these out is that Today, Context and
 * Settings stop inventing their own container markup.
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "./Icon";

export function Card({
  children,
  tone = "plain",
  className = "",
}: {
  readonly children: ReactNode;
  /** `accent` is the one card a screen wants read first. */
  readonly tone?: "plain" | "accent" | "warning";
  readonly className?: string;
}): React.JSX.Element {
  return (
    <section className={`card card-${tone} ${className}`.trim()}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  action,
}: {
  readonly title: string;
  readonly action?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="card-header">
      <h2 className="card-title">{title}</h2>
      {action}
    </header>
  );
}

/**
 * The status of one thing, as a colour and a word.
 *
 * The word is not decoration. A dot alone puts the whole meaning in a hue,
 * which is unreadable to anyone who cannot separate the two greens.
 */
export type Health = "good" | "warn" | "bad" | "idle";

export function StatusDot({
  health,
  label,
}: {
  readonly health: Health;
  readonly label: string;
}): React.JSX.Element {
  return (
    <span className={`status-dot status-${health}`}>
      <i aria-hidden />
      {label}
    </span>
  );
}

export function Badge({
  children,
  tone = "plain",
}: {
  readonly children: ReactNode;
  readonly tone?: "plain" | "good" | "warn" | "bad";
}): React.JSX.Element {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Metric({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/**
 * An expandable region, closed by default.
 *
 * `<details>` rather than a `useState` toggle: it is keyboard-operable and
 * announced as expandable without any of that being written here, and the
 * summary stays a real disclosure control instead of a styled div.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  readonly summary: string;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
}): React.JSX.Element {
  return (
    <details className="disclosure" open={defaultOpen}>
      <summary>
        <Icon name="chevron" size={14} />
        {summary}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

/**
 * A row that goes somewhere.
 *
 * Rendered as a button rather than a div with an onClick, so it is reachable by
 * keyboard and announced as an action.
 */
export function NavRow({
  icon,
  title,
  detail,
  trailing,
  onOpen,
  disabled,
}: {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onOpen: () => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nav-row"
      disabled={disabled}
      onClick={onOpen}
    >
      {icon !== undefined && <span className="nav-row-icon">{icon}</span>}
      <span className="nav-row-main">
        <span className="nav-row-title">{title}</span>
        {detail !== undefined && (
          <span className="nav-row-detail">{detail}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="nav-row-trailing">{trailing}</span>
      )}
      <Icon name="chevron" size={16} />
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <Icon name={icon} size={26} />
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
