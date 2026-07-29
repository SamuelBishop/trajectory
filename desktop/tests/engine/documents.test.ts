import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isMentorDocumentName,
  isUserDocumentName,
  readMentorDocument,
  readUserDocument,
  writeMentorDocument,
  writeMentorDocumentText,
  writeUserDocument,
  writeUserDocumentText,
} from "../../src/engine/documents";
import { ensureLocalConfig } from "../../src/engine/paths";

const BUNDLED = {
  userDirectory: path.resolve(__dirname, "../../../examples/demo/user"),
  mentorsDirectory: path.resolve(__dirname, "../../../resources/mentors"),
};

async function seeded(): Promise<{
  configDirectory: string;
  userDirectory: string;
}> {
  const userData = await mkdtemp(path.join(os.tmpdir(), "trajectory-docs-"));
  const local = await ensureLocalConfig(BUNDLED, userData);
  return {
    configDirectory: local.configDirectory,
    userDirectory: local.userDirectory,
  };
}

describe("document names", () => {
  it("accepts the five user files and rejects anything else", () => {
    for (const name of [
      "goals",
      "values",
      "current_state",
      "constraints",
      "communication",
    ]) {
      expect(isUserDocumentName(name)).toBe(true);
    }
    for (const name of [
      "../goals",
      "goals.yaml",
      "settings",
      "",
      "toString",
      "constructor",
    ]) {
      expect(isUserDocumentName(name)).toBe(false);
    }
  });

  it("accepts the four mentor files and rejects anything else", () => {
    for (const name of ["profile", "principles", "sources", "voice"]) {
      expect(isMentorDocumentName(name)).toBe(true);
    }
    for (const name of ["profile.md", "../profile", "toString", ""]) {
      expect(isMentorDocumentName(name)).toBe(false);
    }
  });
});

describe("readUserDocument", () => {
  it("returns both the parsed model and the raw text", async () => {
    const { userDirectory } = await seeded();
    const document = await readUserDocument(userDirectory, "goals");

    expect(document.file).toBe("goals.yaml");
    expect(document.text).toContain("goals:");
    expect(document.problem).toBeUndefined();
    expect(document.data).toHaveProperty("goals");
  });

  it("reports a problem instead of throwing when the file is invalid", async () => {
    const { userDirectory } = await seeded();
    await writeFile(path.join(userDirectory, "goals.yaml"), "goals: nope\n");

    const document = await readUserDocument(userDirectory, "goals");
    expect(document.problem).toBeTruthy();
    expect(document.data).toBeUndefined();
    // The broken text still comes back, or the user cannot repair it.
    expect(document.text).toBe("goals: nope\n");
  });
});

describe("writeUserDocument", () => {
  it("round-trips an edited model", async () => {
    const { userDirectory } = await seeded();
    const before = await readUserDocument(userDirectory, "goals");
    const model = before.data as { goals: { description: string }[] };
    const first = model.goals[0];
    expect(first).toBeDefined();
    first!.description = "Ship the settings editor";

    const after = await writeUserDocument(userDirectory, "goals", model);
    expect(after.problem).toBeUndefined();
    expect(after.text).toContain("Ship the settings editor");

    const reread = await readUserDocument(userDirectory, "goals");
    expect(
      (reread.data as { goals: { description: string }[] }).goals[0]
        ?.description,
    ).toBe("Ship the settings editor");
  });

  it("refuses an invalid model and leaves the file untouched", async () => {
    const { userDirectory } = await seeded();
    const original = await readFile(
      path.join(userDirectory, "goals.yaml"),
      "utf8",
    );

    await expect(
      writeUserDocument(userDirectory, "goals", { goals: "not a list" }),
    ).rejects.toThrow();

    expect(await readFile(path.join(userDirectory, "goals.yaml"), "utf8")).toBe(
      original,
    );
  });
});

