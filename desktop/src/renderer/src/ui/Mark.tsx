/**
 * The Trajectory mark, without its tile.
 *
 * The tile is CSS, because the two places this appears want different sizes of
 * the same treatment. What lives here is only the glyph: a path rising left to
 * right, solid across the ground already covered and dimmer across the part
 * only the goal accounts for, with a node at today sitting on the join.
 *
 * The geometry is repeated from resources/icon.svg, which is what macOS and
 * Windows rasterise. tests/icon.test.ts fails if the two drift apart, so the
 * dock and the sidebar cannot end up showing different logos.
 */

/** The ground already covered — what the integrations actually observed. */
export const OBSERVED_PATH = "M216 764C348 754 448 672 512 512";
/** Where the stated goal points, which has not happened yet. */
export const AHEAD_PATH = "M512 512C576 352 676 270 808 260";

export function Mark(): React.JSX.Element {
  return (
    // Cropped tight to the glyph so the CSS tile controls the padding rather
    // than inheriting the dock icon's much roomier margins.
    <svg className="mark" viewBox="190 190 644 644" aria-hidden focusable="false">
      <g fill="none" strokeWidth={84} strokeLinecap="round">
        <path d={OBSERVED_PATH} stroke="#8aa36a" />
        <path d={AHEAD_PATH} stroke="#687d52" />
      </g>
      <circle cx={512} cy={512} r={98} className="mark-node-ring" />
      <circle cx={512} cy={512} r={78} fill="#d8e5c9" />
    </svg>
  );
}
