import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertValidMentorId,
  deleteMentor,
  duplicateMentor,
  listMentors,
  mentorDirectoryFor,
} from "../../src/engine/mentors";
import { loadMentorResources } from "../../src/engine/config";
import { ensureLocalConfig } from "../../src/engine/paths";

const BUNDLED = {
  userDirectory: path.resolve(__dirname, "../../../examples/demo/user"),
  mentorsDirectory: path.resolve(__dirname, "../../../resources/mentors"),
};

async function scratch(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "trajectory-mentors-"));
}

describe("assertValidMentorId", () => {
  it("accepts lowercase identifiers", () => {
    expect(assertValidMentorId("demo_mentor")).toBe("demo_mentor");
  });

  it.each([
    "../escape",
    "..",
    ".",
    "a/b",
    "a\\b",
    "Demo",
    "1mentor",
    "x",
    "",
    "demo mentor",
    "demo-mentor",
    "demo\u0000",
  ])("rejects %j", (id) => {
    expect(() => assertValidMentorId(id)).toThrow();
  });
});

describe("mentorDirectoryFor", () => {
  it("resolves inside the mentors directory", () => {
    expect(mentorDirectoryFor("/tmp/config/mentors", "demo_mentor")).toBe(
      path.join("/tmp/config/mentors", "demo_mentor"),
    );
  });

  it("refuses to escape the mentors directory", () => {
    expect(() => mentorDirectoryFor("/tmp/config/mentors", "../../etc")).toThrow();
    expect(() =>
      mentorDirectoryFor("/tmp/config/mentors", "/etc/passwd"),
    ).toThrow();
  });
});

describe("ensureLocalConfig", () => {
  it("seeds every bundled mentor, not only the active one", async () => {
    // The repository bundles a single mentor today, so seeding it proves
    // nothing about seeding *all* of them. Build a two-mentor bundle instead,
    // otherwise this test passes against the old single-mentor code.
    const bundleRoot = await scratch();
    const mentors = path.join(bundleRoot, "mentors");
    await cp(BUNDLED.mentorsDirectory, mentors, { recursive: true });
    await cp(
      path.join(mentors, "demo_mentor"),
      path.join(mentors, "second_mentor"),
      { recursive: true },
    );

    const userData = await scratch();
    const local = await ensureLocalConfig(
      { userDirectory: BUNDLED.userDirectory, mentorsDirectory: mentors },
      userData,
    );

    const seeded = (
      await readdir(local.mentorsDirectory, { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(seeded).toEqual(["demo_mentor", "second_mentor"]);
    expect(local.activeMentorId).toBe("demo_mentor");
  });

  it("falls back to the demo mentor when the active one is gone", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData, "deleted_mentor");
    expect(local.activeMentorId).toBe("demo_mentor");
  });

  it("never overwrites an edited file", async () => {
    const userData = await scratch();
    const first = await ensureLocalConfig(BUNDLED, userData);
    const goals = path.join(first.userDirectory, "goals.yaml");
    await writeFile(goals, "goals: []\n");

    await ensureLocalConfig(BUNDLED, userData);
    expect(await readFile(goals, "utf8")).toBe("goals: []\n");
  });

  it("rejects a traversing mentor id", async () => {
    const userData = await scratch();
    await expect(
      ensureLocalConfig(BUNDLED, userData, "../../../etc"),
    ).rejects.toThrow();
  });
});

describe("listMentors", () => {
  it("summarizes seeded mentors", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    const mentors = await listMentors(local.configDirectory);

    expect(mentors.length).toBeGreaterThan(0);
    const demo = mentors.find((mentor) => mentor.id === "demo_mentor");
    expect(demo?.loadable).toBe(true);
    expect(demo?.name.length).toBeGreaterThan(0);
  });

  it("reports a broken profile instead of hiding it", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    const broken = path.join(local.mentorsDirectory, "broken_mentor");
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, "profile.md"), "not a profile");

    const mentors = await listMentors(local.configDirectory);
    const entry = mentors.find((mentor) => mentor.id === "broken_mentor");
    expect(entry?.loadable).toBe(false);
    expect(entry?.problem).toBeTruthy();
  });

  it("returns nothing when configuration has not been seeded", async () => {
    expect(await listMentors(await scratch())).toEqual([]);
  });
});

describe("duplicateMentor", () => {
  it("rewrites the mentor id on every record so the copy loads", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);

    await duplicateMentor(
      local.configDirectory,
      "demo_mentor",
      "patient_mentor",
      "Patient Mentor",
    );

    const mentors = await listMentors(local.configDirectory);
    const copy = mentors.find((mentor) => mentor.id === "patient_mentor");
    expect(copy).toBeDefined();
    expect(copy?.loadable).toBe(true);
    expect(copy?.name).toBe("Patient Mentor");
    const copiedResources = await loadMentorResources(
      path.join(local.mentorsDirectory, "patient_mentor"),
    );
    expect(copiedResources.voice?.mentor_id).toBe("patient_mentor");
  });

  it("preserves the absence of an optional voice profile", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    await rm(path.join(local.mentorDirectory, "voice.yaml"));

    await duplicateMentor(
      local.configDirectory,
      "demo_mentor",
      "quiet_mentor",
      "Quiet Mentor",
    );

    const copiedResources = await loadMentorResources(
      path.join(local.mentorsDirectory, "quiet_mentor"),
    );
    expect(copiedResources.voice).toBeUndefined();
  });

  it("refuses to overwrite an existing mentor", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    await expect(
      duplicateMentor(
        local.configDirectory,
        "demo_mentor",
        "demo_mentor",
        "Copy",
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("refuses a traversing target id", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    await expect(
      duplicateMentor(
        local.configDirectory,
        "demo_mentor",
        "../../../evil",
        "Evil",
      ),
    ).rejects.toThrow();
  });
});

describe("deleteMentor", () => {
  it("removes a mentor once another exists", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    await duplicateMentor(
      local.configDirectory,
      "demo_mentor",
      "second_mentor",
      "Second",
    );

    await deleteMentor(local.configDirectory, "second_mentor");
    const ids = (await listMentors(local.configDirectory)).map(
      (mentor) => mentor.id,
    );
    expect(ids).not.toContain("second_mentor");
  });

  it("refuses to delete the last mentor", async () => {
    const userData = await scratch();
    const local = await ensureLocalConfig(BUNDLED, userData);
    const mentors = await listMentors(local.configDirectory);
    for (const mentor of mentors.slice(1)) {
      await deleteMentor(local.configDirectory, mentor.id);
    }

    const last = (await listMentors(local.configDirectory))[0];
    expect(last).toBeDefined();
    await expect(
      deleteMentor(local.configDirectory, last!.id),
    ).rejects.toThrow(/only mentor/);
  });
});
