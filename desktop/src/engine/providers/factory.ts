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
}

export function createProvider(
  name: ProviderName,
  context: ProviderContext,
): MentorProvider {
  switch (name) {
    case "copilot":
      return CopilotProvider.fromEnvironment(context.runtimeDirectory);
    case "openai":
      return OpenAICompatibleProvider.fromEnvironment();
    case "deterministic":
      return new DeterministicProvider();
  }
}
