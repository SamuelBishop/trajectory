/**
 * Read and write a single configuration file as an editable document.
 *
 * Implements: [HC-EXPLICIT-CONFIG-PATHS], [HC-VALIDATE-IPC-INPUT]
 *
 * A document carries both the parsed model and the raw text, read once so the
 * form and the YAML tab cannot disagree about what is on disk. A file that
 * fails validation still returns its text with a `problem` set: the user broke
 * it by hand and needs to see it to fix it, and refusing to open the editor is
 * the one response that makes that impossible.
 */

import path from "node:path";

import YAML from "yaml";
import type { z } from "zod";

import {
  MENTOR_PROFILE_FILE,
  parseMentorProfileText,
  readConfigText,
  readOptionalConfigText,
  validateVoiceConfig,
} from "./config";
import {
  communicationConfigSchema,
  constraintsConfigSchema,
  currentStateConfigSchema,
  goalsConfigSchema,
  mentorProfileSchema,
  principlesConfigSchema,
  sourcesConfigSchema,
  valuesConfigSchema,
  voiceConfigSchema,
} from "./domain";
import { mentorDirectoryFor, mentorsRoot } from "./mentors";
import {
  writeFileAtomic,
  writeMentorProfile,
  writeYamlConfig,
  writeYamlText,
} from "./writer";

export interface ConfigDocument {
  readonly file: string;
  readonly text: string;
  readonly data: unknown;
  readonly problem?: string;
  readonly missing?: boolean;
}

const USER_DOCUMENTS = {
  goals: { file: "goals.yaml", schema: goalsConfigSchema },
  values: { file: "values.yaml", schema: valuesConfigSchema },
  current_state: {
    file: "current_state.yaml",
    schema: currentStateConfigSchema,
  },
  constraints: { file: "constraints.yaml", schema: constraintsConfigSchema },
  communication: {
    file: "communication.yaml",
    schema: communicationConfigSchema,
  },
} as const;

const MENTOR_DOCUMENTS = {
  profile: { file: MENTOR_PROFILE_FILE, schema: mentorProfileSchema },
  principles: { file: "principles.yaml", schema: principlesConfigSchema },
  sources: { file: "sources.yaml", schema: sourcesConfigSchema },
  voice: { file: "voice.yaml", schema: voiceConfigSchema },
} as const;

export type UserDocumentName = keyof typeof USER_DOCUMENTS;
export type MentorDocumentName = keyof typeof MENTOR_DOCUMENTS;

export const USER_DOCUMENT_NAMES = Object.keys(
  USER_DOCUMENTS,
) as UserDocumentName[];
export const MENTOR_DOCUMENT_NAMES = Object.keys(
  MENTOR_DOCUMENTS,
) as MentorDocumentName[];

export function isUserDocumentName(value: unknown): value is UserDocumentName {
  return typeof value === "string" && Object.hasOwn(USER_DOCUMENTS, value);
}

