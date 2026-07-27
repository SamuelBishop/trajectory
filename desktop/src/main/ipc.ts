import path from "node:path";

import { app, ipcMain, safeStorage } from "electron";

import type { ProviderName, SendMessageInput } from "../shared/types";
import { runTrajectoryChat } from "./sidecar";
import { EncryptedChatStore } from "./store";

const PROVIDERS = new Set<ProviderName>([
  "deterministic",
  "copilot",
  "openai",
]);

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
  if (typeof value !== "string" || !PROVIDERS.has(value as ProviderName)) {
    throw new Error("Invalid model provider.");
  }
  return value as ProviderName;
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
    const response = await runTrajectoryChat(
      provider,
      content,
      conversation.messages,
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
