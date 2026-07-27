# Build the Trajectory MVP

> **Historical.** This prompt built the original Python CLI MVP, which has since
> been implemented and then migrated to TypeScript. It is kept for the product
> reasoning it records — the hypothesis, the scope boundary, and the attribution
> requirements, all of which still hold. Its *technical* instructions describe a
> Python package that no longer exists. Do not follow them. The current
> architecture is in `AGENTS.md` and `docs/methodology/CONSTITUTION.md`.

Use the following prompt with a coding agent to implement Trajectory's first usable vertical slice.

---

You are a senior Python product engineer working in the existing Trajectory repository.

Build the smallest complete version of Trajectory that can test this product hypothesis:

> Can an AI combine a user's stated values, goals, current context, and a documented mentor principle to give candid decision guidance that the user genuinely respects?

Do not stop after proposing architecture. Inspect the repository, make the changes, run the relevant checks, and leave a working CLI vertical slice. Prefer a small functioning implementation over speculative architecture.

## Product intent

Trajectory is a local-first, open-source AI mentorship system for people serious about who they are becoming. It should help a user notice drift between stated priorities and actual choices.

The mentor should be:

- candid, calm, specific, and practical;
- willing to disagree or recommend rest;
- focused on behavior and tradeoffs rather than personal worth;
- explicit about uncertainty and missing context;
- grounded in user goals and cited principles;
- resistant to empty encouragement and manufactured urgency.

Trajectory is not a therapist, medical professional, task manager, surveillance system, productivity-score dashboard, impersonation of a living person, or authority that replaces user judgment.

## Strict MVP scope

Implement one end-to-end workflow:

```console
trajectory decide "Should I spend another two hours polishing this low-risk pull request?"
```

The command must:

1. Load local, human-editable user configuration.
2. Load one fictional demo mentor profile, its synthetic source records, and its principles.
3. Assemble only the context needed for the question.
4. Ask the selected model provider for a typed recommendation.
5. Validate the output and every cited ID.
6. Render a concise recommendation with:
   - assessment;
   - direct critique or validation;
   - why the choice matters;
   - a concrete next action;
   - confidence and meaningful uncertainty;
   - cited goal, principle, and source IDs;
   - observations clearly separated from model inferences.

Supporting `init` and `validate` commands are acceptable when they materially improve setup, but decision review is the only product workflow.

Do not implement:

- morning, midday, evening, weekly, or intervention workflows;
- task, screen-time, calendar, GitHub, Notion, Telegram, journal, or fitness ingestion;
- FastAPI or any web interface;
- SQLite, SQLAlchemy, Alembic, or generalized persistent memory;
- passive monitoring, scheduling, notifications, or autonomous actions;
- real-person mentor profiles;
- vector search, embeddings, multi-agent orchestration, or a plugin system;
- Docker or cloud deployment.

Record no new product ideas in the implementation. Deferred work already belongs in `docs/FUTURE_ITERATIONS.md`.

## Technical baseline

- Python 3.12+
- `src` package layout
- Typer for the CLI
- Pydantic v2 for domain and configuration models
- PyYAML for human-editable machine-readable files
- pytest for tests
- Ruff for formatting and linting
- mypy for type checking
- provider dependencies exposed as optional dependency groups where practical
- Apache-2.0 license already present

Avoid adding a framework, database, or abstraction that the vertical slice does not require.

## Suggested repository shape

Adjust names to existing repository conventions if needed, but keep the responsibilities explicit and compact:

```text
.
├── README.md
├── pyproject.toml
├── .env.example
├── .gitignore
├── examples/
│   └── demo/
│       ├── user/
│       │   ├── values.yaml
│       │   ├── goals.yaml
│       │   ├── current_state.yaml
│       │   ├── constraints.yaml
│       │   └── communication.yaml
│       └── questions.md
├── resources/
│   └── mentors/
│       └── demo_mentor/
│           ├── profile.md
│           ├── principles.yaml
│           └── sources.yaml
├── src/
│   └── trajectory/
│       ├── __init__.py
│       ├── cli.py
│       ├── config.py
│       ├── domain.py
│       ├── context.py
│       ├── mentorship.py
│       ├── rendering.py
│       ├── validation.py
│       └── providers/
│           ├── base.py
│           ├── deterministic.py
│           ├── copilot.py
│           └── openai_compatible.py
└── tests/
    ├── fixtures/
    ├── test_cli.py
    ├── test_config.py
    ├── test_context.py
    ├── test_providers.py
    └── test_validation.py
```

