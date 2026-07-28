import { mkdir } from "node:fs/promises";
import path from "node:path";

import { app, ipcMain, safeStorage, shell } from "electron";

import {
  isMentorDocumentName,
  isUserDocumentName,
  readMentorDocument,
  readUserDocument,
  writeMentorDocument,
  writeMentorDocumentText,
  writeUserDocument,
  writeUserDocumentText,
  type MentorDocumentName,
  type UserDocumentName,
} from "../engine/documents";
import { providerNameSchema } from "../engine/domain";
import {
  assertValidMentorId,
  deleteMentor,
  duplicateMentor,
  listMentors,
} from "../engine/mentors";
import { chatWithMentor } from "../engine/mentorship";
import {
  ensureLocalConfig,
  resolveBundledData,
  type LocalConfig,
} from "../engine/paths";
import { CopilotProvider } from "../engine/providers/copilot";
import { createProvider } from "../engine/providers/factory";
import { loadSettings, saveSettings } from "../engine/settings";
import type { ProviderName, SendMessageInput } from "../shared/types";
import { CopilotLogin } from "./copilot-login";
import { SecretStore } from "./secrets";
import { EncryptedChatStore } from "./store";

/**
 * Flatten an error and everything that caused it into one line for the main
 * process log.
 *
 * A provider wraps the vendor failure in its own message so the renderer never
 * has to know SDK types, but that summary alone is not diagnosable — a bare
 * `(Error)` says only that something went wrong. The detail belongs in the log,
 * where the operator can read it, and stays out of the renderer.
 */
function describeCauseChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    parts.push(`${current.constructor.name}: ${current.message}`);
    if (current.stack && depth === parts.length - 1) {
      const frame = current.stack.split("\n")[1]?.trim();
      if (frame) parts[parts.length - 1] += ` (${frame})`;
    }
    current = current.cause;
  }
  if (parts.length === 0) parts.push(String(error));
  return parts.join("\n  caused by ");
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error("Invalid conversation ID.");
  }
  return value;
}

function requireMessage(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Message must be text.");
  }
  const message = value.trim();
  if (message.length === 0 || message.length > 12_000) {
    throw new Error("Message must contain between 1 and 12,000 characters.");
  }
  return message;
}

function requireProvider(value: unknown): ProviderName {
  const result = providerNameSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Invalid model provider.");
  }
  return result.data;
}

function requireUserDocument(value: unknown): UserDocumentName {
  if (!isUserDocumentName(value)) {
    throw new Error("Unknown profile file.");
  }
  return value;
}

function requireMentorDocument(value: unknown): MentorDocumentName {
  if (!isMentorDocumentName(value)) {
    throw new Error("Unknown mentor file.");
  }
  return value;
}

/**
 * A mentor ID crosses the boundary and becomes a directory name, so it is
 * checked here as well as in the engine. `assertValidMentorId` is the pattern
 * check; `mentorDirectoryFor` re-resolves and confirms containment.
 */
