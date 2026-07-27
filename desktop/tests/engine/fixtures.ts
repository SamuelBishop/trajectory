import path from "node:path";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import YAML from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

export const userDirectory = path.join(repoRoot, "examples", "demo", "user");
export const mentorDirectory = path.join(
  repoRoot,
  "resources",
  "mentors",
  "demo_mentor",
);

/** Copy a config directory into a fresh temp dir so tests can mutate it safely. */
export async function copyFixture(source: string, name: string): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), "trajectory-test-"));
  const destination = path.join(base, name);
  await cp(source, destination, { recursive: true });
  return destination;
}

export async function editYaml(
  filePath: string,
  mutate: (raw: Record<string, any>) => void,
): Promise<void> {
  const raw = YAML.parse(await readFile(filePath, "utf8")) as Record<string, any>;
  mutate(raw);
  await writeFile(filePath, YAML.stringify(raw), "utf8");
}