Keep private runtime configuration out of Git. Commit synthetic examples only. If `trajectory init` creates a writable local profile, put it under a clearly ignored path such as `.trajectory/`.

## Domain contracts

Use strict Pydantic models. Add fields only when they are required by the decision workflow.

### User context

Represent at least:

- values and non-negotiables;
- definitions of success and unacceptable tradeoffs;
- goals with stable IDs, descriptions, priorities, motivations, success criteria, status, and optional target dates;
- current projects, deadlines, responsibilities, energy, recent progress, and unresolved decisions;
- practical constraints and protected commitments;
- communication preferences covering directness, warmth, challenge level,
  tolerance for excuses, handling of uncertainty, verbosity, use of questions
  and evidence, when to encourage or critique, and prohibited communication
  patterns.

Validation must reject duplicate IDs, malformed configuration, and missing required fields with file-specific, actionable errors.

### Source record

Each source record must include:

```yaml
id: demo_source_001
title: "Synthetic demo source: Focus and Tradeoffs"
creator: "Trajectory project"
mentor_id: demo_mentor
source_type: synthetic_demo
url: null
publication_date: null
accessed_date: null
first_party: true
approved: true
copyright_status: synthetic
synthetic: true
notes: "Created only to exercise source linkage. It is not external evidence."
```

The schema may be made more general, but the demo status must be impossible to mistake for real-world evidence.

### Mentor principle

Each principle must include:

```yaml
id: demo_opportunity_cost_001
mentor_id: demo_mentor
name: "Judge effort by opportunity cost"
description: "Additional polish is justified only when its likely value exceeds the best available alternative."
domains:
  - career
  - decision_making
source_ids:
  - demo_source_001
support_type: synthetic_demo
confidence: 1.0
interpretation_notes: "Synthetic principle for exercising the MVP."
possible_limitations:
  - "Risk may be understated when technical context is incomplete."
possible_conflicts:
  - "Quality and safety may justify additional work."
review_status: demo_only
```

No profile may claim to represent what a real person thinks. Never fabricate quotations. Never call synthetic content scientific or empirical evidence.

### Decision request

Include:

- the user's question;
- selected user context;
- relevant goals;
- relevant principles and source records;
- provider and prompt version metadata.

Do not include environment variables, secrets, unrelated files, full repository contents, or hidden chain-of-thought instructions.

### Recommendation

The provider must return a strict object equivalent to:

```json
{
  "assessment": "stop_polishing",
  "response": "Submit after resolving only correctness-relevant concerns.",
  "why_now": "Additional polish appears lower value than the postponed design proposal.",
  "goal_ids": ["career_001"],
  "principle_ids": ["demo_opportunity_cost_001"],
  "source_ids": ["demo_source_001"],
  "observations": [
    "The user described the pull request as low risk."
  ],
  "inferences": [
    "Further polishing may be perfectionism rather than material risk reduction."
  ],
  "alternatives_considered": [
    "Continue polishing",
    "Submit now",
    "Resolve only correctness-relevant concerns, then submit"
  ],
  "suggested_next_step": "Write a short correctness checklist, address it, and submit.",
  "confidence": 0.72,
  "uncertainties": [
    "The system cannot inspect unreported production or security risk."
  ]
}
```

Requirements:

- `confidence` is between 0 and 1.
- At least one uncertainty is present when relevant context is unavailable.
- Every goal, principle, and source ID resolves to loaded data.
- Every cited principle is linked to every cited source through configuration.
- Observations are supported directly by the user's question or loaded context.
- Inferences are labeled as inferences, not facts.
- The recommendation preserves user agency and does not diagnose health conditions.
- Concise rationale is allowed; private chain of thought must not be requested, stored, or displayed.

