import { afterEach, describe, expect, it, vi } from "vitest";

import { createProvider } from "../../src/engine/providers/factory";
import { DEFAULT_COPILOT_MODEL } from "../../src/engine/providers/copilot";

const context = { runtimeDirectory: "/tmp/trajectory-runtime" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createProvider", () => {
  it("prefers the in-app model over the environment", () => {
    vi.stubEnv("COPILOT_MODEL", "from-env");
    const provider = createProvider("copilot", {
      ...context,
      model: "from-settings",
    });
    expect(provider).toHaveProperty("model", "from-settings");
  });

  it("falls back to the environment when no model is set in app", () => {
    vi.stubEnv("COPILOT_MODEL", "from-env");
    const provider = createProvider("copilot", context);
    expect(provider).toHaveProperty("model", "from-env");
  });

  it("treats a blank model as no choice at all", () => {
    vi.stubEnv("COPILOT_MODEL", "");
    const provider = createProvider("copilot", { ...context, model: "   " });
    expect(provider).toHaveProperty("model", DEFAULT_COPILOT_MODEL);
  });

  it("prefers the stored API key over the environment", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    const provider = createProvider("openai", {
      ...context,
      openaiApiKey: "stored-key",
    });
    expect(provider).toHaveProperty("apiKey", "stored-key");
  });

  it("uses the environment key when nothing is stored", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    const provider = createProvider("openai", context);
    expect(provider).toHaveProperty("apiKey", "env-key");
  });

  it("still refuses to construct OpenAI without any key", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    expect(() => createProvider("openai", context)).toThrow(/OPENAI_API_KEY/);
  });

  it("never falls back to another provider", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    expect(() => createProvider("openai", context)).toThrow();
  });
});
