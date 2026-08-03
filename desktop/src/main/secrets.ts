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
 *
 * `notionToken` follows the same rule for the same reason: one slot per grant,
 * so revoking a workspace's access never costs the user their model access.
 *
 * Strava takes two slots because its authorization is two values, not one. The
 * client secret identifies the application and effectively never changes; the
 * refresh token identifies the athlete's grant and **rotates**. Storing them
 * together would mean rewriting the application's identity every time a token
 * refreshed, which is a good way to lose the half that was still correct.
 *
 * `googleServiceAccountKey` holds the service account's private key together
 * with the address it belongs to, taken out of the JSON file Google hands out.
 * Together and not split, because those two values are signed into one
 * assertion: keeping the address elsewhere would let an edit there produce a
 * JWT claiming to be an account the key cannot speak for. The copy of the
 * address in integrations config is for display only — it is what the user has
 * to share their sheet with, and a value nothing can read back is a setup step
 * nobody can complete.
 */
export type SecretName =
  | "openaiApiKey"
  | "githubToken"
  | "githubActivityToken"
  | "notionToken"
  | "stravaClientSecret"
  | "stravaRefreshToken"
  | "googleServiceAccountKey";

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
