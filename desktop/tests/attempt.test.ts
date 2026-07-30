import { describe, expect, it } from "vitest";

import { attempt } from "../src/renderer/src/errors";

/**
 * The bug this exists to prevent, observed rather than imagined: the Strava
 * credential fields were added to the renderer, the renderer hot-reloaded, and
 * the preload did not. Pressing Store called a bridge method that did not
 * exist, which threw synchronously, which escaped the promise chain before any
 * handler was attached. The button read "Saving…" until the app was restarted
 * and never said why.
 *
 * Every save button in the app is built on this, so the guarantee is worth
 * stating separately from the components that rely on it.
 */
describe("running a bridge call that may throw before it returns", () => {
  it("turns a synchronous throw into a rejection", () => {
    // Without `attempt`, this throw happens during the call expression itself
    // and never reaches a `.catch`.
    const missingBridgeMethod = (): Promise<string> => {
      throw new TypeError(
        "window.trajectory.setStravaClientSecret is not a function",
      );
    };

    return expect(attempt(missingBridgeMethod)).rejects.toThrow(
      "is not a function",
    );
  });

  it("runs the failure and cleanup handlers a bare call would skip", async () => {
    // The wedge was not the missing error message; it was the missing
    // `finally`, because that is what clears the busy flag. Both have to run.
    const ran: string[] = [];
    await attempt<string>(() => {
      throw new Error("no such method");
    })
      .catch((error: unknown) => {
        ran.push(`catch:${(error as Error).message}`);
        return "";
      })
      .finally(() => {
        ran.push("finally");
      });

    expect(ran).toEqual(["catch:no such method", "finally"]);
  });

  it("proves the bare call this replaces really does skip them", async () => {
    // Guards the reason `attempt` exists. If a future refactor concludes the
    // wrapper is redundant and inlines `action().then(...)`, this is the
    // demonstration that it is not.
    const ran: string[] = [];
    const action = (): Promise<string> => {
      throw new Error("no such method");
    };

    expect(() => {
      void action()
        .catch(() => ran.push("catch"))
        .finally(() => ran.push("finally"));
    }).toThrow("no such method");
    await Promise.resolve();
    expect(ran).toEqual([]);
  });

  it("passes a resolved value straight through", async () => {
    await expect(attempt(() => Promise.resolve({ stored: true }))).resolves.toEqual({
      stored: true,
    });
  });

  it("still rejects for an ordinary asynchronous failure", async () => {
    await expect(
      attempt(() => Promise.reject(new Error("main process said no"))),
    ).rejects.toThrow("main process said no");
  });
});
