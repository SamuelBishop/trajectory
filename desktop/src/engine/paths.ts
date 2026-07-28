/**
 * Resolve local configuration paths and seed bundled demo data on first launch.
 *
 * Implements: [HC-EXPLICIT-CONFIG-PATHS], [HC-NO-PRIVATE-DATA-COMMITTED]
 *
 * Bundled data is read-only and lives inside the application. The copy the user
 * actually edits lives in the OS user-data directory, is never committed, and is
 * never overwritten once it exists.
 */

import path from "node:path";
import { access, cp, mkdir, readdir } from "node:fs/promises";

import { mentorDirectoryFor } from "./mentors";

export interface BundledData {
  readonly userDirectory: string;
  readonly mentorsDirectory: string;
}

export interface LocalConfig {
  readonly configDirectory: string;
  readonly userDirectory: string;
  readonly mentorDirectory: string;
  readonly mentorsDirectory: string;
  readonly activeMentorId: string;
}

export const DEMO_MENTOR_ID = "demo_mentor";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Packaged builds read from `extraResources`; development reads from the
 * repository so edits to the demo data are picked up without a rebuild.
 */
export function resolveBundledData(options: {
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
  readonly appPath: string;
}): BundledData {
  if (options.isPackaged) {
    const root = path.join(options.resourcesPath, "trajectory-data");
    return {
      userDirectory: path.join(root, "user"),
      mentorsDirectory: path.join(root, "mentors"),
    };
  }
  const repositoryRoot = path.resolve(options.appPath, "..");
  return {
    userDirectory: path.join(repositoryRoot, "examples", "demo", "user"),
    mentorsDirectory: path.join(repositoryRoot, "resources", "mentors"),
  };
}

async function seedDirectory(source: string, destination: string): Promise<void> {
  if (await exists(destination)) {
    return;
  }
  if (!(await exists(source))) {
    throw new Error(`Bundled configuration is missing: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, errorOnExist: true });
}

/**
 * Seed every bundled mentor, not just the active one, so the Mentors view has
 * something to list on first launch. `seedDirectory` no-ops when the
 * destination exists, so the user's own edits always win.
 */
async function seedAllMentors(
  bundledMentorsDirectory: string,
  mentorsDirectory: string,
): Promise<void> {
  let bundled: string[];
  try {
    bundled = (
      await readdir(bundledMentorsDirectory, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return;
  }
  await Promise.all(
    bundled.map((id) =>
      seedDirectory(
        path.join(bundledMentorsDirectory, id),
        path.join(mentorsDirectory, id),
      ),
    ),
  );
}

export async function ensureLocalConfig(
  bundled: BundledData,
  userDataPath: string,
  mentorId: string = DEMO_MENTOR_ID,
): Promise<LocalConfig> {
  const configDirectory = path.join(userDataPath, "config");
  const userDirectory = path.join(configDirectory, "user");
  const mentorsDirectory = path.join(configDirectory, "mentors");

  await seedDirectory(bundled.userDirectory, userDirectory);
  await seedAllMentors(bundled.mentorsDirectory, mentorsDirectory);

  // A settings file can name a mentor the user has since deleted. Falling back
  // to the demo mentor keeps chat working; refusing to start would not.
  const requested = mentorDirectoryFor(mentorsDirectory, mentorId);
  const mentorDirectory = (await exists(requested))
    ? requested
    : mentorDirectoryFor(mentorsDirectory, DEMO_MENTOR_ID);

  return {
    configDirectory,
    userDirectory,
    mentorDirectory,
    mentorsDirectory,
    activeMentorId: path.basename(mentorDirectory),
  };
}
