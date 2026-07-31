import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { loadMentorResources, loadUserConfig } from "../../src/engine/config";
import { AttributionError, ConfigurationError } from "../../src/engine/errors";
import {
  copyFixture,
  editYaml,
  mentorDirectory,
  userDirectory,
} from "./fixtures";

describe("configuration loading", () => {
  it("loads all demo configuration", async () => {
    const user = await loadUserConfig(userDirectory);
    const resources = await loadMentorResources(mentorDirectory);

    expect(user.goals.map((goal) => goal.id)).toEqual([
      "career_001",
      "health_001",
    ]);
    expect(resources.profile.fictional).toBe(true);
    expect(resources.profile.body).not.toHaveLength(0);
    expect(resources.sources[0]?.synthetic).toBe(true);
    expect(resources.principles[0]?.source_ids).toEqual(["demo_source_001"]);
    expect(resources.voice?.version).toBe(2);
    expect(resources.voice?.voice.tone).toContain("direct");
    expect(
      resources.voice?.examples.items.map((example) => example.purpose),
    ).toEqual(["respectful_disagreement", "practical_ending"]);
  });

  it("rejects duplicate goal IDs", async () => {
    const copied = await copyFixture(userDirectory, "user");
    await editYaml(path.join(copied, "goals.yaml"), (raw) => {
      raw.goals.push(raw.goals[0]);
    });

    await expect(loadUserConfig(copied)).rejects.toThrow(
      /Duplicate goal IDs: career_001/,
    );
  });

  it("reports the file for malformed configuration", async () => {
    const copied = await copyFixture(userDirectory, "user");
    await writeFile(
      path.join(copied, "values.yaml"),
      "core_values: not-a-list\n",
      "utf8",
    );

    await expect(loadUserConfig(copied)).rejects.toThrow(/values\.yaml/);
  });

  it("reports a missing configuration file by path", async () => {
    await expect(loadUserConfig(path.join(userDirectory, "nope"))).rejects.toThrow(
      ConfigurationError,
    );
  });

  it("rejects an unknown principle source", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "principles.yaml"), (raw) => {
      raw.principles[0].source_ids = ["missing_source"];
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /unknown sources: missing_source/,
    );
  });

  it("rejects an unapproved source", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "sources.yaml"), (raw) => {
      raw.sources[0].approved = false;
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /has not been approved/,
    );
  });

  it("rejects a non-synthetic source on a fictional profile", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "sources.yaml"), (raw) => {
      raw.sources[0].synthetic = false;
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(AttributionError);
  });

  it("loads a mentor profile saved with Windows line endings", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    const profilePath = path.join(copied, "profile.md");
    const original = await readFile(profilePath, "utf8");
    // What a Windows editor writes, and what git checks out under
    // core.autocrlf=true. Byte-for-byte front matter matching rejected it.
    await writeFile(profilePath, original.replace(/\n/g, "\r\n"), "utf8");

    const resources = await loadMentorResources(copied);

    expect(resources.profile.fictional).toBe(true);
    expect(resources.profile.body).not.toContain("\r");
  });

  it("loads an existing mentor without an optional voice profile", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await rm(path.join(copied, "voice.yaml"));

    const resources = await loadMentorResources(copied);

    expect(resources.voice).toBeUndefined();
  });

  it("reports malformed voice configuration by file path", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await writeFile(path.join(copied, "voice.yaml"), "writing: [broken\n", "utf8");

    await expect(loadMentorResources(copied)).rejects.toThrow(/voice\.yaml/);
  });

  it("rejects a voice profile for another mentor", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.mentor_id = "another_mentor";
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /Voice profile belongs to another_mentor/,
    );
  });

  it("rejects an unknown pattern reference in a voice example", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.examples.items[0].pattern_ids = ["missing_pattern"];
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /Voice example .* unknown patterns: missing_pattern/,
    );
  });

  it("rejects duplicate voice pattern IDs", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.patterns.push(raw.patterns[0]);
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /Duplicate voice pattern IDs/,
    );
  });

  it("rejects an inverted selection range", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.selection.standard.pattern_count = "3-2";
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /selection range 3-2 must be ordered/,
    );
  });

  it("rejects selection counts larger than the profile", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.selection.deep.pattern_count = 4;
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /requests 4, but only 3 patterns exist/,
    );
  });

  it("caps configured example selection at two", async () => {
    const copied = await copyFixture(mentorDirectory, "mentor");
    await editYaml(path.join(copied, "voice.yaml"), (raw) => {
      raw.selection.deep.example_count = "1-3";
    });

    await expect(loadMentorResources(copied)).rejects.toThrow(
      /example_count may not exceed 2/,
    );
  });
});
