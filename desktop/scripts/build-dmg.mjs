/**
 * Wraps the packaged .app into a distributable disk image.
 *
 * electron-builder's own dmg target drives dmgbuild, which mounts the volume to
 * arrange the window and then fails to detach it — "Resource busy", every run,
 * because something on the machine is still reading the freshly written volume.
 * hdiutil can build the image straight from a folder without ever mounting it,
 * and the only thing lost is the positioning of two icons.
 *
 * The image is not notarised and carries no Developer ID, so macOS will refuse
 * it on first open. The release notes say so and say what to do about it;
 * quietly shipping something that looks blocked would be worse than saying it.
 */

import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const DESKTOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const { version, build } = JSON.parse(
  await readFile(path.join(DESKTOP, "package.json"), "utf8"),
);
const product = build.productName;

// The .app electron-builder just wrote. Only the host architecture is built,
// because @github/copilot-sdk ships a per-architecture binary and npm installs
// only the one this machine needs.
const arch = process.arch;
const app = path.join(DESKTOP, `release/mac-${arch}/${product}.app`);
const out = path.join(DESKTOP, `release/${product}-${version}-${arch}.dmg`);

const staging = await mkdtemp(path.join(tmpdir(), "trajectory-dmg-"));
try {
  await cp(app, path.join(staging, `${product}.app`), {
    recursive: true,
    verbatimSymlinks: true,
  });

  // Electron leaves behind a linker signature that claims resources the bundle
  // does not have. macOS reads that as corruption and offers to move the app to
  // the Trash — a dead end, because right-click-Open does not override
  // "damaged". A real ad-hoc signature over the assembled bundle is still not
  // trusted, but it is well-formed, so the user gets the ordinary unidentified
  // developer warning they can actually get past.
  await run("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    path.join(staging, `${product}.app`),
  ]);

  // The half of "drag this there" that makes a disk image an installer.
  await symlink("/Applications", path.join(staging, "Applications"));

  await rm(out, { force: true });
  await run(
    "hdiutil",
    [
      "create",
      "-volname",
      `${product} ${version}`,
      "-srcfolder",
      staging,
      "-ov",
      "-format",
      "UDZO", // compressed, and read-only so the contents cannot be edited
      "-fs",
      "HFS+",
      out,
    ],
    { maxBuffer: 1024 * 1024 * 32 },
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}

console.log(out);
