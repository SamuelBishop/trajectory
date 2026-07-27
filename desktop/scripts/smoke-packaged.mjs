/**
 * Packaged-application smoke test.
 *
 * Implements: [HC-PRELOAD-CJS], [HC-RENDERER-LEAST-PRIVILEGE],
 * [HC-PACKAGED-RUNTIME], [HC-EXPLICIT-CONFIG-PATHS], [HC-NO-PLAINTEXT-HISTORY]
 *
 * `typecheck`, `test`, and `build` all pass on a build whose preload bridge is
 * missing, whose bundled SDKs cannot be spawned, or whose demo data never
 * shipped. Those defects only appear in a launched packaged app. This script
 * launches one, drives the real bridge over the DevTools protocol, and fails
 * loudly instead of reporting a partial run as green.
 *
 * Run `npm run package` first, then `npm run smoke`.
 *
 * The app is copied outside the repository before launch so a build that
 * secretly depends on the checkout cannot pass. It runs against a throwaway
 * user-data directory, so a real installation is never touched.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 9222;
const DEMO_QUESTION =
  "Should I spend another two hours polishing this low-risk pull request?";

const CANDIDATES = [
  "release/mac-arm64/Trajectory.app/Contents/MacOS/Trajectory",
  "release/mac/Trajectory.app/Contents/MacOS/Trajectory",
  "release/win-unpacked/Trajectory.exe",
  "release/linux-unpacked/trajectory",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function locateBuild() {
  for (const candidate of CANDIDATES) {
    const full = path.join(DESKTOP, candidate);
    if (existsSync(full)) return full;
  }
  console.error("No packaged build found. Run `npm run package` first.");
  process.exit(1);
}

/** Copy the whole app so nothing can resolve back into the repository. */
async function installOutsideRepo(binary) {
  const marker = `.app${path.sep}`;
  const root = binary.includes(marker)
    ? binary.slice(0, binary.indexOf(marker) + 4)
    : path.dirname(binary);
  const target = await mkdtemp(path.join(tmpdir(), "trajectory-smoke-"));
  const installed = path.join(target, path.basename(root));
  await cp(root, installed, { recursive: true, verbatimSymlinks: true });
  return { target, binary: path.join(installed, binary.slice(root.length + 1)) };
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await response.json()).find(
        (target) => target.type === "page" && target.webSocketDebuggerUrl,
      );
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // The app has not opened its debugging port yet.
    }
    await sleep(500);
  }
  throw new Error("the packaged app never exposed a renderer");
}

function openSession(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const evaluate = async (expression) => {
    const id = nextId++;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    const details = reply.result?.exceptionDetails;
    if (details) {
      throw new Error(
        `renderer threw: ${details.exception?.description ?? details.text}`,
      );
    }
    return reply.result.result.value;
  };

  return { ready, evaluate, close: () => socket.close() };
}

const failures = [];
function check(name, passed, detail) {
  console.log(
    `${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
  if (!passed) failures.push(name);
}

function askExpression(provider, content) {
  return `
    (async () => {
      const conversation = await window.trajectory.createConversation();
      try {
        const updated = await window.trajectory.sendMessage({
          conversationId: conversation.id,
          content: ${JSON.stringify(content)},
          provider: ${JSON.stringify(provider)},
        });
        return JSON.stringify({
          ok: true,
          message: updated.messages[updated.messages.length - 1],
        });
      } catch (error) {
        return JSON.stringify({ ok: false, error: String(error.message ?? error) });
      }
    })()
  `;
}

const source = locateBuild();
const { target, binary } = await installOutsideRepo(source);
const userDataDir = await mkdtemp(path.join(tmpdir(), "trajectory-smoke-data-"));

const child = spawn(
  binary,
  [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`],
  {
    stdio: ["ignore", "ignore", "pipe"],
    cwd: target,
    env: {
      ...process.env,
      // Force the OpenAI provider past its credential check and into a real
      // request, so an SDK that failed to ship is caught here. Port 9 is
      // discard: nothing listens, so no request can leave the machine.
      OPENAI_API_KEY: "smoke-test-key-not-a-credential",
      OPENAI_MODEL: "gpt-4o-mini",
      OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
    },
  },
);
child.stderr.on("data", (chunk) => {
  const text = String(chunk);
  if (!text.includes("DevTools listening")) process.stderr.write(text);
});

let session;
try {
  session = openSession(await connect());
  await session.ready;

  const bridge = JSON.parse(
    await session.evaluate(
      "JSON.stringify({ type: typeof window.trajectory, keys: Object.keys(window.trajectory ?? {}) })",
    ),
  );
  check(
    "the preload bridge is exposed [HC-PRELOAD-CJS]",
    bridge.type === "object" && bridge.keys.includes("sendMessage"),
    JSON.stringify(bridge),
  );

  const privilege = JSON.parse(
    await session.evaluate(
      "JSON.stringify({ require: typeof require, process: typeof process, module: typeof module })",
    ),
  );
  check(
    "the renderer has no Node access [HC-RENDERER-LEAST-PRIVILEGE]",
    Object.values(privilege).every((value) => value === "undefined"),
    JSON.stringify(privilege),
  );

  const demo = JSON.parse(
    await session.evaluate(askExpression("deterministic", DEMO_QUESTION)),
  );
  check(
    "the engine answers in-process, outside the repository",
    demo.ok === true &&
      demo.message?.role === "assistant" &&
      demo.message?.grounding?.sourceIds?.length > 0,
    demo.ok ? JSON.stringify(demo.message.grounding) : demo.error,
  );

  const ungrounded = JSON.parse(
    await session.evaluate(
      askExpression("deterministic", "What should I focus on this week?"),
    ),
  );
  check(
    "an ungrounded question is refused [HC-REFUSE-UNGROUNDED]",
    ungrounded.ok === false &&
      /supports only the committed/.test(ungrounded.error),
    ungrounded.ok ? "answered anyway" : ungrounded.error,
  );

  const openai = JSON.parse(
    await session.evaluate(askExpression("openai", DEMO_QUESTION)),
  );
  check(
    "the OpenAI SDK ships inside the build [HC-PACKAGED-RUNTIME]",
    openai.ok === false &&
      /OpenAI-compatible request failed/.test(openai.error) &&
      !/could not be loaded/.test(openai.error),
    openai.ok ? "unexpectedly answered" : openai.error,
  );

  const config = path.join(userDataDir, "config");
  const user = await readdir(path.join(config, "user")).catch(() => []);
  const mentor = await readdir(
    path.join(config, "mentors", "demo_mentor"),
  ).catch(() => []);
  check(
    "first launch seeds editable configuration [HC-EXPLICIT-CONFIG-PATHS]",
    user.length === 5 && mentor.length === 3,
    `user=[${user}] mentor=[${mentor}]`,
  );

  const history = await readFile(
    path.join(userDataDir, "trajectory-chats.enc.json"),
    "utf8",
  ).catch(() => "");
  check(
    "history is encrypted at rest [HC-NO-PLAINTEXT-HISTORY]",
    history.length > 0 && !history.includes("polishing this low-risk"),
    `${history.length} bytes`,
  );
} finally {
  session?.close();
  child.kill();
  await sleep(500);
  await rm(target, { recursive: true, force: true });
  await rm(userDataDir, { recursive: true, force: true });
}

console.log(
  failures.length === 0
    ? "\nPackaged smoke test passed."
    : `\nPackaged smoke test FAILED: ${failures.join("; ")}`,
);
console.log(
  "The Copilot provider needs a signed-in GitHub account and is not covered here.",
);
process.exit(failures.length === 0 ? 0 : 1);
