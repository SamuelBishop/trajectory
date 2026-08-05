/**
 * Rasterises resources/icon.svg into the icons electron-builder ships.
 *
 * The SVG is the source of truth; everything under build/ is derived and can be
 * regenerated with `npm run icons`. The outputs are committed anyway, because
 * packaging must not depend on a macOS-only toolchain being present.
 *
 * sips and iconutil are part of macOS. The ICO is assembled here rather than by
 * a library: the format is a header, a directory, and PNGs, and a dependency
 * that ships a binary encoder is a poor trade for forty lines.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const DESKTOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE = path.join(DESKTOP, "resources/icon.svg");
const BUILD = path.join(DESKTOP, "build");

/** macOS asks for each size twice: once plain, once at 2x for retina. */
const ICONSET = [16, 32, 128, 256, 512];
/** Windows picks the closest of whatever the file offers. */
const ICO = [16, 32, 48, 64, 128, 256];

const rasterise = async (size, out) => {
  await run("sips", [
    "-s",
    "format",
    "png",
    "--resampleHeightWidth",
    String(size),
    String(size),
    SOURCE,
    "--out",
    out,
  ]);
};

/**
 * ICO is a 6-byte header, then one 16-byte directory entry per image, then the
 * payloads. Every payload here is a PNG, which every Windows since Vista reads.
 */
const buildIco = (images) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, data }, i) => {
    const at = i * 16;
    // 256 does not fit in a byte, and the format spells it as 0.
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
};

await mkdir(BUILD, { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), "trajectory-icons-"));

try {
  const iconset = path.join(scratch, "icon.iconset");
  await mkdir(iconset);
  for (const size of ICONSET) {
    await rasterise(size, path.join(iconset, `icon_${size}x${size}.png`));
    await rasterise(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  await run("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(BUILD, "icon.icns"),
  ]);

  const images = [];
  for (const size of ICO) {
    const out = path.join(scratch, `ico-${size}.png`);
    await rasterise(size, out);
    images.push({ size, data: await readFile(out) });
  }
  await writeFile(path.join(BUILD, "icon.ico"), buildIco(images));

  // Linux, and the fallback electron-builder reaches for when a target has no
  // format of its own.
  await rasterise(1024, path.join(BUILD, "icon.png"));
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log("icons written to build/");
