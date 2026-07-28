/**
 * Load user and mentor configuration from explicit local paths.
 *
 * Implements: [HC-EXPLICIT-CONFIG-PATHS], [HC-MENTOR-IDENTITY-INTEGRITY]
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";
import type { z } from "zod";

import {
  communicationConfigSchema,
  constraintsConfigSchema,
  currentStateConfigSchema,
  goalsConfigSchema,
  mentorProfileSchema,
  principlesConfigSchema,
  sourcesConfigSchema,
  valuesConfigSchema,
  type MentorProfile,
  type MentorResources,
  type UserConfig,
} from "./domain";
import { AttributionError, ConfigurationError } from "./errors";

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConfigurationError(
        `Required configuration file not found: ${filePath}`,
        { cause: error },
      );
    }
    throw new ConfigurationError(
      `Could not read configuration file ${filePath}: ${String(error)}`,
      { cause: error },
    );
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.join(".");
      return location ? `${location}: ${issue.message}` : issue.message;
    })
    .join("\n");
}

function parseYaml(filePath: string, text: string): unknown {
  try {
    return YAML.parse(text);
  } catch (error) {
    throw new ConfigurationError(
      `Invalid YAML in ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function validate<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
  raw: unknown,
  label = "configuration",
): z.infer<SchemaT> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigurationError(
      `Invalid ${label} in ${filePath}:\n${formatIssues(result.error)}`,
    );
  }
  return result.data;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readYamlModel<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
): Promise<z.infer<SchemaT>> {
  const raw = parseYaml(filePath, await readText(filePath));
  if (!isMapping(raw)) {
    throw new ConfigurationError(`Expected a YAML mapping in ${filePath}`);
  }
  return validate(filePath, schema, raw);
}

/** Split on a separator at most `maxSplit` times, mirroring Python's `str.split`. */
function splitLimited(value: string, separator: string, maxSplit: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < maxSplit; index += 1) {
    const found = value.indexOf(separator, start);
    if (found === -1) {
      break;
    }
    parts.push(value.slice(start, found));
    start = found + separator.length;
  }
  parts.push(value.slice(start));
  return parts;
}

/**
 * Parse a mentor profile from text. Exported so the editor can validate what
 * the user typed without writing it first, using exactly the same rules the
 * loader applies.
 */
export function parseMentorProfileText(
  filePath: string,
  text: string,
): MentorProfile {
  if (!text.startsWith("---\n")) {
    throw new ConfigurationError(
      `Mentor profile must start with YAML front matter: ${filePath}`,
    );
  }
  const segments = splitLimited(text, "---", 2);
  if (segments.length < 3) {
    throw new ConfigurationError(
      `Invalid mentor profile front matter in ${filePath}: unterminated front matter`,
    );
  }
  const frontMatter = segments[1] ?? "";
  const body = segments[2] ?? "";
  const raw = parseYaml(filePath, frontMatter);
  if (!isMapping(raw)) {
    throw new ConfigurationError(
      `Expected a YAML mapping in mentor profile: ${filePath}`,
    );
  }
  return validate(
    filePath,
    mentorProfileSchema,
    { ...raw, body: body.trim() },
    "mentor profile",
  );
}

async function readMarkdownProfile(filePath: string): Promise<MentorProfile> {
  return parseMentorProfileText(filePath, await readText(filePath));
}

function assertUniqueIds(records: readonly { id: string }[], kind: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates.add(record.id);
    }
    seen.add(record.id);
  }
  if (duplicates.size > 0) {
    throw new ConfigurationError(
      `Duplicate ${kind} IDs: ${[...duplicates].sort().join(", ")}`,
    );
  }
}

/**
 * The editable surface. Every file the app lets you change is listed here with
 * the schema that governs it, so the writer and the IPC layer cannot disagree
 * with the loader about what is valid.
 */
export const USER_CONFIG_FILES = {
  "values.yaml": valuesConfigSchema,
  "goals.yaml": goalsConfigSchema,
  "current_state.yaml": currentStateConfigSchema,
  "constraints.yaml": constraintsConfigSchema,
  "communication.yaml": communicationConfigSchema,
} as const;

export const MENTOR_CONFIG_FILES = {
  "sources.yaml": sourcesConfigSchema,
  "principles.yaml": principlesConfigSchema,
} as const;

export const MENTOR_PROFILE_FILE = "profile.md";

export type UserConfigFileName = keyof typeof USER_CONFIG_FILES;
export type MentorConfigFileName = keyof typeof MENTOR_CONFIG_FILES;

export function isUserConfigFile(name: string): name is UserConfigFileName {
  return Object.hasOwn(USER_CONFIG_FILES, name);
}

export function isMentorConfigFile(name: string): name is MentorConfigFileName {
  return Object.hasOwn(MENTOR_CONFIG_FILES, name);
}

/** Raw file text for the advanced YAML editor, which must show what is on disk. */
export async function readConfigText(filePath: string): Promise<string> {
  return await readText(filePath);
}

export async function loadUserConfig(directory: string): Promise<UserConfig> {
  const at = (name: string): string => path.join(directory, name);
  const [values, goals, currentState, constraints, communication] =
    await Promise.all([
      readYamlModel(at("values.yaml"), valuesConfigSchema),
      readYamlModel(at("goals.yaml"), goalsConfigSchema),
      readYamlModel(at("current_state.yaml"), currentStateConfigSchema),
      readYamlModel(at("constraints.yaml"), constraintsConfigSchema),
      readYamlModel(at("communication.yaml"), communicationConfigSchema),
    ]);
  assertUniqueIds(goals.goals, "goal");
  return {
    values,
    goals: goals.goals,
    current_state: currentState,
    constraints,
    communication,
  };
}

export async function loadMentorResources(
  directory: string,
): Promise<MentorResources> {
  const at = (name: string): string => path.join(directory, name);
  const profile = await readMarkdownProfile(at("profile.md"));
  const [sourcesConfig, principlesConfig] = await Promise.all([
    readYamlModel(at("sources.yaml"), sourcesConfigSchema),
    readYamlModel(at("principles.yaml"), principlesConfigSchema),
  ]);
  const { sources } = sourcesConfig;
  const { principles } = principlesConfig;
  assertUniqueIds(sources, "source");
  assertUniqueIds(principles, "principle");

  const sourceIds = new Set(sources.map((source) => source.id));
  for (const source of sources) {
    if (source.mentor_id !== profile.id) {
      throw new AttributionError(
        `Source ${source.id} belongs to ${source.mentor_id}, not profile ${profile.id}`,
      );
    }
    if (!source.approved) {
      throw new AttributionError(`Source ${source.id} has not been approved`);
    }
    if (profile.fictional && !source.synthetic) {
      throw new AttributionError(
        `Fictional profile source ${source.id} must be synthetic`,
      );
    }
  }

  for (const principle of principles) {
    if (principle.mentor_id !== profile.id) {
      throw new AttributionError(
        `Principle ${principle.id} belongs to ${principle.mentor_id}, not profile ${profile.id}`,
      );
    }
    const missing = principle.source_ids
      .filter((id) => !sourceIds.has(id))
      .sort();
    if (missing.length > 0) {
      throw new AttributionError(
        `Principle ${principle.id} references unknown sources: ${missing.join(", ")}`,
      );
    }
    if (profile.fictional && principle.support_type !== "synthetic_demo") {
      throw new AttributionError(
        `Fictional profile principle ${principle.id} must use synthetic_demo support`,
      );
    }
  }

  return { profile, sources, principles };
}
