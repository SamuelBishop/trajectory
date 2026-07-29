/**
 * Encrypted storage for a credential the user typed into the app.
 *
 * Implements: [HC-SECRETS-ENV-ONLY], [HC-NO-PLAINTEXT-HISTORY]
 *
 * The bar permits an in-app credential only under three conditions, and all
 * three live here:
 *
 *   1. Encrypted at rest with the OS backend. If encryption is unavailable the
 *      write is refused — there is no plaintext fallback, exactly as with chat
 *      history.
 *   2. Write-only from the renderer's point of view. `read` exists for the main
 *      process, which needs the value to construct a provider, and is never
 *      wired to an IPC channel. `has` returns a boolean so the UI can say
 *      "a key is stored" without ever receiving one.
 *   3. Never logged and never placed in an error message.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeFileAtomic } from "../engine/writer";
import type { EncryptionAdapter } from "./store";

interface SecretEnvelope {
  version: 1;
  ciphertext: string;
}

export const SECRETS_FILE = "trajectory-secrets.enc.json";

/**
 * `githubToken` authenticates the model; `githubActivityToken` reads commits.
 *
 * Separate slots because they are separate grants. Storing one token for both
 * meant reading commit history required handing repository access to the
 * credential that talks to the model — and worse, setting it switched the
 * provider off a working device login onto a token that had no Copilot access,
 * so turning on an integration broke chat.
 */
export type SecretName =
  | "openaiApiKey"
  | "githubToken"
  | "githubActivityToken";

export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly encryption: EncryptionAdapter,
  ) {}

  static defaultPath(userDataPath: string): string {
    return path.join(userDataPath, SECRETS_FILE);
  }

  private async readAll(): Promise<Partial<Record<SecretName, string>>> {
    let serialized: string;
    try {
      serialized = await readFile(this.filePath, "utf8");
    } catch {
      return {};
    }
    if (!this.encryption.isAvailable()) {
      return {};
    }
    try {
      const envelope = JSON.parse(serialized) as Partial<SecretEnvelope>;
      if (typeof envelope.ciphertext !== "string") {
        return {};
      }
      const plaintext = this.encryption.decrypt(
        Buffer.from(envelope.ciphertext, "base64"),
      );
      const parsed: unknown = JSON.parse(plaintext);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Partial<Record<SecretName, string>>;
    } catch {
      // A key encrypted under a different OS account or a rotated backend is
      // unreadable. Report "no key" rather than surfacing a decryption error
      // that would name the file holding a credential.
      return {};
    }
  }

  private async writeAll(
    secrets: Partial<Record<SecretName, string>>,
  ): Promise<void> {
    if (!this.encryption.isAvailable()) {
      throw new Error(
        "Secure local storage is unavailable, so the credential was not saved. " +
          "Provide it through the environment instead.",
      );
    }
    const ciphertext = this.encryption
      .encrypt(JSON.stringify(secrets))
      .toString("base64");
    const envelope: SecretEnvelope = { version: 1, ciphertext };
    await writeFileAtomic(this.filePath, JSON.stringify(envelope));
  }

  /** Main-process only. Never expose this through IPC. */
  async read(name: SecretName): Promise<string | undefined> {
    const value = (await this.readAll())[name];
    return value === undefined || value.length === 0 ? undefined : value;
  }

  async has(name: SecretName): Promise<boolean> {
    return (await this.read(name)) !== undefined;
  }

  async set(name: SecretName, value: string): Promise<void> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error("The credential was empty.");
    }
    await this.writeAll({ ...(await this.readAll()), [name]: trimmed });
  }

  async clear(name: SecretName): Promise<void> {
    const secrets = await this.readAll();
    if (!(name in secrets)) {
      return;
    }
    delete secrets[name];
    await this.writeAll(secrets);
  }
}
