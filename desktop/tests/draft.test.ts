import { describe, expect, it } from "vitest";

import { resolveDraft, savedKey } from "../src/renderer/src/draft";

/**
 * The settings forms edit a value the main process owns, handed over IPC. The
 * regression these guard against was silent: an unsaved toggle vanished when
 * anything refreshed the view, and the control snapped back as though the user
 * had never touched it.
 */
describe("keeping an unsaved edit through a view refresh", () => {
  const saved = { includeOpenTasks: false, lookbackDays: 1 };

  it("keeps the edit when a refresh returns an equal but new object", () => {
    // This is the whole bug. Every IPC reply is a fresh object, so an identity
    // comparison sees a change on every refresh and throws the edit away.
    const edited = { key: savedKey(saved), value: { ...saved, includeOpenTasks: true } };
    const refreshed = { includeOpenTasks: false, lookbackDays: 1 };

    expect(refreshed).not.toBe(saved);
    expect(resolveDraft(refreshed, edited).includeOpenTasks).toBe(true);
  });

  it("shows the saved value when it actually changed underneath", () => {
    // Once the stored value really differs, the form is displaying something
    // stale, and continuing to show the edit would hide the truth.
    const edited = { key: savedKey(saved), value: { ...saved, includeOpenTasks: true } };
    const changed = { includeOpenTasks: false, lookbackDays: 30 };

    expect(resolveDraft(changed, edited)).toEqual(changed);
  });

  it("shows the saved value when nothing has been edited", () => {
    expect(resolveDraft(saved, null)).toBe(saved);
  });

  it("does not care about key order in the saved value", () => {
    // Field order is an artifact of how the object was built, not a change the
    // user made, and treating it as one would drop the edit for no reason.
    const edited = { key: savedKey(saved), value: { ...saved, includeOpenTasks: true } };
    const reordered = { lookbackDays: 1, includeOpenTasks: false };

    expect(resolveDraft(reordered, edited).includeOpenTasks).toBe(true);
  });
});
