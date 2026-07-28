import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";
import YAML from "yaml";

import {
  goalsConfigSchema,
  mentorProfileSchema,
  valuesConfigSchema,
} from "../../src/engine/domain";
import { ConfigurationError } from "../../src/engine/errors";
import { loadUserConfig } from "../../src/engine/config";
import {
  serializeMentorProfile,
  writeFileAtomic,
  writeYamlConfig,
  writeYamlText,
} from "../../src/engine/writer";
import { userDirectory } from "./fixtures";

async function scratch(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "trajectory-writer-"));
}

const values = {
  core_values: ["Craft"],
  non_negotiables: ["Protect sleep"],
  definitions_of_success: ["Durable judgment"],
  unacceptable_tradeoffs: ["Chronic overwork"],
};

describe("configuration writer", () => {
  it("writes a model the loader can read back", async () => {
    const directory = await scratch();
    // Start from the real demo files so the directory is loadable, then
    // overwrite one of them through the writer.
    for (const name of [
      "goals.yaml",
      "current_state.yaml",
      "constraints.yaml",
      "communication.yaml",
    ]) {
      await writeFile(
        path.join(directory, name),
        await readFile(path.join(userDirectory, name), "utf8"),
      );
    }

    await writeYamlConfig(
      path.join(directory, "values.yaml"),
      valuesConfigSchema,
      values,
    );

    const loaded = await loadUserConfig(directory);
    expect(loaded.values.core_values).toEqual(["Craft"]);
  });

  it("refuses to write a model that fails its schema", async () => {
    const directory = await scratch();
    const target = path.join(directory, "values.yaml");

    await expect(
      writeYamlConfig(target, valuesConfigSchema, { core_values: "not a list" }),
    ).rejects.toThrow(ConfigurationError);
    // The point of validating first: nothing reached disk.
    await expect(readFile(target, "utf8")).rejects.toThrow();
  });

  it("names the offending field so the form can point at it", async () => {
    const directory = await scratch();

    const error = await writeYamlConfig(
      path.join(directory, "goals.yaml"),
      goalsConfigSchema,
      { goals: [{ id: "x", description: "", priority: 1, domain: "career" }] },
    ).then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );

    expect(error?.message).toContain("goals.0");
  });

  it("preserves comments and ordering when raw YAML is saved", async () => {
    const directory = await scratch();
    const target = path.join(directory, "values.yaml");
    const text = `# hand-written note\ncore_values:\n  - Craft\nnon_negotiables:\n  - Protect sleep\ndefinitions_of_success:\n  - Durable judgment\nunacceptable_tradeoffs:\n  - Chronic overwork\n`;

    await writeYamlText(target, valuesConfigSchema, text);

    expect(await readFile(target, "utf8")).toBe(text);
  });

  it("rejects raw YAML that does not parse", async () => {
    const directory = await scratch();

    await expect(
      writeYamlText(
        path.join(directory, "values.yaml"),
        valuesConfigSchema,
        "core_values: [unclosed",
      ),
    ).rejects.toThrow(ConfigurationError);
  });

  it("rejects raw YAML that parses but breaks the schema", async () => {
    const directory = await scratch();

    await expect(
      writeYamlText(
        path.join(directory, "values.yaml"),
        valuesConfigSchema,
        "core_values: 3\n",
      ),
    ).rejects.toThrow(ConfigurationError);
  });

  it("leaves the previous file intact when a write is rejected", async () => {
    const directory = await scratch();
    const target = path.join(directory, "values.yaml");
    await writeYamlConfig(target, valuesConfigSchema, values);

    await expect(
      writeYamlText(target, valuesConfigSchema, "core_values: 3\n"),
    ).rejects.toThrow(ConfigurationError);

    expect(await readFile(target, "utf8")).toContain("Craft");
  });

  it("serializes a mentor profile as front matter plus body", () => {
    const text = serializeMentorProfile(
      "profile.md",
      mentorProfileSchema,
      {
        id: "coach",
        name: "Coach",
        fictional: true,
        description: "A synthetic profile.",
        domains: ["career"],
        disclaimer: "Fictional.",
        body: "Prose about the mentor.",
      },
    );

    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("id: coach");
    expect(text.trimEnd().endsWith("Prose about the mentor.")).toBe(true);
    // The body must not leak into the front matter mapping.
    expect(text.split("---")[1]).not.toContain("Prose about the mentor.");
  });

  it("serializes concurrent writes to the same file", async () => {
    const directory = await scratch();
    const target = path.join(directory, "values.yaml");

    await Promise.all(
      Array.from({ length: 8 }, (_unused, index) =>
        writeYamlConfig(target, valuesConfigSchema, {
          ...values,
          core_values: [`Craft ${index.toString()}`],
        }),
      ),
    );

    // Interleaved writes would leave a truncated or half-renamed file.
    const text = await readFile(target, "utf8");
    expect(valuesConfigSchema.safeParse(YAML.parse(text)).success).toBe(true);
  });

  it("leaves no temporary files behind", async () => {
    const directory = await scratch();
    await writeFileAtomic(path.join(directory, "values.yaml"), "core_values: []\n");

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(directory);
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });
});
