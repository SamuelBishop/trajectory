# Trajectory

**Open-source AI mentorship for people serious about where their effort is taking them.**

Most ambitious people do not need another system telling them to work harder.

They already care. They already have goals. They already know how to fill a day.
The harder problem is noticing when a full day and a meaningful day stop being
the same thing.

That drift rarely looks dramatic. It looks like polishing work that is already
good enough. Saying yes to an urgent request that has little to do with the
person you want to become. Treating exhaustion as a character flaw. Staying
busy because the important task is uncomfortable.

Each choice can sound reasonable on its own. Stack enough of them together and
you can work extremely hard in a direction you never deliberately chose.

Trajectory is an attempt to build better feedback into that gap.

## What is Trajectory?

Trajectory is a local-first AI mentor that combines:

- your values and non-negotiables;
- your goals and current priorities;
- your responsibilities, constraints, and energy;
- source-linked principles from mentors you respect;
- and the decision in front of you.

It uses that context to give a direct, grounded answer to a practical question:

> Does this choice move you toward the person you said you wanted to become?

Not a productivity score. Not automatic approval. Not a machine demanding more
output from every available hour.

Sometimes the answer should be: keep going.

Sometimes it should be: ship the work.

Sometimes it should be: you are avoiding the thing that matters.

And sometimes the highest-leverage move is to close the laptop and recover.

Context is the point.

## What useful mentorship should feel like

A useful mentor does not agree with everything you say. It helps separate:

- necessary persistence from stubbornness;
- high standards from perfectionism;
- meaningful work from visible activity;
- discomfort from genuine misalignment;
- and disciplined effort from unsustainable intensity.

Trajectory is designed to be candid without becoming demeaning, supportive
without becoming flattering, and uncertain when the available evidence is not
strong enough.

It critiques decisions and patterns. It does not judge a person's worth.

It also does not pretend to *be* a living mentor. Mentor resources are
source-grounded perspectives with explicit citations, interpretations,
confidence, and limitations. The user's own values and goals always outrank
them.

## An example

You ask:

> Should I spend another two hours polishing this low-risk pull request?

Trajectory can connect that choice to the facts that the change is already
functionally complete, a higher-value design proposal has been postponed twice,
and architectural ownership is one of your stated goals.

It can then recommend a short correctness check, explain the opportunity cost,
identify possible perfectionism as an inference rather than a fact, cite the
goal and mentor principle it used, and admit that it cannot see an unreported
production or security risk.

Specific enough to act on. Transparent enough to question.

## Current status

The MVP has two interfaces:

- a Python CLI for structured decision reviews and grounded chat;
- an experimental Electron chat app for macOS and Windows development.

It supports a deterministic local demo, the official GitHub Copilot SDK, and
OpenAI-compatible providers. Responses use validated contracts, cite the
selected context, distinguish observations from inferences, and include
meaningful uncertainty.

This is still an early experiment. Editable mentors and goals, context
integrations, proactive interventions, mobile clients, and behavioral memory
remain pending in [Future iterations](docs/FUTURE_ITERATIONS.md). The original
implementation brief is preserved in
[MVP build prompt](docs/MVP_BUILD_PROMPT.md).

## Quick start: CLI

Trajectory requires Python 3.12 or newer.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
trajectory decide "Should I spend another two hours polishing this low-risk pull request?"
```

The deterministic provider is the default. It supports only the committed
synthetic pull-request scenario and requires no network access or credentials.
Add `--json` to inspect the exact validated response.

Use private local configuration with explicit paths:

```bash
trajectory decide "Should I keep polishing this?" \
  --user-dir .trajectory/user \
  --mentor-dir resources/mentors/demo_mentor
```

`.trajectory/` is ignored by Git and is the recommended location for private
user files.

## Quick start: desktop chat

The desktop app requires Node.js 22, npm 10, and the local Python environment.
It currently launches Python as a sidecar process.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[all]'
npm install --prefix desktop
npm run dev --prefix desktop
```

Choose GitHub Copilot, OpenAI-compatible, or the deterministic demo from the
model selector. Conversation history is encrypted with Electron `safeStorage`
in the operating system's application-data directory. If OS-backed encryption
is unavailable, the app refuses to persist history rather than falling back to
plaintext.

Create an unpacked development build with:

```bash
npm run package --prefix desktop
```

