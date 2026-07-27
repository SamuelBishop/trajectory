import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import type {
  ChatMessage,
  ProviderName,
  SidecarChatResponse,
} from "../shared/types";

const MAX_OUTPUT_BYTES = 1_000_000;
const SIDECAR_TIMEOUT_MS = 120_000;

function isSidecarResponse(value: unknown): value is SidecarChatResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SidecarChatResponse>;
  return (
    typeof candidate.answer === "string" &&
    Array.isArray(candidate.goal_ids) &&
    Array.isArray(candidate.principle_ids) &&
    Array.isArray(candidate.source_ids) &&
    typeof candidate.confidence === "number" &&
    Array.isArray(candidate.uncertainties)
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export async function resolveSidecar(): Promise<{
  command: string;
  cwd: string;
}> {
  const appPath = app.getAppPath();
  const repositoryRoot = path.resolve(appPath, "..");
  const custom = process.env.TRAJECTORY_SIDECAR_PATH;
  if (custom) {
    if (!(await exists(custom))) {
      throw new Error("TRAJECTORY_SIDECAR_PATH does not exist.");
    }
    return { command: custom, cwd: repositoryRoot };
  }

  const candidates =
    process.platform === "win32"
      ? [path.join(repositoryRoot, ".venv", "Scripts", "trajectory.exe")]
      : [path.join(repositoryRoot, ".venv", "bin", "trajectory")];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return { command: candidate, cwd: repositoryRoot };
    }
  }
  return { command: "trajectory", cwd: repositoryRoot };
}

export async function runTrajectoryChat(
  provider: ProviderName,
  message: string,
  history: ChatMessage[],
): Promise<SidecarChatResponse> {
  const { command, cwd } = await resolveSidecar();
  const payload = {
    message,
    history: history.slice(-20).map((item) => ({
      role: item.role,
      content: item.content,
    })),
  };

  return await new Promise<SidecarChatResponse>((resolve, reject) => {
    const child = spawn(
      command,
      ["chat", "--provider", provider, "--json", "--input-json"],
      {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => {
      child.kill();
      fail(new Error("Trajectory sidecar timed out."));
    }, SIDECAR_TIMEOUT_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        fail(new Error("Trajectory sidecar returned too much output."));
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      fail(
        new Error(
          `Could not start the Trajectory sidecar: ${error.message}. ` +
            "Install the Python package or set TRAJECTORY_SIDECAR_PATH.",
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      clearTimeout(timer);
      if (code !== 0) {
        fail(
          new Error(
            stderr.trim() ||
              `Trajectory sidecar exited with status ${String(code)}.`,
          ),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (error) {
        fail(
          new Error(
            `Trajectory sidecar returned invalid JSON: ${
              error instanceof Error ? error.message : "unknown parse error"
            }`,
          ),
        );
        return;
      }
      if (!isSidecarResponse(parsed)) {
        fail(new Error("Trajectory sidecar returned an invalid chat response."));
        return;
      }
      settled = true;
      resolve(parsed);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
