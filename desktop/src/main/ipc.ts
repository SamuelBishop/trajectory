import { mkdir } from "node:fs/promises";
import path from "node:path";

import { app, ipcMain, safeStorage } from "electron";

import { providerNameSchema } from "../engine/domain";
import { chatWithMentor, type EngineDirectories } from "../engine/mentorship";
import { ensureLocalConfig, resolveBundledData } from "../engine/paths";
import { createProvider } from "../engine/providers/factory";
import type { ProviderName, SendMessageInput } from "../shared/types";
import { EncryptedChatStore } from "./store";

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

export function registerIpcHandlers(): void {
  const store = new EncryptedChatStore(
    path.join(app.getPath("userData"), "trajectory-chats.enc.json"),
    {
      isAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        !(
          process.platform === "linux" &&
          safeStorage.getSelectedStorageBackend() === "basic_text"
        ),
      encrypt: (value) => safeStorage.encryptString(value),
      decrypt: (value) => safeStorage.decryptString(value),
    },
  );

  let seeded: Promise<EngineDirectories> | undefined;
  const localConfig = async (): Promise<EngineDirectories> => {
    seeded ??= ensureLocalConfig(
      resolveBundledData({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
      }),
      app.getPath("userData"),
    );
    return await seeded;
  };

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
    await store.append(conversationId, "user", content);

    const { response } = await chatWithMentor(
      content,
      conversation.messages.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      createProvider(provider, {
        runtimeDirectory: await ensureRuntimeDirectory(),
      }),
      await localConfig(),
    );

    return await store.append(conversationId, "assistant", response.answer, {
      goalIds: response.goal_ids,
      principleIds: response.principle_ids,
      sourceIds: response.source_ids,
      confidence: response.confidence,
      uncertainties: response.uncertainties,
    });
  });
}
