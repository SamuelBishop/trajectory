/**
 * Interactive GitHub sign-in, driven through the bundled Copilot runtime.
 *
 * Implements: [HC-SECRETS-ENV-ONLY], [HC-NEVER-PRINT-SECRETS]
 *
 * The SDK has no login call, but the runtime binary it ships with does:
 * `copilot login` runs an OAuth device flow and stores the credential in the
 * system credential store. This module spawns it, reads the user code and URL off
 * stdout, and reports completion — so the token itself is only ever handled by
 * the runtime, and never passes through this process or the renderer.
 *
 * COPILOT_HOME is pinned to the application's runtime directory so login and
 * provider requests select the same account. The token remains in the OS store.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import { resolveBundledRuntimeBinary } from "../engine/providers/copilot";

/** Device codes are short-lived; abandon a flow the user never completes. */
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

/** How long to wait for the runtime to print the code before giving up. */
const PROMPT_TIMEOUT_MS = 60 * 1000;

const PROMPT_PATTERN = /visit\s+(\S+?)\s+and enter code\s+([A-Za-z0-9-]+)/i;

/**
 * Read the device-flow prompt out of the runtime's ordinary console output.
 *
 * This is screen-scraping a human-facing message, so it is the first thing
 * that will break when the runtime rewords it. Tested against the exact line
 * the shipped runtime prints.
 */
export function parseLoginPrompt(output: string): LoginPrompt | undefined {
  const match = PROMPT_PATTERN.exec(output);
  if (!match) return undefined;
  return { verificationUri: match[1]!, userCode: match[2]! };
}

export interface LoginPrompt {
  readonly verificationUri: string;
  readonly userCode: string;
}

export interface LoginResult {
  readonly ok: boolean;
  readonly problem?: string;
}

/**
 * The runtime prints progress, and on failure the reason, as ordinary text.
 * Keep the tail so a failed sign-in can say something better than "exit 1",
 * but cap it: this is a diagnostic, not a transcript.
 */
function lastMeaningfulLine(output: string): string | undefined {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^waiting for authorization/i.test(line));
  return lines.at(-1)?.slice(0, 300);
}

export class CopilotLogin {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined;
  private finished: Promise<LoginResult> | undefined;

  constructor(
    private readonly runtimeDirectory: string,
    /** Injected in tests so the flow can be driven without the real runtime. */
    private readonly binaryResolver: () => string | undefined = resolveBundledRuntimeBinary,
  ) {}

  get inProgress(): boolean {
    return this.child !== undefined;
  }

  /**
   * Start a device flow and resolve once the runtime has printed the code.
   * The process keeps running afterwards, polling GitHub until the user
   * approves, is cancelled, or the code expires.
   */
  async start(): Promise<LoginPrompt> {
    if (this.child) {
      throw new Error("A sign-in is already in progress.");
    }
    const binary = this.binaryResolver();
    if (!binary) {
      throw new Error(
        "The Copilot runtime is missing from this installation, so sign-in is unavailable.",
      );
    }

    const child = spawn(binary, ["login"], {
      cwd: this.runtimeDirectory,
      env: {
        ...process.env,
        COPILOT_HOME: this.runtimeDirectory,
        // An inherited token would short-circuit the flow and leave the user
        // staring at a prompt that never arrives.
        COPILOT_GITHUB_TOKEN: "",
        GH_TOKEN: "",
        GITHUB_TOKEN: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    let output = "";
    let settled = false;
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    this.finished = new Promise<LoginResult>((resolve) => {
      const expiry = setTimeout(() => {
        child.kill();
      }, LOGIN_TIMEOUT_MS);
      child.once("close", (code) => {
        clearTimeout(expiry);
        this.child = undefined;
        resolve(
          code === 0
            ? { ok: true }
            : {
                ok: false,
                problem:
                  lastMeaningfulLine(output) ??
                  "Sign-in did not complete. Try again.",
              },
        );
      });
      child.once("error", (error) => {
        clearTimeout(expiry);
        this.child = undefined;
        resolve({ ok: false, problem: error.message });
      });
    });

    return await new Promise<LoginPrompt>((resolve, reject) => {
      const give = (error: Error): void => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(error);
      };
      const timer = setTimeout(() => {
        give(new Error("The Copilot runtime did not return a sign-in code."));
      }, PROMPT_TIMEOUT_MS);

      const look = (): void => {
        const found = parseLoginPrompt(output);
        if (!found || settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.off("data", look);
        resolve(found);
      };
      child.stdout.on("data", look);
      child.once("close", () => {
        clearTimeout(timer);
        give(
          new Error(
            lastMeaningfulLine(output) ?? "Sign-in ended before it started.",
          ),
        );
      });
      look();
    });
  }

  /** Resolve when the flow finishes. Safe to call when nothing is running. */
  async wait(): Promise<LoginResult> {
    return (
      (await this.finished) ?? { ok: false, problem: "No sign-in is running." }
    );
  }

  cancel(): void {
    this.child?.kill();
    this.child = undefined;
  }
}