## Context assembly

Implement deterministic, inspectable relevance selection without a vector database.

For the MVP:

- Load the small configuration set.
- Select active goals using status and simple keyword/domain overlap.
- Select principles using explicit domain/tag overlap and stable tie-breaking.
- Cap the number and size of selected records.
- Include enough context to make a useful decision, but not unrelated personal data.
- Expose selection metadata in JSON/debug output without exposing secrets.

If no relevant goal or principle can be selected, fail clearly or return an explicit insufficient-context result. Do not silently invent grounding.

## Model-provider interface

Define one small provider protocol that accepts a typed decision request and returns a validated recommendation. Keep provider-specific authentication and payload translation inside each adapter.

### Deterministic provider

Required and installed by default.

- Produces stable output for synthetic demo scenarios.
- Requires no network or credentials.
- Exercises the same recommendation validation as real providers.
- Powers tests and the documented zero-cost quick start.
- Must not silently replace a failed real provider.

### GitHub Copilot SDK provider

Required as an optional provider.

- Use the official, current GitHub Copilot SDK for Python.
- Verify package names and API usage against current official GitHub documentation rather than guessing.
- Support the SDK's documented local GitHub sign-in and authorized-token authentication flows.
- A Copilot Business or Enterprise entitlement is not a generic OpenAI-style API key. Make this explicit in setup documentation.
- Explain that organization policy may restrict SDK access, model choice, token permissions, data handling, request quotas, or billing.
- Do not promise that a work subscription will fund usage; instruct users to confirm allowed use with their organization administrator and current GitHub terms.
- Never ask a user to commit or paste a work credential into tracked files.
- Fail with an actionable message when the SDK, authentication, entitlement, model, or organization policy is unavailable.

### OpenAI-compatible provider

Required as an optional provider.

- Support the official OpenAI API and compatible endpoints through:
  - `OPENAI_API_KEY`;
  - `OPENAI_MODEL`;
  - optional `OPENAI_BASE_URL`.
- Use structured JSON output when the endpoint supports it and validate the response with the same Pydantic model regardless.
- Retry once only for an invalid structured response, with a corrective schema message.
- Surface provider and validation errors. Never fall back silently to another provider.
- Do not log credentials or full private prompts.

### Provider selection

Support an explicit option such as:

```console
trajectory decide "..." --provider deterministic
trajectory decide "..." --provider copilot
trajectory decide "..." --provider openai
```

Allow a non-secret default provider in local configuration. Environment variables may override model names and endpoint details, but no secret belongs in YAML or Markdown configuration.

## Prompt behavior

The system prompt used by real providers must instruct the model to:

- prioritize the user's values, constraints, and goals over mentor principles;
- evaluate opportunity cost rather than the proposed action in isolation;
- challenge avoidance and perfectionism only as labeled hypotheses;
- treat recovery, relationships, health, and leisure as legitimate priorities;
- distinguish user statements, observations, mentor principles, and model inference;
- cite only IDs present in the supplied context;
- avoid quotations and claims about real people;
- avoid unsupported scientific claims;
- avoid praise that is not specific and earned;
- avoid shame, insults, theatrical language, and diagnoses;
- say when context is insufficient;
- return only the requested structured object.

Keep prompt text versioned in source. Do not put the entire application in one enormous prompt.

## Privacy and failure behavior

- Read only files explicitly supplied through the configured user and resource directories.
- Never crawl the repository, home directory, shell history, messages, or employer systems for personal context.
- Never include environment-variable values in model context.
- Never log credentials or complete private prompts by default.
- Telemetry is absent, not merely disabled.
- Use explicit errors for malformed data, missing credentials, unavailable optional dependencies, provider failures, and attribution failures.
- Do not use broad exception catches, silent defaults, or success-shaped fallbacks.
- Document that external providers receive the selected context and that users must not supply employer-confidential or otherwise restricted information.
- Keep generated trace metadata limited to timestamp, prompt version, provider, model, selected record IDs, validation result, and latency. Do not persist request text or response content by default.