describe("writeUserDocumentText", () => {
  it("preserves comments the user wrote", async () => {
    const { userDirectory } = await seeded();
    const before = await readUserDocument(userDirectory, "values");
    const text = `# hand written note\n${before.text}`;

    const after = await writeUserDocumentText(userDirectory, "values", text);
    expect(after.text).toContain("# hand written note");
    expect(after.problem).toBeUndefined();
  });

  it("refuses YAML that does not satisfy the schema", async () => {
    const { userDirectory } = await seeded();
    const original = await readFile(
      path.join(userDirectory, "values.yaml"),
      "utf8",
    );

    await expect(
      writeUserDocumentText(userDirectory, "values", "core_values: 3\n"),
    ).rejects.toThrow();

    expect(await readFile(path.join(userDirectory, "values.yaml"), "utf8")).toBe(
      original,
    );
  });

  it("refuses text that is not YAML at all", async () => {
    const { userDirectory } = await seeded();
    await expect(
      writeUserDocumentText(userDirectory, "values", "just: [unclosed\n"),
    ).rejects.toThrow();
  });
});

describe("mentor documents", () => {
  it("reads the profile as front matter plus body", async () => {
    const { configDirectory } = await seeded();
    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "profile",
    );

    expect(document.file).toBe("profile.md");
    expect(document.data).toHaveProperty("id", "demo_mentor");
    expect(document.data).toHaveProperty("body");
    expect(document.text.startsWith("---\n")).toBe(true);
  });

  it("writes a profile back so it still loads", async () => {
    const { configDirectory } = await seeded();
    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "profile",
    );
    const model = document.data as Record<string, unknown>;

    const after = await writeMentorDocument(
      configDirectory,
      "demo_mentor",
      "profile",
      { ...model, description: "A patient guide" },
    );

    expect(after.problem).toBeUndefined();
    expect(after.data).toHaveProperty("description", "A patient guide");
    expect(after.text.startsWith("---\n")).toBe(true);
  });

  it("keeps the prose body verbatim when saving raw text", async () => {
    const { configDirectory } = await seeded();
    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "profile",
    );
    const text = `${document.text}\n<!-- a note -->\n`;

    const after = await writeMentorDocumentText(
      configDirectory,
      "demo_mentor",
      "profile",
      text,
    );
    expect(after.text).toContain("<!-- a note -->");
  });

  it("refuses a profile without front matter", async () => {
    const { configDirectory } = await seeded();
    await expect(
      writeMentorDocumentText(
        configDirectory,
        "demo_mentor",
        "profile",
        "# no front matter\n",
      ),
    ).rejects.toThrow();
  });

  it("refuses a traversing mentor id", async () => {
    const { configDirectory } = await seeded();
    await expect(
      readMentorDocument(configDirectory, "../../../etc", "profile"),
    ).rejects.toThrow();
  });

  it("reports an optional missing voice without treating it as malformed", async () => {
    const { configDirectory } = await seeded();
    await rm(
      path.join(configDirectory, "mentors", "demo_mentor", "voice.yaml"),
    );

    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "voice",
    );

    expect(document.missing).toBe(true);
    expect(document.problem).toBeUndefined();
    expect(document.text).toBe("");
  });

  it("round-trips voice YAML through the validated document writer", async () => {
    const { configDirectory } = await seeded();
    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "voice",
    );
    const text = document.text.replace(
      "Keep the synthetic demo concise",
      "Keep the synthetic demo direct",
    );

    const after = await writeMentorDocumentText(
      configDirectory,
      "demo_mentor",
      "voice",
      text,
    );

    expect(after.problem).toBeUndefined();
    expect(after.text).toContain("Keep the synthetic demo direct");
  });

  it("refuses invalid voice references and leaves the file untouched", async () => {
    const { configDirectory } = await seeded();
    const filePath = path.join(
      configDirectory,
      "mentors",
      "demo_mentor",
      "voice.yaml",
    );
    const original = await readFile(filePath, "utf8");
    const document = await readMentorDocument(
      configDirectory,
      "demo_mentor",
      "voice",
    );
    const model = structuredClone(document.data) as {
      examples: { items: { pattern_ids: string[] }[] };
    };
    const example = model.examples.items[0];
    expect(example).toBeDefined();
    if (!example) {
      throw new Error("The demo voice example is missing.");
    }
    example.pattern_ids = ["missing_pattern"];

    await expect(
      writeMentorDocument(configDirectory, "demo_mentor", "voice", model),
    ).rejects.toThrow(/unknown patterns: missing_pattern/);
    expect(await readFile(filePath, "utf8")).toBe(original);
  });
});
