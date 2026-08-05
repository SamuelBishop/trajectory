/**
 * The logo exists twice: as resources/icon.svg, which macOS and Windows
 * rasterise, and as ui/Mark.tsx, which the sidebar renders. Nothing in the build
 * couples them, so this is what stops the dock and the sidebar from disagreeing
 * about what the app looks like.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AHEAD_PATH, OBSERVED_PATH } from "../src/renderer/src/ui/Mark";

const DESKTOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(DESKTOP, "resources/icon.svg"), "utf8");
// The comments explain which attributes were avoided and why, so an assertion
// about the markup has to read the markup.
const svg = source.replace(/<!--[\s\S]*?-->/g, "");

describe("the app icon", () => {
  it("draws the same two segments the in-app mark draws", () => {
    expect(svg).toContain(`d="${OBSERVED_PATH}"`);
    expect(svg).toContain(`d="${AHEAD_PATH}"`);
  });

  it("puts the node where the two segments meet", () => {
    // Both segments name 512 512 as their shared endpoint, so a node anywhere
    // else would sit off the path.
    expect(OBSERVED_PATH.endsWith("512 512")).toBe(true);
    expect(AHEAD_PATH.startsWith("M512 512")).toBe(true);
    expect(svg).toContain('cx="512" cy="512"');
  });

  it("keeps the halves visually distinct", () => {
    // The split between observed and intended is the point of the mark. A
    // rasteriser that drops stroke-opacity already flattened it once, which is
    // why the difference is carried by literal colour.
    expect(svg).toContain('stroke="#8aa36a"');
    expect(svg).toContain('stroke="#687d52"');
    expect(svg).not.toContain("stroke-opacity");
  });

  it("is square, so no platform crops it", () => {
    expect(svg).toContain('viewBox="0 0 1024 1024"');
  });
});
