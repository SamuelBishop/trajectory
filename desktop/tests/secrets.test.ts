import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SecretStore } from "../src/main/secrets";
import type { EncryptionAdapter } from "../src/main/store";

/** Reversible stand-in for safeStorage. Not encryption; enough to prove wiring. */
function fakeEncryption(available = true): EncryptionAdapter {
  return {
    isAvailable: () => available,
    encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
    decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
  };
}

async function storePath(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "trajectory-secrets-"),
  );
  return path.join(directory, "secrets.enc.json");
}

describe("SecretStore", () => {
  it("stores and returns a credential to the main process", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption());
    await store.set("openaiApiKey", "sk-example-value");

    expect(await store.read("openaiApiKey")).toBe("sk-example-value");
    expect(await store.has("openaiApiKey")).toBe(true);
  });

  it("keeps the model credential and the activity token apart", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption());
    await store.set("githubActivityToken", "ghp-reads-commits");

    // The provider treats a stored `githubToken` as a decision to stop using
    // the device login, so a shared slot meant turning on commit reading could
    // sign the user out of the model. Storing one must not imply the other.
    expect(await store.has("githubToken")).toBe(false);
    expect(await store.read("githubActivityToken")).toBe("ghp-reads-commits");

    await store.set("githubToken", "ghp-talks-to-the-model");
    await store.clear("githubToken");
    // Revoking one leaves the other, which is the point of separating them.
    expect(await store.read("githubActivityToken")).toBe("ghp-reads-commits");
  });

  it("never writes the credential in a readable form", async () => {
    const file = await storePath();
    const store = new SecretStore(file, fakeEncryption());
    await store.set("openaiApiKey", "sk-example-value");

    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("sk-example-value");
    expect(JSON.parse(raw)).toHaveProperty("version", 1);
  });

  it("refuses to store anything when encryption is unavailable", async () => {
    const file = await storePath();
    const store = new SecretStore(file, fakeEncryption(false));

    await expect(store.set("openaiApiKey", "sk-example-value")).rejects.toThrow(
      /unavailable/,
    );
    // No plaintext fallback: the file must not exist at all.
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });

  it("does not name the credential in the refusal message", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption(false));
    const error = await store.set("openaiApiKey", "sk-example-value").then(
      () => undefined,
      (thrown: unknown) => thrown as Error,
    );

    expect(error?.message).not.toContain("sk-example-value");
  });

  it("reports no credential when encryption stops being available", async () => {
    const file = await storePath();
    await new SecretStore(file, fakeEncryption()).set("openaiApiKey", "sk-x");

    const locked = new SecretStore(file, fakeEncryption(false));
    expect(await locked.has("openaiApiKey")).toBe(false);
  });

  it("reports no credential before anything is stored", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption());
    expect(await store.has("openaiApiKey")).toBe(false);
    expect(await store.read("openaiApiKey")).toBeUndefined();
  });

  it("clears a stored credential", async () => {
    const file = await storePath();
    const store = new SecretStore(file, fakeEncryption());
    await store.set("openaiApiKey", "sk-example-value");
    await store.clear("openaiApiKey");

    expect(await store.has("openaiApiKey")).toBe(false);
    expect(await readFile(file, "utf8")).not.toContain("sk-example-value");
  });

  it("rejects an empty credential rather than storing a blank", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption());
    await expect(store.set("openaiApiKey", "   ")).rejects.toThrow();
    expect(await store.has("openaiApiKey")).toBe(false);
  });

  it("trims surrounding whitespace from a pasted key", async () => {
    const store = new SecretStore(await storePath(), fakeEncryption());
    await store.set("openaiApiKey", "  sk-example-value\n");
    expect(await store.read("openaiApiKey")).toBe("sk-example-value");
  });

  it("survives a corrupt file instead of crashing the app", async () => {
    const file = await storePath();
    const store = new SecretStore(file, fakeEncryption());
    await store.set("openaiApiKey", "sk-example-value");
    await writeFile(file, "{ not json");

    expect(await store.has("openaiApiKey")).toBe(false);
  });
});

describe("the renderer bridge", () => {
  it("exposes no channel that returns a credential", async () => {
    const source = await readFile(
      path.resolve(__dirname, "../src/preload/index.ts"),
      "utf8",
    );
    const methods = [...source.matchAll(/^\s{2}(\w+):/gm)].map(
      (match) => match[1] ?? "",
    );

    expect(methods).toContain("setOpenAiKey");
    expect(methods).toContain("clearOpenAiKey");
    // A getter returning the credential itself is the one shape that would
    // leak it into the renderer, where a compromised dependency could read it.
    // `getSecretStatus` is allowed precisely because it returns booleans.
    expect(
      methods.filter((name) => /^(get|read|fetch).*(Key|Secret|Token)$/.test(name)),
    ).toEqual([]);
  });

  it("invokes no channel the main process does not handle", async () => {
    // The one wiring mistake TypeScript cannot catch. `DesktopApi` forces the
    // preload to have every method, but the channel name inside it is a bare
    // string on both sides — a typo compiles, ships, and fails at runtime as a
    // button that does nothing.
    const preload = await readFile(
      path.resolve(__dirname, "../src/preload/index.ts"),
      "utf8",
    );
    const main = await readFile(
      path.resolve(__dirname, "../src/main/ipc.ts"),
      "utf8",
    );
    const invoked = [
      ...preload.matchAll(/ipcRenderer\.invoke\(\s*"([^"]+)"/g),
    ].map((match) => match[1] ?? "");
    const handled = new Set(
      [...main.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      ),
    );

    expect(invoked.length).toBeGreaterThan(0);
    expect(invoked.filter((channel) => !handled.has(channel))).toEqual([]);
  });

  it("listens on no channel the main process never sends", async () => {
    // The same wiring mistake as above, in the other direction. `invoke`/
    // `handle` is covered; `send`/`on` is not, and there are now two push
    // channels — a stream and a notification click — so a typo here would be a
    // listener that never fires and a feature that looks broken for no visible
    // reason.
    const preload = await readFile(
      path.resolve(__dirname, "../src/preload/index.ts"),
      "utf8",
    );
    const main = await readFile(
      path.resolve(__dirname, "../src/main/ipc.ts"),
      "utf8",
    );
    const listened = [
      ...preload.matchAll(/const channel = "([^"]+)"/g),
    ].map((match) => match[1] ?? "");
    const sent = new Set(
      [...main.matchAll(/\.send\(\s*"([^"]+)"/g)].map((match) => match[1] ?? ""),
    );

    expect(listened.length).toBeGreaterThan(0);
    expect(listened.filter((channel) => !sent.has(channel))).toEqual([]);
  });
});