function requireMentorId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid mentor ID.");
  }
  return assertValidMentorId(value);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be text.`);
  }
  if (value.length > 400_000) {
    throw new Error(`${label} is too large to save.`);
  }
  return value;
}

function requireName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid mentor name.");
  }
  const name = value.trim();
  if (name.length === 0 || name.length > 120) {
    throw new Error("A mentor name must be 1 to 120 characters.");
  }
  return name;
}

export function registerIpcHandlers(): void {
  const encryption = {
    isAvailable: () =>
      safeStorage.isEncryptionAvailable() &&
      !(
        process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text"
      ),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value),
  };

  const userData = app.getPath("userData");
  const store = new EncryptedChatStore(
    path.join(userData, "trajectory-chats.enc.json"),
    encryption,
  );
  const secrets = new SecretStore(SecretStore.defaultPath(userData), encryption);

  /**
   * Seeding is keyed on the active mentor, so switching mentors in Settings
   * invalidates the cache rather than leaving chat pointed at the old profile
   * until the next restart.
   */
  let seeded: Promise<LocalConfig> | undefined;
  let seededFor: string | undefined;
  const localConfig = async (): Promise<LocalConfig> => {
    const { activeMentorId } = await loadSettings(userData);
    if (!seeded || seededFor !== activeMentorId) {
      seededFor = activeMentorId;
      seeded = ensureLocalConfig(
        resolveBundledData({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath(),
        }),
        userData,
        activeMentorId,
      );
    }
    return await seeded;
  };

  // Seed at startup rather than on the first message, so the editor has files
  // to open before the user has said anything. A failure here is not fatal —
  // the next call retries — but it must be visible, because a silent failure
  // shows up later as an empty editor with no explanation.
  void localConfig().catch((error: unknown) => {
    console.error(
      "Could not prepare local configuration:",
      error instanceof Error ? error.message : error,
    );
  });

  const secretStatus = async (): Promise<{
    hasOpenAiKey: boolean;
    hasGithubToken: boolean;
    encryptionAvailable: boolean;
  }> => ({
    hasOpenAiKey: await secrets.has("openaiApiKey"),
    hasGithubToken: await secrets.has("githubToken"),
    encryptionAvailable: encryption.isAvailable(),
  });

  // Where the Copilot runtime keeps its state and, crucially, what it treats as
  // its working directory. The main process picks it so the runtime never runs
  // in — and never scans — whatever directory the app happened to launch from.
  const runtimeDirectory = path.join(app.getPath("userData"), "runtime");
  let runtimeReady: Promise<unknown> | undefined;
  const ensureRuntimeDirectory = async (): Promise<string> => {
    runtimeReady ??= mkdir(runtimeDirectory, { recursive: true });
    await runtimeReady;
    return runtimeDirectory;
  };

  ipcMain.handle("chat:list", () => store.list());
  ipcMain.handle("chat:get", (_event, id: unknown) => store.get(requireId(id)));
  ipcMain.handle("chat:create", () => store.create());
  ipcMain.handle("chat:delete", (_event, id: unknown) =>
    store.delete(requireId(id)),
  );
  ipcMain.handle("chat:send", async (_event, raw: unknown) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Invalid message request.");
    }
    const input = raw as Partial<SendMessageInput>;
    const conversationId = requireId(input.conversationId);
    const content = requireMessage(input.content);
    const provider = requireProvider(input.provider);
    const conversation = await store.get(conversationId);
    const settings = await loadSettings(userData);
    const directories = await localConfig();
    await store.append(conversationId, "user", content);

    let response;
    try {
      ({ response } = await chatWithMentor(
        content,
        conversation.messages.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        createProvider(provider, {
          runtimeDirectory: await ensureRuntimeDirectory(),
          model: settings.model,
          openaiApiKey: await secrets.read("openaiApiKey"),
          githubToken: await secrets.read("githubToken"),
        }),
        directories,
      ));
    } catch (error) {
      console.error(`Chat failed via "${provider}":`, describeCauseChain(error));
      throw error;
    }

    return await store.append(conversationId, "assistant", response.answer, {
      goalIds: response.goal_ids,
      principleIds: response.principle_ids,
      sourceIds: response.source_ids,
      confidence: response.confidence,
      uncertainties: response.uncertainties,
    });
  });

  ipcMain.handle("config:readUser", async (_event, file: unknown) => {
    const { userDirectory } = await localConfig();
    return await readUserDocument(userDirectory, requireUserDocument(file));
  });
  ipcMain.handle(
    "config:writeUser",
    async (_event, file: unknown, data: unknown) => {
      const { userDirectory } = await localConfig();
      return await writeUserDocument(
        userDirectory,
        requireUserDocument(file),
        data,
      );
    },
  );
  ipcMain.handle(
    "config:writeUserText",
    async (_event, file: unknown, text: unknown) => {
      const { userDirectory } = await localConfig();
      return await writeUserDocumentText(
        userDirectory,
        requireUserDocument(file),
        requireText(text, "Configuration"),
      );
    },
  );

  ipcMain.handle("mentors:list", async () => {
    const { configDirectory } = await localConfig();
    return await listMentors(configDirectory);
  });
  ipcMain.handle(
    "mentors:read",
    async (_event, id: unknown, file: unknown) => {
      const { configDirectory } = await localConfig();
      return await readMentorDocument(
        configDirectory,
        requireMentorId(id),
        requireMentorDocument(file),
      );
    },
  );
  ipcMain.handle(
    "mentors:write",
    async (_event, id: unknown, file: unknown, data: unknown) => {
      const { configDirectory } = await localConfig();
      return await writeMentorDocument(
        configDirectory,
        requireMentorId(id),
        requireMentorDocument(file),
        data,
      );
    },
  );
  ipcMain.handle(
    "mentors:writeText",
    async (_event, id: unknown, file: unknown, text: unknown) => {
      const { configDirectory } = await localConfig();
      return await writeMentorDocumentText(
        configDirectory,
        requireMentorId(id),
        requireMentorDocument(file),
        requireText(text, "Mentor configuration"),
      );
    },
  );
  ipcMain.handle(
    "mentors:duplicate",
    async (_event, sourceId: unknown, targetId: unknown, name: unknown) => {
      const { configDirectory } = await localConfig();
      await duplicateMentor(
        configDirectory,
        requireMentorId(sourceId),
        requireMentorId(targetId),
        requireName(name),
      );
      return await listMentors(configDirectory);
    },
  );
  ipcMain.handle("mentors:delete", async (_event, id: unknown) => {
    const { configDirectory } = await localConfig();
    const mentorId = requireMentorId(id);
    await deleteMentor(configDirectory, mentorId);

    // Deleting the mentor chat is pointed at would leave the next message
    // loading a directory that no longer exists.
    const settings = await loadSettings(userData);
    if (settings.activeMentorId === mentorId) {
      const remaining = await listMentors(configDirectory);
      const next = remaining.find((mentor) => mentor.loadable) ?? remaining[0];
      if (next) {
        await saveSettings(userData, { ...settings, activeMentorId: next.id });
        seeded = undefined;
      }
    }
    return await listMentors(configDirectory);
  });

  ipcMain.handle("settings:get", () => loadSettings(userData));
  ipcMain.handle("settings:save", async (_event, raw: unknown) => {
    const saved = await saveSettings(userData, raw);
    // Force the next message to resolve directories against the new mentor.
    seeded = undefined;
    await localConfig();
    return saved;
  });

  ipcMain.handle("secrets:status", () => secretStatus());
  ipcMain.handle("secrets:setOpenAi", async (_event, value: unknown) => {
    if (typeof value !== "string") {
      throw new Error("The credential must be text.");
    }
    await secrets.set("openaiApiKey", value);
    return await secretStatus();
  });
  ipcMain.handle("secrets:clearOpenAi", async () => {
    await secrets.clear("openaiApiKey");
    return await secretStatus();
  });
  // One flow at a time, owned by the main process: the renderer may start,
  // watch, and cancel a sign-in, but the credential itself is handled only by
  // the runtime and never crosses this boundary ([HC-SECRETS-ENV-ONLY]).
  let login: CopilotLogin | undefined;
  ipcMain.handle("auth:start", async () => {
    login ??= new CopilotLogin(await ensureRuntimeDirectory());
    const prompt = await login.start();
    // Opening the browser here rather than in the renderer keeps
    // `shell.openExternal` away from a renderer-supplied URL.
    void shell.openExternal(prompt.verificationUri).catch(() => undefined);
    return prompt;
  });
  ipcMain.handle("auth:wait", async () => {
    if (!login) {
      return { ok: false, problem: "No sign-in is running." };
    }
    const result = await login.wait();
    if (result.ok) {
      // The runtime resolves credentials once at start, so a client built
      // before the sign-in would still be unauthenticated.
      seeded = undefined;
    }
    return result;
  });
  ipcMain.handle("auth:cancel", () => {
    login?.cancel();
    return { ok: false, problem: "Sign-in cancelled." };
  });
  ipcMain.handle("auth:status", async () => {
    const settings = await loadSettings(userData);
    const provider = createProvider("copilot", {
      runtimeDirectory: await ensureRuntimeDirectory(),
      model: settings.model,
      githubToken: await secrets.read("githubToken"),
    });
    if (!(provider instanceof CopilotProvider)) {
      return { isAuthenticated: false };
    }
    return await provider.authStatus();
  });

  ipcMain.handle("secrets:setGithubToken", async (_event, value: unknown) => {
    if (typeof value !== "string") {
      throw new Error("The credential must be text.");
    }
    await secrets.set("githubToken", value);
    return await secretStatus();
  });
  ipcMain.handle("secrets:clearGithubToken", async () => {
    await secrets.clear("githubToken");
    return await secretStatus();
  });
}