## CLI experience

The default terminal output should be concise and readable:

```text
Assessment: Stop after correctness-relevant checks.

Another two hours of polish appears lower value than the postponed design work.
That may be perfectionism, but it is an inference rather than a known fact.

Next: Write a short correctness checklist, address it, and submit.

Confidence: Moderate
Uncertainty: I cannot see unreported production or security risk.
Grounding: career_001 · demo_opportunity_cost_001 · demo_source_001
```

Also support `--json` so the exact validated object can be inspected and tested.

Never print chain of thought.

## Tests

Write focused tests for:

1. Parsing every example configuration file.
2. Rejecting malformed fields and duplicate IDs with actionable errors.
3. Rejecting a principle with missing, unknown, or unapproved source linkage.
4. Rejecting recommendation citations that do not resolve.
5. Rejecting confidence outside the allowed range.
6. Preserving the observation/inference distinction.
7. Deterministic goal and principle selection.
8. Deterministic CLI output and JSON output.
9. Clear failure when an optional provider dependency is absent.
10. Clear failure when credentials are absent.
11. OpenAI-compatible response validation using a fake client or transport; no live API call in tests.
12. Copilot adapter translation using a fake SDK boundary; no live entitlement required in tests.
13. Ensuring provider failures never silently fall back to deterministic output.
14. Ensuring logs and errors do not expose supplied fake secrets.
15. A complete demo decision asserting:
    - a career goal is cited;
    - opportunity cost is discussed;
    - possible perfectionism is labeled as inference;
    - confidence and uncertainty are present;
    - the next step is concrete;
    - all grounding IDs resolve.

Do not write brittle tests that assert entire prose responses from real models.

## Documentation

Update the README with:

- what Trajectory is and is not;
- current experimental status;
- local setup for Python 3.12+;
- deterministic quick start;
- Copilot SDK setup and organization-policy caveat;
- OpenAI-compatible setup;
- configuration-file descriptions;
- privacy boundary and external-provider warning;
- the example decision;
- test, lint, and type-check commands;
- a link to `docs/FUTURE_ITERATIONS.md`.

Create `.env.example` with variable names and safe comments only. Never include a real key.

## Acceptance criteria

The MVP is complete only when all of the following are true:

- A fresh clone can install the default package and run the deterministic demo without credentials.
- `trajectory decide ... --provider deterministic` returns a useful validated decision review.
- `--json` returns the documented typed structure.
- The recommendation cites a real loaded goal, principle, and source record.
- Synthetic demo grounding is clearly labeled and cannot be confused with external evidence.
- The Copilot SDK adapter is functional when its optional dependency and authorized authentication are available.
- The OpenAI-compatible adapter is functional when its optional dependency and environment configuration are available.
- Both real-provider paths validate output through the same recommendation schema.
- Missing optional dependencies, authentication, or provider output fail loudly and safely.
- No private data, credentials, raw prompts, or generated user history are committed.
- Targeted tests, Ruff, and mypy pass.
- The README commands match the implemented CLI.

## Implementation order

1. Inspect the repository and preserve existing intent and license.
2. Add packaging and the strict domain models.
3. Add synthetic example user and mentor data.
4. Implement configuration loading, relevance selection, and attribution validation.
5. Implement the deterministic provider and complete CLI path.
6. Add the OpenAI-compatible provider.
7. Add the official Copilot SDK provider.
8. Add tests around stable boundaries and failure cases.
9. Update documentation.
10. Run targeted tests, linting, formatting checks, and type checking.

Do not claim completion if either real provider is only an empty stub. If external credentials are unavailable, validate adapters with fakes and document the exact manual smoke-test command without claiming that live authentication was tested.

At completion, summarize the meaningful implementation choices, commands run, and any live-provider checks that remain credential-dependent.

---
