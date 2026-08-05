/**
 * The marks of the services Trajectory reads from.
 *
 * Separate from `Icon.tsx` because these behave differently. A UI icon is a
 * stroked `currentColor` path that adopts whatever state it sits in; a service
 * mark has to stay recognisably itself, so these are filled, carry their own
 * colour, and sit in a tinted tile. A GitHub mark that turned green on hover
 * would stop being the GitHub mark.
 *
 * Each mark is a trademark of its owner and appears here for one purpose: to
 * identify which service a row is connected to. Trajectory is not affiliated
 * with any of them.
 *
 * Drawn inline for the same reason as `Icon.tsx` — five glyphs do not justify
 * a dependency, and an SVG in the bundle is one fewer file to load at runtime.
 */

export type BrandName = "github" | "notion" | "strava" | "google-sheets";

interface Mark {
  /** The tile's tint, at low alpha behind the glyph. */
  readonly tint: string;
  readonly ink: string;
  readonly path: React.ReactNode;
}

const MARKS: Readonly<Record<BrandName, Mark>> = {
  github: {
    tint: "rgba(230, 237, 243, 0.09)",
    ink: "#e6edf3",
    path: (
      <path
        fill="currentColor"
        d="M12 2.2a9.8 9.8 0 0 0-3.1 19.1c.49.09.67-.21.67-.47v-1.8c-2.73.59-3.3-1.16-3.3-1.16-.45-1.13-1.09-1.43-1.09-1.43-.89-.61.07-.6.07-.6.98.07 1.5 1.01 1.5 1.01.88 1.5 2.3 1.07 2.86.82.09-.64.34-1.07.62-1.32-2.18-.25-4.47-1.09-4.47-4.85 0-1.07.38-1.95 1.01-2.63-.1-.25-.44-1.25.1-2.6 0 0 .82-.27 2.7 1a9.3 9.3 0 0 1 4.92 0c1.87-1.27 2.7-1 2.7-1 .54 1.35.2 2.35.1 2.6.63.68 1.01 1.56 1.01 2.63 0 3.77-2.3 4.6-4.49 4.84.35.31.67.91.67 1.85v2.74c0 .26.18.57.68.47A9.8 9.8 0 0 0 12 2.2Z"
      />
    ),
  },
  notion: {
    tint: "rgba(255, 255, 255, 0.08)",
    ink: "#ffffff",
    path: (
      <>
        <rect
          x="3.3"
          y="3.3"
          width="17.4"
          height="17.4"
          rx="2.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          fill="currentColor"
          d="M8.2 16.4V7.9h1.9l4 5.6V7.9h1.7v8.5h-1.8l-4.1-5.8v5.8H8.2Z"
        />
      </>
    ),
  },
  strava: {
    tint: "rgba(252, 76, 2, 0.16)",
    ink: "#fc5200",
    path: (
      <path
        fill="currentColor"
        d="M10.6 2.4 5.1 13.2h3.26l2.24-4.42 2.2 4.42h3.24L10.6 2.4Zm4.24 10.8-1.6 3.15-1.62-3.15H9.2l3.44 6.75 3.42-6.75h-2.22Z"
      />
    ),
  },
  "google-sheets": {
    tint: "rgba(15, 157, 88, 0.18)",
    ink: "#3ecf8e",
    path: (
      <>
        <path
          fill="currentColor"
          d="M13.6 2.4H6.9a1.7 1.7 0 0 0-1.7 1.7v15.8a1.7 1.7 0 0 0 1.7 1.7h10.2a1.7 1.7 0 0 0 1.7-1.7V7.4l-5.2-5Zm0 1.6 3.6 3.5h-3.6V4Z"
          opacity="0.45"
        />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          d="M8.3 11.4h7.4v6.2H8.3zM8.3 14.5h7.4M12 11.4v6.2"
        />
      </>
    ),
  },
};

/**
 * A service mark, or a neutral tile when the source is not one we know.
 *
 * The fallback is deliberate. A source Trajectory cannot name should still get
 * a row of the same shape, rather than a ragged one that hints the app is
 * broken — it just does not get to borrow someone else's identity.
 */
export function BrandIcon({
  brand,
  size = 22,
}: {
  readonly brand: BrandName | null;
  readonly size?: number;
}): React.JSX.Element {
  const mark = brand === null ? null : MARKS[brand];

  return (
    <span
      className="brand-tile"
      style={{
        width: size + 14,
        height: size + 14,
        background: mark?.tint ?? "rgba(255, 255, 255, 0.05)",
        color: mark?.ink ?? "var(--ink-faint)",
      }}
      aria-hidden
    >
      {mark === null ? (
        <svg width={size} height={size} viewBox="0 0 24 24">
          <rect
            x="3.6"
            y="3.6"
            width="16.8"
            height="16.8"
            rx="3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M8 12h8M8 8.6h8M8 15.4h5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24">
          {mark.path}
        </svg>
      )}
    </span>
  );
}