The packaged app does not yet bundle Python. Set `TRAJECTORY_SIDECAR_PATH` to an
installed `trajectory` executable or ensure it is available on `PATH`. Signed
installers and a bundled runtime are future work.

## How it works

Trajectory keeps context assembly, generation, validation, and presentation
separate:

1. It loads only the user and mentor directories selected for the request.
2. It chooses the goals, principles, and source records relevant to the question.
3. It sends that bounded context to the selected provider.
4. It validates the structured response and every referenced identifier.
5. It returns the recommendation, reasoning, citations, confidence, and uncertainty.

The deterministic provider generates the committed demo response locally.
Copilot and OpenAI-compatible providers receive the selected context and must
return the same domain contract. Provider failures are surfaced directly;
Trajectory never silently swaps in a different provider.

The Electron renderer has no direct filesystem or process access. A narrow
preload bridge sends validated requests to the main process, which owns the
encrypted store and communicates with Python over stdin. Private messages are
not placed in process arguments.

## Configuration

The synthetic demo user lives in `examples/demo/user/`:

- `values.yaml` — values, non-negotiables, and unacceptable tradeoffs;
- `goals.yaml` — stable goal IDs, priorities, criteria, and tags;
- `current_state.yaml` — responsibilities, projects, deadlines, and progress;
- `constraints.yaml` — practical limits and protected commitments;
- `communication.yaml` — directness, challenge, uncertainty, and prohibited patterns.

The fictional profile in `resources/mentors/demo_mentor/` exists only to test
source and principle linkage. It is not empirical evidence or a representation
of a real person.

## Model providers

### GitHub Copilot SDK

```bash
python -m pip install -e '.[copilot]'
export COPILOT_MODEL=gpt-5
trajectory decide "Should I keep polishing this pull request?" --provider copilot
```

The SDK uses the locally signed-in GitHub or GitHub CLI user by default.
Organization policy may restrict SDK access, models, retention, quotas, or
billing. Confirm allowed work-account use with your administrator and never
commit a token.

### OpenAI-compatible

```bash
python -m pip install -e '.[openai]'
export OPENAI_API_KEY=...
export OPENAI_MODEL=...
# export OPENAI_BASE_URL=https://compatible.example/v1
trajectory decide "Should I keep polishing this pull request?" --provider openai
```

## Privacy boundary

The CLI does not crawl the repository, home directory, messages, shell history,
or employer systems. It does not persist its own request history, and the
Copilot adapter deletes its SDK session before shutdown.

The desktop app persists conversation history only in its encrypted local
store. Copilot and OpenAI-compatible providers still receive selected user and
mentor context, and their processing remains governed by their own policies.
Do not submit employer-confidential or otherwise restricted information.

Passive monitoring, integrations, and notifications are not part of the
current application. Any future data source must be explicit, permission
scoped, inspectable, and removable.

## Contributing

Trajectory should improve through transparent engineering and stronger
evidence—not by making an AI sound more certain or more famous.

Useful contributions include:

- Electron and TypeScript architecture;
- privacy, encryption, and local-first storage;
- grounded mentor-resource research;
- recommendation and prompt evaluation;
- task, calendar, and activity adapters;
- accessibility and interaction design;
- tests, documentation, and developer experience.

Set up both development surfaces from the repository root:

```bash
python -m pip install -e '.[all,dev]'
pytest
ruff check .
ruff format --check .
mypy

npm install --prefix desktop
npm run typecheck --prefix desktop
npm test --prefix desktop
npm run build --prefix desktop
```

Keep changes narrow, preserve provider-independent contracts, and add tests when
behavior changes. Never commit private user configuration, credentials, chat
history, or generated application data.

Mentor-resource contributions must:

- use public or properly licensed sources;
- cite the material supporting each principle;
- distinguish direct statements from interpretation;
- avoid fabricated quotations and unsupported attribution;
- document confidence, uncertainty, and likely blind spots;
- avoid implying that a living person endorses the profile or this project.

Start with [Future iterations](docs/FUTURE_ITERATIONS.md) for the broader
backlog. Large additions should be scoped before implementation so integrations
do not quietly widen the privacy boundary or turn uncertain inference into
fact.

## Principles

- Direction over task volume
- Context over rigid rules
- Patterns over isolated events
- Challenge over flattery
- Sustainability over performative intensity
- Transparency over authority
- Privacy and user agency by default

## License

Licensed under the [Apache License 2.0](LICENSE).
