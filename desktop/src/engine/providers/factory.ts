/**
 * Provider selection.
 *
 * Implements: [HC-NO-SILENT-FALLBACK]
 *
 * A named provider either constructs or throws. It never degrades to another
 * provider, because a silent downgrade would present unauthenticated output as
 * if it came from the model the user chose.
 */

import type { ProviderName } from "../domain";
import { CopilotProvider } from "./copilot";
import { DeterministicProvider } from "./deterministic";
import { OpenAICompatibleProvider } from "./openai";
import type { MentorProvider } from "./types";

export interface ProviderContext {
  /** Application-owned directory the Copilot runtime may use for its state. */
  readonly runtimeDirectory: string;
  /**
   * Model chosen in Settings. Empty or absent means "use the provider's own
   * default", which is not the same as an explicit choice and must not be
   * passed through as one.
   */
  readonly model?: string | undefined;
  /**
   * Credential entered in Settings and held in the encrypted secret store.
   * Never logged, never returned across IPC ([HC-SECRETS-ENV-ONLY]).
   */
  readonly openaiApiKey?: string | undefined;
}

/**
 * In-app settings win over the environment. A GUI app launched from Finder
 * inherits no shell environment, so the value the user typed into this window
 * is the only one they can see or change; silently preferring a stale exported
 * variable would make Settings look broken.
 */
export function createProvider(
  name: ProviderName,
  context: ProviderContext,
): MentorProvider {
  const model = context.model?.trim() ? context.model.trim() : undefined;

  switch (name) {
    case "copilot":
      return CopilotProvider.fromEnvironment(context.runtimeDirectory, {
        ...process.env,
        ...(model ? { COPILOT_MODEL: model } : {}),
      });
    case "openai": {
      const apiKey = context.openaiApiKey?.trim()
        ? context.openaiApiKey.trim()
        : undefined;
      return OpenAICompatibleProvider.fromEnvironment({
        ...process.env,
        ...(apiKey ? { OPENAI_API_KEY: apiKey } : {}),
        ...(model ? { OPENAI_MODEL: model } : {}),
      });
    }
    case "deterministic":
      return new DeterministicProvider();
  }
}
