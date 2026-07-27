import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadMentorResources, loadUserConfig } from "../../src/engine/config";
import {
  ensureLocalConfig,
  resolveBundledData,
} from "../../src/engine/paths";
import { mentorDirectory, userDirectory } from "./fixtures";

const bundled = {
  userDirectory,
  mentorsDirectory: path.dirname(mentorDirectory),
};

describe("bundled data resolution", () => {
  it("reads from resources when packaged", () => {
    const resolved = resolveBundledData({
      isPackaged: true,
      resourcesPath: "/Applications/Trajectory.app/Contents/Resources",
      appPath: "/ignored",
    });

    expect(resolved.userDirectory).toBe(
      "/Applications/Trajectory.app/Contents/Resources/trajectory-data/user",
    );
    expect(resolved.mentorsDirectory).toBe(
      "/Applications/Trajectory.app/Contents/Resources/trajectory-data/mentors",
    );
  });

  it("reads from the repository in development", () => {
    const resolved = resolveBundledData({
      isPackaged: false,
      resourcesPath: "/ignored",
      appPath: "/repo/desktop",
    });

    expect(resolved.userDirectory).toBe("/repo/examples/demo/user");
    expect(resolved.mentorsDirectory).toBe("/repo/resources/mentors");
  });
});

describe("first-launch seeding", () => {
  it("seeds loadable configuration into the user-data directory", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "trajectory-seed-"));

    const local = await ensureLocalConfig(bundled, userData);

    expect(local.userDirectory).toBe(path.join(userData, "config", "user"));
    const user = await loadUserConfig(local.userDirectory);
    const resources = await loadMentorResources(local.mentorDirectory);
    expect(user.goals).not.toHaveLength(0);
    expect(resources.profile.id).toBe("demo_mentor");
  });

  it("never overwrites configuration the user has edited", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "trajectory-seed-"));
    const first = await ensureLocalConfig(bundled, userData);
    const goalsPath = path.join(first.userDirectory, "goals.yaml");
    const edited = `${await readFile(goalsPath, "utf8")}\n# edited by the user\n`;
    await writeFile(goalsPath, edited, "utf8");

    await ensureLocalConfig(bundled, userData);

    expect(await readFile(goalsPath, "utf8")).toBe(edited);
  });

  it("fails loudly when bundled configuration is missing", async () => {
    const userData = await mkdtemp(path.join(tmpdir(), "trajectory-seed-"));

    await expect(
      ensureLocalConfig(
        { userDirectory: "/nope/user", mentorsDirectory: "/nope/mentors" },
        userData,
      ),
    ).rejects.toThrow(/Bundled configuration is missing/);
  });
});
