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
import { access, cp, mkdir } from "node:fs/promises";

export interface BundledData {
  readonly userDirectory: string;
  readonly mentorsDirectory: string;
}

export interface LocalConfig {
  readonly configDirectory: string;
  readonly userDirectory: string;
  readonly mentorDirectory: string;
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

export async function ensureLocalConfig(
  bundled: BundledData,
  userDataPath: string,
  mentorId: string = DEMO_MENTOR_ID,
): Promise<LocalConfig> {
  const configDirectory = path.join(userDataPath, "config");
  const userDirectory = path.join(configDirectory, "user");
  const mentorDirectory = path.join(configDirectory, "mentors", mentorId);

  await seedDirectory(bundled.userDirectory, userDirectory);
  await seedDirectory(
    path.join(bundled.mentorsDirectory, mentorId),
    mentorDirectory,
  );

  return { configDirectory, userDirectory, mentorDirectory };
}
