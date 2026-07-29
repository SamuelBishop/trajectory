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
      const requestId = crypto.randomUUID();
      const deltas = [];
      const unsubscribe = window.trajectory.onChatStream((delta) => {
        if (delta.requestId === requestId) deltas.push(delta.content);
      });
      try {
        const updated = await window.trajectory.sendMessage({
          requestId,
          conversationId: conversation.id,
          content: ${JSON.stringify(content)},
          provider: ${JSON.stringify(provider)},
        });
        unsubscribe();
        return JSON.stringify({
          ok: true,
          message: updated.messages[updated.messages.length - 1],
          deltas,
        });
      } catch (error) {
        unsubscribe();
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
      demo.message?.grounding?.sourceIds?.length > 0 &&
      demo.deltas.length > 1 &&
      demo.deltas.join("") === demo.message.content,
    demo.ok
      ? JSON.stringify({
          grounding: demo.message.grounding,
          deltas: demo.deltas.length,
        })
      : demo.error,
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
    user.length === 5 && mentor.length === 4,
    `user=[${user}] mentor=[${mentor}]`,
  );

  // ---- Editing surface ----

  // The IPC checks below would all pass on a build whose React tree crashed on
  // mount, because the bridge lives in preload. Drive the actual UI too.
  const ui = JSON.parse(
    await session.evaluate(`
      (async () => {
        const settle = () => new Promise((r) => setTimeout(r, 400));
        const click = async (label) => {
          const button = [...document.querySelectorAll(".rail-button")]
            .find((node) => node.getAttribute("aria-label") === label);
          if (!button) throw new Error("no rail button for " + label);
          button.click();
          await settle();
          return document.querySelector("h1")?.textContent ?? "";
        };
        try {
          await settle();
          const rail = [...document.querySelectorAll(".rail-button")]
            .map((node) => node.getAttribute("aria-label"));
          const profile = await click("Profile");
          const fields = document.querySelectorAll(".field").length;
          const mentors = await click("Mentors");
          const voiceButton = [...document.querySelectorAll(".segmented button")]
            .find((node) => node.textContent?.trim() === "Voice");
          if (!(voiceButton instanceof HTMLButtonElement)) {
            throw new Error("the Voice editor tab is missing");
          }
          voiceButton.click();
          await settle();
          const voiceEditor = document.querySelector(".yaml-editor");
          const voiceLoaded =
            voiceEditor instanceof HTMLTextAreaElement &&
            voiceEditor.value.includes("version: 2");
          document.querySelector(".new-chat")?.click();
          await settle();
          const mentorName = document.querySelector("#mentor-name");
          if (!(mentorName instanceof HTMLInputElement)) {
            throw new Error("the duplicate form did not open");
          }
          const valueSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          valueSetter?.call(mentorName, "UI Mentor");
          mentorName.dispatchEvent(new Event("input", { bubbles: true }));
          mentorName.form?.requestSubmit();
          await settle();
          await settle();
          const duplicate = document.querySelector("h1")?.textContent ?? "";
          const duplicateListed = [...document.querySelectorAll(".conversation-title")]
            .some((node) => node.textContent?.includes("UI Mentor"));
          await window.trajectory.deleteMentor("ui_mentor");
          const settings = await click("Settings");
          // The Activity pane loads its state asynchronously, so settle again
          // before reading it. Checking only the heading would pass even if the
          // pane never rendered a control.
          await settle();
          await settle();
          const activityPane = {
            heading: [...document.querySelectorAll(".section-title")]
              .some((node) => node.textContent === "Activity"),
            cards: document.querySelectorAll(".integration-card").length,
            toggles: document.querySelectorAll(".integration-card .toggle").length,
            text: document.querySelector(".integration-card")?.textContent ?? "",
          };
          const chat = await click("Chat");
          const disclosure =
            document.querySelector(".mentor-disclaimer")?.textContent ?? "";
          return JSON.stringify({
            ok: true, rail, profile, fields, mentors, duplicate,
            duplicateListed, settings, voiceLoaded, disclosure, activityPane,
            chat: chat.length > 0,
            composer: Boolean(document.querySelector(".composer textarea")),
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  check(
    "every view renders and the rail switches between them",
    ui.ok === true &&
      ui.rail.join() === "Chat,Profile,Mentors,Settings" &&
      ui.profile === "Goals" &&
      ui.fields > 0 &&
      ui.mentors.length > 0 &&
      ui.duplicate === "UI Mentor" &&
      ui.duplicateListed === true &&
      ui.voiceLoaded === true &&
      ui.disclosure.includes("fictional") &&
      ui.settings === "Settings" &&
      ui.chat === true &&
      ui.composer === true,
    JSON.stringify(ui),
  );
  check(
    "the Activity pane renders its controls and says where it connects",
    ui.ok === true &&
      ui.activityPane.heading === true &&
      ui.activityPane.cards > 0 &&
      ui.activityPane.toggles >= 3 &&
      ui.activityPane.text.includes("Makes no network connection"),
    JSON.stringify(ui.activityPane),
  );

  const editing = JSON.parse(
    await session.evaluate(`
      (async () => {
        try {
          const before = await window.trajectory.readUserConfig("goals");
          const model = before.data;
          model.goals[0].description = "Smoke-edited goal";
          const after = await window.trajectory.writeUserConfig("goals", model);
          const reread = await window.trajectory.readUserConfig("goals");
          const voiceBefore = await window.trajectory.readMentorConfig(
            "demo_mentor", "voice",
          );
          const voiceModel = voiceBefore.data;
          voiceModel.chat[0] =
            "Keep the synthetic demo concise in packaged smoke.";
          const voiceAfter = await window.trajectory.writeMentorConfig(
            "demo_mentor", "voice", voiceModel,
          );
          const voiceReread = await window.trajectory.readMentorConfig(
            "demo_mentor", "voice",
          );
          let refused = null;
          try {
            await window.trajectory.writeUserConfig("goals", { goals: "nope" });
          } catch (error) { refused = String(error.message ?? error); }
          let traversal = null;
          try {
            await window.trajectory.readMentorConfig("../../etc", "profile");
          } catch (error) { traversal = String(error.message ?? error); }
          return JSON.stringify({
            ok: true,
            savedText: after.text.includes("Smoke-edited goal"),
            persisted: reread.data.goals[0].description === "Smoke-edited goal",
            voiceSaved: voiceAfter.text.includes("packaged smoke"),
            voicePersisted:
              voiceReread.data.chat[0].includes("packaged smoke"),
            refused,
            traversal,
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  check(
    "a profile edit is written and reads back",
    editing.ok === true && editing.savedText && editing.persisted,
    JSON.stringify(editing),
  );
  check(
    "a voice edit crosses the packaged bridge and reads back",
    editing.ok === true && editing.voiceSaved && editing.voicePersisted,
    JSON.stringify(editing),
  );
  check(
    "an invalid profile edit is refused [HC-VALIDATE-IPC-INPUT]",
    typeof editing.refused === "string" && editing.refused.length > 0,
    String(editing.refused),
  );
  check(
    "a traversing mentor ID is refused [HC-VALIDATE-IPC-INPUT]",
    typeof editing.traversal === "string" && editing.traversal.length > 0,
    String(editing.traversal),
  );

  const mentorFlow = JSON.parse(
    await session.evaluate(`
      (async () => {
        try {
          const listed = await window.trajectory.listMentors();
          const copied = await window.trajectory.duplicateMentor(
            "demo_mentor", "smoke_mentor", "Smoke Mentor",
          );
          await window.trajectory.saveSettings({
            provider: "deterministic", model: "", activeMentorId: "smoke_mentor",
          });
          const settings = await window.trajectory.getSettings();
          const removed = await window.trajectory.deleteMentor("smoke_mentor");
          return JSON.stringify({
            ok: true,
            listed: listed.map((m) => m.id),
            copiedLoads: copied.find((m) => m.id === "smoke_mentor")?.loadable,
            activeMentorId: settings.activeMentorId,
            afterDelete: removed.map((m) => m.id),
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  check(
    "a mentor can be duplicated, activated, and deleted",
    mentorFlow.ok === true &&
      mentorFlow.copiedLoads === true &&
      mentorFlow.activeMentorId === "smoke_mentor" &&
      !mentorFlow.afterDelete.includes("smoke_mentor"),
    JSON.stringify(mentorFlow),
  );

  const secretFlow = JSON.parse(
    await session.evaluate(`
      (async () => {
        try {
          const before = await window.trajectory.getSecretStatus();
          const stored = await window.trajectory.setOpenAiKey("sk-smoke-not-a-real-credential");
          const cleared = await window.trajectory.clearOpenAiKey();
          // The Copilot token is the credential that makes the default
          // provider work from Finder, so it gets the same treatment.
          const ghStored = await window.trajectory.setGithubToken("ghp-smoke-not-a-real-credential");
          const ghCleared = await window.trajectory.clearGithubToken();
          return JSON.stringify({
            ok: true,
            before: before.hasOpenAiKey,
            stored: stored.hasOpenAiKey,
            cleared: cleared.hasOpenAiKey,
            ghBefore: before.hasGithubToken,
            ghStored: ghStored.hasGithubToken,
            ghCleared: ghCleared.hasGithubToken,
            surface: Object.keys(window.trajectory),
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  check(
    "a credential can be stored and removed but never read back [HC-SECRETS-ENV-ONLY]",
    secretFlow.ok === true &&
      secretFlow.before === false &&
      secretFlow.stored === true &&
      secretFlow.cleared === false &&
      secretFlow.ghBefore === false &&
      secretFlow.ghStored === true &&
      secretFlow.ghCleared === false &&
      !secretFlow.surface.some((name) => /^(get|read|fetch).*(Key|Secret|Token)$/.test(name)),
    JSON.stringify(secretFlow),
  );

  // Activity is the most sensitive thing this app stores, so the smoke drives
  // the whole lane through the real bridge: default off, collect only after the
  // user enables it, encrypted on disk, and genuinely erased on request.
  const activityFlow = JSON.parse(
    await session.evaluate(`
      (async () => {
        try {
          const initial = await window.trajectory.listIntegrations();
          const target = initial.integrations[0];
          const beforeEnable = await window.trajectory.refreshIntegration(target.id);
          const enabled = await window.trajectory.saveIntegrationPolicy(target.id, {
            ...target.policy,
            enabled: true,
          });
          const synced = await window.trajectory.refreshIntegration(target.id);
          return JSON.stringify({
            ok: true,
            id: target.id,
            hosts: target.hosts,
            defaultEnabled: target.policy.enabled,
            defaultPaused: initial.paused,
            countBeforeEnable: beforeEnable.integrations[0].signalCount,
            enabledSaved: enabled.integrations[0].policy.enabled,
            countAfterSync: synced.integrations[0].signalCount,
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  check(
    "activity is collected only after the user turns it on [HC-NO-EXFILTRATION]",
    activityFlow.ok === true &&
      activityFlow.defaultEnabled === false &&
      activityFlow.countBeforeEnable === 0 &&
      activityFlow.enabledSaved === true &&
      activityFlow.countAfterSync > 0 &&
      activityFlow.hosts.length === 0,
    JSON.stringify(activityFlow),
  );

  // Read while the records are still there. Checking after the delete would
  // pass against an empty file and prove nothing.
  const activityAtRest = await readFile(
    path.join(userDataDir, "trajectory-activity.enc.json"),
    "utf8",
  ).catch(() => "");
  check(
    "activity is encrypted at rest [HC-NO-PLAINTEXT-HISTORY]",
    activityAtRest.length > 0 && !activityAtRest.includes("Interval session"),
    `${activityAtRest.length} bytes`,
  );

  const activityDeleted = JSON.parse(
    await session.evaluate(`
      (async () => {
        try {
          const before = await window.trajectory.listIntegrations();
          const after = await window.trajectory.deleteIntegrationData(before.integrations[0].id);
          return JSON.stringify({
            ok: true,
            before: before.integrations[0].signalCount,
            after: after.integrations[0].signalCount,
            lastSyncedAt: after.integrations[0].lastSyncedAt,
          });
        } catch (error) {
          return JSON.stringify({ ok: false, error: String(error.message ?? error) });
        }
      })()
    `),
  );
  const activityAfterDelete = await readFile(
    path.join(userDataDir, "trajectory-activity.enc.json"),
    "utf8",
  ).catch(() => "");
  check(
    "deleting activity erases it from disk, not just from the view",
    activityDeleted.ok === true &&
      activityDeleted.before > 0 &&
      activityDeleted.after === 0 &&
      activityDeleted.lastSyncedAt === null &&
      activityAfterDelete.length < activityAtRest.length,
    `${JSON.stringify(activityDeleted)} ${activityAtRest.length}->${activityAfterDelete.length} bytes`,
  );

  // The tokenless path is the one a first launch takes, and `mode: "empty"`
  // refuses to start without a persistence location — a failure that no unit
  // test with a permissive fake will catch. On a machine with no credential
  // the honest outcome is an authentication error; a configuration error
  // means the client never launched at all.
  const copilotStart = await session.evaluate(`
    (async () => {
      const c = await window.trajectory.createConversation();
      try {
        await window.trajectory.sendMessage({
          requestId: crypto.randomUUID(),
          conversationId: c.id,
          content: "Should I spend another two hours polishing this low-risk pull request?",
          provider: "copilot",
        });
        return "ANSWERED";
      } catch (error) { return String(error.message ?? error); }
    })()
  `);
  check(
    "the Copilot client starts without a credential [HC-PACKAGED-RUNTIME]",
    !/mode: 'empty'|neither 'baseDirectory' nor 'sessionFs'/.test(copilotStart),
    copilotStart.slice(0, 200),
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

  const secretsFile = await readFile(
    path.join(userDataDir, "trajectory-secrets.enc.json"),
    "utf8",
  ).catch(() => "");
  check(
    "the credential was never written in the clear [HC-SECRETS-ENV-ONLY]",
    secretsFile.length > 0 &&
      !secretsFile.includes("sk-smoke-not-a-real") &&
      !secretsFile.includes("ghp-smoke-not-a-real"),
    `${secretsFile.length} bytes`,
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
