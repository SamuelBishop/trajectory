/**
 * Encrypted local cache for personalized starter prompts.
 *
 * Implements: [HC-NO-PLAINTEXT-HISTORY]
 *
 * A single record: three questions, the provider/model that produced them, and
 * when. The cache is stale after seven days or when provider/model changes.
 * Encryption is mandatory — there is no plaintext path.
 */

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import {
  providerNameSchema,
  starterPromptItemSchema,
} from "../engine/domain";

export const STARTER_PROMPT_FILE = "trajectory-starter-prompts.enc.json";

/** Seven days in milliseconds. */
export const STARTER_PROMPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoreEnvelope {
  version: 1;
  ciphertext: string;
}

export const starterPromptRecordSchema = z
  .object({
    generatedAt: z.string().datetime(),
    provider: providerNameSchema,
    model: z.string(),
    prompts: z.array(starterPromptItemSchema).length(3),
  })
  .strict();

export type StarterPromptRecord = z.infer<typeof starterPromptRecordSchema>;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export class EncryptedStarterPromptStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly encryption: {
      isAvailable(): boolean;
      encrypt(value: string): Buffer;
      decrypt(value: Buffer): string;
    },
  ) {}

  static defaultPath(userDataPath: string): string {
    return path.join(userDataPath, STARTER_PROMPT_FILE);
  }

  private requireEncryption(): void {
    if (!this.encryption.isAvailable()) {
      throw new Error(
        "Secure local storage is unavailable. Starter prompts cannot be read or written.",
      );
    }
  }

  private async read(): Promise<StarterPromptRecord | null> {
    this.requireEncryption();
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }

    const envelope = JSON.parse(serialized) as Partial<StoreEnvelope>;
    if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") {
      throw new Error("Encrypted starter prompt store has an unsupported format.");
    }
    const plaintext = this.encryption.decrypt(
      Buffer.from(envelope.ciphertext, "base64"),
    );
    const result = starterPromptRecordSchema.safeParse(JSON.parse(plaintext));
    return result.success ? result.data : null;
  }

  private async write(record: StarterPromptRecord): Promise<void> {
    this.requireEncryption();
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const ciphertext = this.encryption
      .encrypt(JSON.stringify(record))
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

  async get(): Promise<StarterPromptRecord | null> {
    await this.mutationQueue;
    return await this.read();
  }

  async save(record: StarterPromptRecord): Promise<StarterPromptRecord> {
    const parsed = starterPromptRecordSchema.parse(record);
    return await this.mutate(async () => {
      await this.write(parsed);
      return parsed;
    });
  }

  /**
   * Whether the cached record is fresh for the given provider/model.
   *
   * A record is stale when:
   * - It does not exist.
   * - It is older than seven days.
   * - The provider or model has changed since it was generated.
   */
  isFresh(
    record: StarterPromptRecord | null,
    provider: string,
    model: string,
    now: Date = new Date(),
  ): boolean {
    if (!record) return false;
    if (record.provider !== provider || record.model !== model) return false;
    const age = now.getTime() - new Date(record.generatedAt).getTime();
    return age >= 0 && age < STARTER_PROMPT_TTL_MS;
  }
}