export function isMentorDocumentName(
  value: unknown,
): value is MentorDocumentName {
  return typeof value === "string" && Object.hasOwn(MENTOR_DOCUMENTS, value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readDocument(
  filePath: string,
  parse: (text: string) => unknown,
): Promise<ConfigDocument> {
  const file = path.basename(filePath);
  let text: string;
  try {
    text = await readConfigText(filePath);
  } catch (error) {
    // A file that is not there at all is a different failure from one that is
    // there and wrong, and the editor should not offer to "fix" the former.
    throw new Error(`Could not read ${file}: ${describe(error)}`);
  }
  try {
    return { file, text, data: parse(text) };
  } catch (error) {
    return { file, text, data: undefined, problem: describe(error) };
  }
}

async function readOptionalDocument(
  filePath: string,
  parse: (text: string) => unknown,
): Promise<ConfigDocument> {
  const file = path.basename(filePath);
  const text = await readOptionalConfigText(filePath);
  if (text === undefined) {
    return { file, text: "", data: undefined, missing: true };
  }
  try {
    return { file, text, data: parse(text) };
  } catch (error) {
    return { file, text, data: undefined, problem: describe(error) };
  }
}

function parseYamlWith(schema: z.ZodType): (text: string) => unknown {
  return (text) => schema.parse(YAML.parse(text));
}

async function validateVoiceDocument(
  configDirectory: string,
  mentorId: string,
  data: unknown,
): Promise<void> {
  const profileDocument = await readMentorDocument(
    configDirectory,
    mentorId,
    "profile",
  );
  const profile = mentorProfileSchema.parse(profileDocument.data);
  validateVoiceConfig(profile, voiceConfigSchema.parse(data));
}

export function userDocumentPath(
  userDirectory: string,
  name: UserDocumentName,
): string {
  return path.join(userDirectory, USER_DOCUMENTS[name].file);
}

export function mentorDocumentPath(
  configDirectory: string,
  mentorId: string,
  name: MentorDocumentName,
): string {
  return path.join(
    mentorDirectoryFor(mentorsRoot(configDirectory), mentorId),
    MENTOR_DOCUMENTS[name].file,
  );
}

export async function readUserDocument(
  userDirectory: string,
  name: UserDocumentName,
): Promise<ConfigDocument> {
  const { schema } = USER_DOCUMENTS[name];
  const filePath = userDocumentPath(userDirectory, name);
  return await readDocument(filePath, parseYamlWith(schema));
}

export async function writeUserDocument(
  userDirectory: string,
  name: UserDocumentName,
  data: unknown,
): Promise<ConfigDocument> {
  const { schema } = USER_DOCUMENTS[name];
  const filePath = userDocumentPath(userDirectory, name);
  await writeYamlConfig(filePath, schema, data);
  return await readUserDocument(userDirectory, name);
}

export async function writeUserDocumentText(
  userDirectory: string,
  name: UserDocumentName,
  text: string,
): Promise<ConfigDocument> {
  const { schema } = USER_DOCUMENTS[name];
  const filePath = userDocumentPath(userDirectory, name);
  await writeYamlText(filePath, schema, text);
  return await readUserDocument(userDirectory, name);
}

export async function readMentorDocument(
  configDirectory: string,
  mentorId: string,
  name: MentorDocumentName,
): Promise<ConfigDocument> {
  const filePath = mentorDocumentPath(configDirectory, mentorId, name);
  if (name === "profile") {
    return await readDocument(filePath, (text) =>
      parseMentorProfileText(filePath, text),
    );
  }
  if (name === "voice") {
    return await readOptionalDocument(
      filePath,
      parseYamlWith(MENTOR_DOCUMENTS[name].schema),
    );
  }
  return await readDocument(
    filePath,
    parseYamlWith(MENTOR_DOCUMENTS[name].schema),
  );
}

export async function writeMentorDocument(
  configDirectory: string,
  mentorId: string,
  name: MentorDocumentName,
  data: unknown,
): Promise<ConfigDocument> {
  const filePath = mentorDocumentPath(configDirectory, mentorId, name);
  if (name === "profile") {
    await writeMentorProfile(filePath, mentorProfileSchema, data);
  } else {
    if (name === "voice") {
      await validateVoiceDocument(configDirectory, mentorId, data);
    }
    await writeYamlConfig(filePath, MENTOR_DOCUMENTS[name].schema, data);
  }
  return await readMentorDocument(configDirectory, mentorId, name);
}

export async function writeMentorDocumentText(
  configDirectory: string,
  mentorId: string,
  name: MentorDocumentName,
  text: string,
): Promise<ConfigDocument> {
  const filePath = mentorDocumentPath(configDirectory, mentorId, name);
  if (name === "profile") {
    // Validate the front matter, then write the text verbatim so the prose body
    // and any formatting the user cares about survive untouched.
    parseMentorProfileText(filePath, text);
    await writeFileAtomic(filePath, text);
  } else {
    if (name === "voice") {
      await validateVoiceDocument(
        configDirectory,
        mentorId,
        parseYamlWith(voiceConfigSchema)(text),
      );
    }
    await writeYamlText(filePath, MENTOR_DOCUMENTS[name].schema, text);
  }
  return await readMentorDocument(configDirectory, mentorId, name);
}
