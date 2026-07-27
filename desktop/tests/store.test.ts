import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EncryptedChatStore,
  type EncryptionAdapter,
} from "../src/main/store";

const temporaryDirectories: string[] = [];

const testEncryption: EncryptionAdapter = {
  isAvailable: () => true,
  encrypt: (value) => Buffer.from(value.split("").reverse().join(""), "utf8"),
  decrypt: (value) =>
    value.toString("utf8").split("").reverse().join(""),
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("EncryptedChatStore", () => {
  it("persists encrypted conversations without plaintext content", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-store-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "chats.json");
    const store = new EncryptedChatStore(filePath, testEncryption);
    const conversation = await store.create();

    await store.append(
      conversation.id,
      "user",
      "This is private conversation content.",
    );

    const serialized = await readFile(filePath, "utf8");
    expect(serialized).not.toContain("This is private conversation content.");
    const reloaded = new EncryptedChatStore(filePath, testEncryption);
    expect((await reloaded.get(conversation.id)).messages[0]?.content).toBe(
      "This is private conversation content.",
    );
  });

  it("refuses to persist when OS encryption is unavailable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-store-"));
    temporaryDirectories.push(directory);
    const store = new EncryptedChatStore(path.join(directory, "chats.json"), {
      ...testEncryption,
      isAvailable: () => false,
    });

    await expect(store.create()).rejects.toThrow(
      "Secure local storage is unavailable",
    );
  });

  it("serializes concurrent mutations without losing conversations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "trajectory-store-"));
    temporaryDirectories.push(directory);
    const store = new EncryptedChatStore(
      path.join(directory, "chats.json"),
      testEncryption,
    );

    await Promise.all(Array.from({ length: 10 }, () => store.create()));

    expect(await store.list()).toHaveLength(10);
  });
});
