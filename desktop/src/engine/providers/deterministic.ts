/**
 * Credential-free deterministic provider for demos and tests.
 *
 * Implements: [HC-NO-SILENT-FALLBACK], [HC-PROVIDER-PARITY]
 *
 * It refuses anything but the committed demo rather than improvising, so a
 * missing credential can never be mistaken for a working mentor.
 */

import type {
  ChatRequest,
  ChatResponse,
  DecisionRequest,
  Recommendation,
} from "../domain";
import { ProviderError } from "../errors";
import type { MentorProvider } from "./types";

const DEMO_PROJECT =
  "A low-risk pull request that has already received substantial polish.";
const DEMO_POSTPONED = "A design proposal postponed twice.";
const DEMO_DECISION =
  "Whether to keep polishing the pull request tonight.";

function isDemoQuestion(text: string): boolean {
  const question = text.toLowerCase();
  return (
    question.includes("polish") &&
    (question.includes("pull request") || /\bpr\b/.test(question))
  );
}

export class DeterministicProvider implements MentorProvider {
  readonly name = "deterministic";

  async generate(request: DecisionRequest): Promise<Recommendation> {
    const goal = request.goals[0];
    const principle = request.principles[0];
    const sourceId = principle?.source_ids[0];
    const isDemoGrounding =
      goal?.id === "career_001" &&
      principle?.id === "demo_opportunity_cost_001" &&
      sourceId === "demo_source_001" &&
      request.mentor_profile.id === "demo_mentor";
    const isDemoContext =
      request.current_state.current_projects.includes(DEMO_PROJECT) &&
      request.current_state.current_projects.includes(DEMO_POSTPONED) &&
      request.current_state.unresolved_decisions.includes(DEMO_DECISION);

    if (!isDemoQuestion(request.question) || !isDemoGrounding || !isDemoContext) {
      throw new ProviderError(
        "The deterministic provider supports only the committed pull-request " +
          "demo. Choose copilot or openai for other decisions.",
      );
    }

    const goalDescription = goal.description.replace(/\.+$/, "");
    return {
      assessment: "stop_after_correctness_checks",
      response: "Stop after resolving only correctness-relevant concerns.",
      why_now:
        `More polish appears lower value than progress on '${goalDescription}' ` +
        "and the postponed design work in your current state.",
      goal_ids: [goal.id],
      principle_ids: [principle.id],
      source_ids: [sourceId],
      observations: [
        `The user asked: "${request.question}"`,
        "The current-state file says the pull request is functionally complete.",
      ],
      inferences: [
        "Further polishing may be perfectionism rather than material risk reduction.",
      ],
      alternatives_considered: [
        "Continue polishing for two hours.",
        "Submit immediately without another check.",
        "Resolve only correctness-relevant concerns, then submit.",
      ],
      suggested_next_step:
        "Write a short correctness checklist, address only material risks, submit " +
        "the pull request, then outline the design proposal.",
      confidence: 0.72,
      uncertainties: [
        "The system cannot inspect unreported production or security risk.",
      ],
    };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const goal = request.goals[0];
    const principle = request.principles[0];
    const source = request.sources[0];
    if (
      !isDemoQuestion(request.message) ||
      goal?.id !== "career_001" ||
      principle?.id !== "demo_opportunity_cost_001" ||
      source === undefined
    ) {
      throw new ProviderError(
        "The deterministic provider supports only the committed pull-request " +
          "demo. Choose copilot or openai for other chat messages.",
      );
    }
    return {
      answer:
        "**Recommendation:** stop after a short correctness check.\n\n" +
        "The pull request is functionally complete, while the postponed design " +
        "proposal more directly supports your architectural-ownership goal.\n\n" +
        "1. Write a brief material-risk checklist.\n" +
        "2. Submit the pull request.\n" +
        "3. Use the remaining time to outline the proposal.",
      goal_ids: [goal.id],
      principle_ids: [principle.id],
      source_ids: [source.id],
      observations: [
        "The current state describes the pull request as functionally complete.",
        "The design proposal has been postponed twice.",
      ],
      inferences: [
        "Additional polish may have lower opportunity value than the design work.",
      ],
      confidence: 0.72,
      uncertainties: [
        "The system cannot inspect unreported production or security risk.",
      ],
    };
  }
}
