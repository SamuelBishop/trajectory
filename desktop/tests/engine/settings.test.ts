import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  settingsPath,
} from "../../src/engine/settings";

async function scratch(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "trajectory-settings-"));
}

describe("display name", () => {
  it("defaults to empty, so the greeting has no name to invent", () => {
    expect(DEFAULT_SETTINGS.displayName).toBe("");
  });

  it("loads a settings file written before the field existed", async () => {
    const userData = await scratch();
    try {
      // Exactly what a previous version wrote: no `displayName` key at all.
      await writeFile(
        settingsPath(userData),
        JSON.stringify({
          provider: "openai",
          model: "gpt-4o-mini",
          activeMentorId: "demo_mentor",
          briefingEnabled: true,
          briefingMinute: 420,
          briefingHeadlineInNotification: false,
        }),
        "utf8",
      );

      const loaded = await loadSettings(userData);

      expect(loaded.displayName).toBe("");
      // The rest of the file survives: a missing new field must not send the
      // whole document to defaults.
      expect(loaded.provider).toBe("openai");
      expect(loaded.briefingMinute).toBe(420);
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it("round-trips a stored name and trims it", async () => {
    const userData = await scratch();
    try {
      const saved = await saveSettings(userData, {
        ...DEFAULT_SETTINGS,
        displayName: "  Sam  ",
      });
      expect(saved.displayName).toBe("Sam");
      expect((await loadSettings(userData)).displayName).toBe("Sam");
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });

  it("refuses a name long enough to be pasted prose", async () => {
    const userData = await scratch();
    try {
      await expect(
        saveSettings(userData, {
          ...DEFAULT_SETTINGS,
          displayName: "n".repeat(61),
        }),
      ).rejects.toThrow();
    } finally {
      await rm(userData, { recursive: true, force: true });
    }
  });
});
