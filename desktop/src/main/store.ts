import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  Grounding,
  MessageRole,
} from "../shared/types";

interface StoreEnvelope {
  version: 1;
  ciphertext: string;
}

interface StoreData {
  conversations: Conversation[];
}

export interface EncryptionAdapter {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Conversation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.messages)
  );
}

export class EncryptedChatStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionAdapter,
  ) {}

  private requireEncryption(): void {
    if (!this.encryption.isAvailable()) {
      throw new Error(
        "Secure local storage is unavailable. Chat history was not written.",
      );
    }
  }

  private async read(): Promise<StoreData> {
    this.requireEncryption();
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return { conversations: [] };
      }
      throw error;
    }

    const envelope = JSON.parse(serialized) as Partial<StoreEnvelope>;
    if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") {
      throw new Error("Encrypted chat store has an unsupported format.");
    }
    const plaintext = this.encryption.decrypt(
      Buffer.from(envelope.ciphertext, "base64"),
    );
    const data = JSON.parse(plaintext) as Partial<StoreData>;
    if (
      !Array.isArray(data.conversations) ||
      !data.conversations.every(isConversation)
    ) {
      throw new Error("Encrypted chat store is invalid.");
    }
    return { conversations: data.conversations };
  }

  private async write(data: StoreData): Promise<void> {
    this.requireEncryption();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const ciphertext = this.encryption
      .encrypt(JSON.stringify(data))
      .toString("base64");
    const envelope: StoreEnvelope = { version: 1, ciphertext };
    const temporaryPath = `${this.filePath}.${process.pid.toString()}.${randomUUID()}.tmp`;
    const handle = await open(temporaryPath, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(envelope), "utf8");
      await handle.sync();
      await handle.close();
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async list(): Promise<ConversationSummary[]> {
    await this.mutationQueue;
    const data = await this.read();
    return data.conversations
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(id: string): Promise<Conversation> {
    await this.mutationQueue;
    const data = await this.read();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) {
      throw new Error("Conversation not found.");
    }
    return conversation;
  }

  async create(): Promise<Conversation> {
    return await this.mutate(async () => {
      const data = await this.read();
      const now = new Date().toISOString();
      const conversation: Conversation = {
        id: randomUUID(),
        title: "New conversation",
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      data.conversations.push(conversation);
      await this.write(data);
      return conversation;
    });
  }

  async delete(id: string): Promise<void> {
    await this.mutate(async () => {
      const data = await this.read();
      const remaining = data.conversations.filter((item) => item.id !== id);
      if (remaining.length === data.conversations.length) {
        throw new Error("Conversation not found.");
      }
      await this.write({ conversations: remaining });
    });
  }

  async append(
    conversationId: string,
    role: MessageRole,
    content: string,
    grounding?: Grounding,
  ): Promise<Conversation> {
    return await this.mutate(async () => {
      const data = await this.read();
      const conversation = data.conversations.find(
        (item) => item.id === conversationId,
      );
      if (!conversation) {
        throw new Error("Conversation not found.");
      }
      const now = new Date().toISOString();
      const message: ChatMessage = {
        id: randomUUID(),
        role,
        content,
        createdAt: now,
        ...(grounding ? { grounding } : {}),
      };
      conversation.messages.push(message);
      conversation.updatedAt = now;
      if (role === "user" && conversation.messages.length === 1) {
        conversation.title =
          content.length > 48 ? `${content.slice(0, 47)}...` : content;
      }
      await this.write(data);
      return conversation;
    });
  }
}
