/**
 * Manage the set of mentor profiles the user can switch between.
 *
 * Implements: [HC-MENTOR-IDENTITY-INTEGRITY], [HC-EXPLICIT-CONFIG-PATHS]
 *
 * A mentor id arrives from the renderer and becomes a directory name, so it is
 * the one value here that an attacker — or a careless paste — could use to
 * reach outside the configuration directory. It is checked twice: once against
 * a pattern that admits nothing exotic, and once by resolving the path and
 * confirming it still sits under the mentors directory. The second check is
 * what actually holds if the first is ever loosened.
 */

import path from "node:path";
import { mkdir, readdir, rm } from "node:fs/promises";

import { loadMentorResources } from "./config";
import {
  mentorProfileSchema,
  principlesConfigSchema,
  sourcesConfigSchema,
  voiceConfigSchema,
} from "./domain";
import { ConfigurationError } from "./errors";
import { writeMentorProfile, writeYamlConfig } from "./writer";

/** Lowercase, digits, and underscores. Deliberately narrower than the filesystem allows. */
const MENTOR_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export interface MentorSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domains: readonly string[];
  readonly fictional: boolean;
  readonly disclaimer: string;
  /** False when the profile is present but fails to load, so the UI can say so. */
  readonly loadable: boolean;
  readonly problem?: string;
}

export function assertValidMentorId(id: string): string {
  if (!MENTOR_ID_PATTERN.test(id)) {
    throw new ConfigurationError(
      "A mentor ID must start with a letter and use only lowercase letters, " +
        "digits, and underscores.",
    );
  }
  return id;
}

/**
 * Resolve a mentor directory, refusing anything that escapes the parent even
 * if the pattern check were bypassed.
 */
export function mentorDirectoryFor(
  mentorsDirectory: string,
  id: string,
): string {
  assertValidMentorId(id);
  const base = path.resolve(mentorsDirectory);
  const resolved = path.resolve(base, id);
  if (resolved !== path.join(base, id) || !resolved.startsWith(base + path.sep)) {
    throw new ConfigurationError("That mentor ID is not allowed.");
  }
  return resolved;
}

export function mentorsRoot(configDirectory: string): string {
  return path.join(configDirectory, "mentors");
}

/**
 * List every profile on disk. A profile that fails to load is still listed, so
 * a user who broke their own YAML can see it and go fix it rather than having
 * it silently vanish.
 */
export async function listMentors(
  configDirectory: string,
): Promise<MentorSummary[]> {
  const root = mentorsRoot(configDirectory);
  let entries: string[];
  try {
    entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    entries.sort().map(async (id): Promise<MentorSummary | undefined> => {
      if (!MENTOR_ID_PATTERN.test(id)) {
        return undefined;
      }
      try {
        const { profile } = await loadMentorResources(path.join(root, id));
        return {
          id: profile.id,
          name: profile.name,
          description: profile.description,
          domains: profile.domains,
          fictional: profile.fictional,
          disclaimer: profile.disclaimer,
          loadable: true,
        };
      } catch (error) {
        return {
          id,
          name: id,
          description: "",
          domains: [],
          fictional: true,
          disclaimer: "",
          loadable: false,
          problem: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  return summaries.filter((item): item is MentorSummary => item !== undefined);
}

/**
 * Copy an existing profile under a new id. Every record inside a mentor
 * directory carries its own `mentor_id`, and `loadMentorResources` rejects a
 * mismatch, so those have to be rewritten rather than copied verbatim.
 */
export async function duplicateMentor(
  configDirectory: string,
  sourceId: string,
  targetId: string,
  name: string,
): Promise<void> {
  const root = mentorsRoot(configDirectory);
  const from = mentorDirectoryFor(root, sourceId);
  const to = mentorDirectoryFor(root, targetId);

  const existing = await listMentors(configDirectory);
  if (existing.some((mentor) => mentor.id === targetId)) {
    throw new ConfigurationError(`A mentor called ${targetId} already exists.`);
  }

  const resources = await loadMentorResources(from);
  await mkdir(to, { recursive: true });
  try {
    await writeMentorProfile(path.join(to, "profile.md"), mentorProfileSchema, {
      ...resources.profile,
      id: targetId,
      name,
    });
    await writeYamlConfig(path.join(to, "sources.yaml"), sourcesConfigSchema, {
      sources: resources.sources.map((source) => ({
        ...source,
        mentor_id: targetId,
      })),
    });
    await writeYamlConfig(
      path.join(to, "principles.yaml"),
      principlesConfigSchema,
      {
        principles: resources.principles.map((principle) => ({
          ...principle,
          mentor_id: targetId,
        })),
      },
    );
    if (resources.voice) {
      await writeYamlConfig(
        path.join(to, "voice.yaml"),
        voiceConfigSchema,
        {
          ...resources.voice,
          mentor_id: targetId,
        },
      );
    }
  } catch (error) {
    // A half-written mentor directory fails to load and would strand the user
    // with a profile they cannot open or delete cleanly.
    await rm(to, { recursive: true, force: true });
    throw error;
  }
}

export async function deleteMentor(
  configDirectory: string,
  id: string,
): Promise<void> {
  const target = mentorDirectoryFor(mentorsRoot(configDirectory), id);
  const remaining = (await listMentors(configDirectory)).filter(
    (mentor) => mentor.id !== id,
  );
  if (remaining.length === 0) {
    throw new ConfigurationError(
      "That is the only mentor. Create another before deleting this one.",
    );
  }
  await rm(target, { recursive: true, force: true });
}
