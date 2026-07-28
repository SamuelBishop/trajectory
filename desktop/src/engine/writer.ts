/**
 * Write configuration back to disk without ever leaving it unloadable.
 *
 * Implements: [HC-ATOMIC-SERIALIZED-WRITES], [HC-EXPLICIT-CONFIG-PATHS]
 *
 * Config is read on every message, so an invalid write breaks chat until the
 * user finds the file and repairs it by hand. Two defences: nothing is written
 * before it validates against the same schema the loader uses, and the write
 * itself is atomic, so a crash mid-write leaves the previous file intact.
 */

import { open, rename, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import YAML from "yaml";
import type { z } from "zod";

import { ConfigurationError } from "./errors";

/**
 * Serialized output is re-read by the loader, so keep it wide rather than
 * letting the emitter fold long prose into continuation lines.
 */
const STRINGIFY_OPTIONS = { lineWidth: 0 } as const;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const location = issue.path.join(".");
      return location ? `${location}: ${issue.message}` : issue.message;
    })
    .join("\n");
}

function validateOrThrow<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
  raw: unknown,
): z.infer<SchemaT> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigurationError(
      `Invalid configuration for ${path.basename(filePath)}:\n${formatIssues(
        result.error,
      )}`,
    );
  }
  return result.data;
}

/**
 * Writes are serialized per path. Two saves of the same file from a
 * double-click would otherwise interleave their temp-file dance and the loser
 * would silently win.
 */
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  queues.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export async function writeFileAtomic(
  filePath: string,
  contents: string,
): Promise<void> {
  await enqueue(filePath, async () => {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, filePath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  });
}

/**
 * Serialize a model the form produced. The round trip is deliberate: emitting
 * YAML that no longer parses back to the same model is a bug in this file, and
 * catching it here costs microseconds instead of breaking the next message.
 */
export function serializeConfig<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
  model: unknown,
): string {
  const validated = validateOrThrow(filePath, schema, model);
  const text = YAML.stringify(validated, STRINGIFY_OPTIONS);
  let reparsed: unknown;
  try {
    reparsed = YAML.parse(text);
  } catch (error) {
    throw new ConfigurationError(
      `Serialized ${path.basename(filePath)} could not be read back`,
      { cause: error },
    );
  }
  validateOrThrow(filePath, schema, reparsed);
  return text;
}

/** Save a model produced by the structured form. */
export async function writeYamlConfig<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
  model: unknown,
): Promise<void> {
  await writeFileAtomic(filePath, serializeConfig(filePath, schema, model));
}

/**
 * Save raw YAML the user typed. The text is written exactly as given so
 * comments and ordering survive; only its meaning is checked.
 */
export async function writeYamlText<SchemaT extends z.ZodType>(
  filePath: string,
  schema: SchemaT,
  text: string,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new ConfigurationError(
      `Invalid YAML in ${path.basename(filePath)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigurationError(
      `Expected a YAML mapping in ${path.basename(filePath)}`,
    );
  }
  validateOrThrow(filePath, schema, parsed);
  await writeFileAtomic(filePath, text);
}

/**
 * A mentor profile is front matter plus prose. The body is not part of the
 * front matter mapping, so it is split out before validation and restored
 * after.
 */
export function serializeMentorProfile(
  filePath: string,
  schema: z.ZodType,
  model: unknown,
): string {
  const validated = validateOrThrow(filePath, schema, model) as Record<
    string,
    unknown
  >;
  const { body, ...frontMatter } = validated;
  const text = `---\n${YAML.stringify(frontMatter, STRINGIFY_OPTIONS)}---\n\n${String(
    body ?? "",
  ).trim()}\n`;
  return text;
}

export async function writeMentorProfile(
  filePath: string,
  schema: z.ZodType,
  model: unknown,
): Promise<void> {
  await writeFileAtomic(
    filePath,
    serializeMentorProfile(filePath, schema, model),
  );
}
