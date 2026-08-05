/**
 * Line icons for the navigation rail and the surfaces that echo it.
 *
 * Drawn here rather than pulled from an icon package: a dozen glyphs is not
 * worth a dependency in a renderer that ships no component library, and an
 * inline `currentColor` path inherits the active state without a second colour
 * rule.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export type IconName =
  | "today"
  | "chat"
  | "context"
  | "settings"
  | "lock"
  | "refresh"
  | "play"
  | "warning"
  | "check"
  | "chevron"
  | "calendar"
  | "target"
  | "sliders"
  | "plus"
  | "chevron-down"
  | "copy"
  | "diamond"
  | "pulse"
  | "stack";

const PATHS: Readonly<Record<IconName, React.ReactNode>> = {
  today: (
    <>
      <path d="M3 9.5 10 3.5l7 6" {...STROKE} />
      <path d="M5 8.8V16a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8V8.8" {...STROKE} />
    </>
  ),
  chat: (
    <path
      d="M4 4h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 3.2V5a1 1 0 0 1 1-1Z"
      {...STROKE}
    />
  ),
  context: (
    <>
      <rect x="3.2" y="3.8" width="13.6" height="12.4" rx="1.6" {...STROKE} />
      <path d="M3.2 8h13.6" {...STROKE} />
    </>
  ),
  settings: (
    <>
      <circle cx="10" cy="10" r="2.4" {...STROKE} />
      <path
        d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"
        {...STROKE}
      />
    </>
  ),
  lock: (
    <>
      <rect x="4.6" y="8.6" width="10.8" height="7.4" rx="1.4" {...STROKE} />
      <path d="M7 8.6V6.4a3 3 0 0 1 6 0v2.2" {...STROKE} />
    </>
  ),
  refresh: (
    <>
      <path d="M16 10a6 6 0 1 1-1.9-4.4" {...STROKE} />
      <path d="M16.2 3.2v3.1h-3.1" {...STROKE} />
    </>
  ),
  play: <path d="M6.5 4.4 15 10l-8.5 5.6V4.4Z" {...STROKE} />,
  warning: (
    <>
      <path d="M10 3.4 17.4 16H2.6L10 3.4Z" {...STROKE} />
      <path d="M10 8.2v3.4M10 13.8v.1" {...STROKE} />
    </>
  ),
  check: <path d="M5 10.4 8.4 13.8 15 6.6" {...STROKE} />,
  chevron: <path d="M8 5.5 12.5 10 8 14.5" {...STROKE} />,
  calendar: (
    <>
      <rect x="3.4" y="4.6" width="13.2" height="12" rx="1.4" {...STROKE} />
      <path d="M3.4 8.4h13.2M7 3.2v2.6M13 3.2v2.6" {...STROKE} />
    </>
  ),
  target: (
    <>
      <circle cx="10" cy="10" r="6.6" {...STROKE} />
      <circle cx="10" cy="10" r="2.4" {...STROKE} />
    </>
  ),
  sliders: (
    <>
      <path d="M3.4 6.4h13.2M3.4 13.6h13.2" {...STROKE} />
      <circle cx="7.6" cy="6.4" r="1.9" {...STROKE} />
      <circle cx="12.6" cy="13.6" r="1.9" {...STROKE} />
    </>
  ),
  plus: <path d="M10 4.4v11.2M4.4 10h11.2" {...STROKE} />,
  "chevron-down": <path d="M5.5 8 10 12.5 14.5 8" {...STROKE} />,
  copy: (
    <>
      <rect x="7.2" y="7.2" width="9.2" height="9.2" rx="1.5" {...STROKE} />
      <path d="M12.8 4.6H5.1a1.5 1.5 0 0 0-1.5 1.5v7.7" {...STROKE} />
    </>
  ),
  diamond: <path d="M10 3.2 16.8 10 10 16.8 3.2 10 10 3.2Z" {...STROKE} />,
  pulse: <path d="M2.8 10.6h3.3l2-5 3 9.4 2.1-4.4h3.9" {...STROKE} />,
  stack: (
    <>
      <path d="M10 3.2 17 6.3 10 9.4 3 6.3l7-3.1Z" {...STROKE} />
      <path d="M3 10.2 10 13.3l7-3.1M3 13.8 10 16.9l7-3.1" {...STROKE} />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
}: {
  readonly name: IconName;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
