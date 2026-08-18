/**
 * Shared model-provider contract.
 *
 * Implements: [HC-PROVIDER-PARITY]
 */

import type {
  Briefing,
  BriefingRequest,
  ChatRequest,
  ChatResponse,
  DecisionRequest,
  Recommendation,
  StarterPromptsRequest,
  StarterPromptsResponse,
} from "../domain";

export interface MentorProvider {
  readonly name: string;
  generate(request: DecisionRequest): Promise<Recommendation>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  briefing(request: BriefingRequest): Promise<Briefing>;
  starterPrompts(request: StarterPromptsRequest): Promise<StarterPromptsResponse>;
}
