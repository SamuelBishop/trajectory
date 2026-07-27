import path from "node:path";
import { writeFile } from "node:fs/promises";

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
});
