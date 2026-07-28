/**
 * Interactive sign-in.
 *
 * The device flow is screen-scraped from the runtime's console output, so the
 * parsing is pinned to the exact line the shipped runtime prints, and the flow
 * itself is driven against a stand-in binary that reproduces its behaviour.
 */

import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CopilotLogin, parseLoginPrompt } from "../src/main/copilot-login";

/** Verbatim from `copilot login` as shipped. */
const REAL_OUTPUT =
  "To authenticate, visit https://github.com/login/device and enter code FA09-8A26\nWaiting for authorization...\n";

async function fakeRuntime(script: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "traj-login-"));
  const file = path.join(directory, "fake-copilot");
  await writeFile(file, `#!/usr/bin/env node\n${script}\n`, "utf8");
  await chmod(file, 0o755);
  return file;
}

describe("parseLoginPrompt", () => {
  it("reads the code and URL the runtime actually prints", () => {
    expect(parseLoginPrompt(REAL_OUTPUT)).toEqual({
      verificationUri: "https://github.com/login/device",
      userCode: "FA09-8A26",
    });
  });

  it("waits rather than guessing when the prompt has not arrived", () => {
    expect(parseLoginPrompt("")).toBeUndefined();
    expect(parseLoginPrompt("Waiting for authorization...")).toBeUndefined();
    // A partial line: stdout arrives in chunks and may split mid-message.
    expect(parseLoginPrompt("To authenticate, visit https://gi")).toBeUndefined();
  });
});

describe("CopilotLogin", () => {
  it("surfaces the prompt and then the outcome", async () => {
    const binary = await fakeRuntime(
      `process.stdout.write(${JSON.stringify(REAL_OUTPUT)});
       setTimeout(() => process.exit(0), 20);`,
    );
    const login = new CopilotLogin(tmpdir(), () => binary);

    expect(await login.start()).toEqual({
      verificationUri: "https://github.com/login/device",
      userCode: "FA09-8A26",
    });
    expect(await login.wait()).toEqual({ ok: true });
  });

  it("reports why a failed sign-in failed", async () => {
    const binary = await fakeRuntime(
      `process.stdout.write(${JSON.stringify(REAL_OUTPUT)});
       setTimeout(() => { process.stdout.write("Device code expired.\\n"); process.exit(1); }, 20);`,
    );
    const login = new CopilotLogin(tmpdir(), () => binary);
    await login.start();

    const result = await login.wait();
    expect(result.ok).toBe(false);
    // Not "exit 1": the runtime said something the user can act on, and the
    // waiting line is noise that would otherwise mask it.
    expect(result.problem).toBe("Device code expired.");
  });

  it("refuses when the runtime is missing instead of hanging", async () => {
    const login = new CopilotLogin(tmpdir(), () => undefined);
    await expect(login.start()).rejects.toThrow(/runtime is missing/);
  });

  it("fails when the runtime exits without ever printing a code", async () => {
    const binary = await fakeRuntime(
      `process.stdout.write("Could not reach github.com\\n"); process.exit(1);`,
    );
    const login = new CopilotLogin(tmpdir(), () => binary);
    await expect(login.start()).rejects.toThrow(/Could not reach github\.com/);
  });

  it("runs one flow at a time", async () => {
    const binary = await fakeRuntime(
      `process.stdout.write(${JSON.stringify(REAL_OUTPUT)});
       setTimeout(() => process.exit(0), 2000);`,
    );
    const login = new CopilotLogin(tmpdir(), () => binary);
    await login.start();
    try {
      await expect(login.start()).rejects.toThrow(/already in progress/);
    } finally {
      login.cancel();
    }
  });
});
