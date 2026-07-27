# Trajectory

**Open-source AI mentorship for people serious about who they are becoming.**

Trajectory is a local-first experiment in candid, context-aware guidance. It aims to combine a user's values, goals, current circumstances, and source-linked mentor principles to help answer a practical question: does this choice move you toward the person you said you wanted to become?

It is not a productivity score, surveillance system, therapist replacement, imitation of a living person, or authority that should be obeyed automatically. The user remains responsible for every decision.

## Current status

The first MVP includes a deliberately narrow command-line decision review and an experimental Electron chat app. Both explain their responses, cite the context they use, distinguish observation from inference, and admit meaningful uncertainty.

The MVP includes a deterministic local demo, an official GitHub Copilot SDK adapter, and an OpenAI-compatible adapter. Real-person mentor profiles, passive monitoring, additional reflection workflows, integrations, and persistent behavioral memory remain deferred in [Future iterations](docs/FUTURE_ITERATIONS.md). The original implementation brief remains in [MVP build prompt](docs/MVP_BUILD_PROMPT.md).

## Quick start

Trajectory requires Python 3.12 or newer.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
trajectory decide "Should I spend another two hours polishing this low-risk pull request?"
```

The deterministic provider is the default. It uses only the committed synthetic pull-request demo, rejects other scenarios, and requires no network access or credentials. Add `--json` to inspect the exact validated recommendation object. Use Copilot or OpenAI-compatible providers for other decisions.

Use different local configuration with explicit paths:

```bash
trajectory decide "Should I keep polishing this?" \
  --user-dir .trajectory/user \
  --mentor-dir resources/mentors/demo_mentor
```

`.trajectory/` is ignored by Git and is the recommended location for private user files.

## Model providers

### GitHub Copilot SDK

```bash
python -m pip install -e '.[copilot]'
export COPILOT_MODEL=gpt-5
trajectory decide "Should I keep polishing this pull request?" --provider copilot
```

The published SDK wheel includes its compatible Copilot runtime. By default, the SDK uses the locally signed-in GitHub or GitHub CLI user. An authorized token may be supplied through `COPILOT_GITHUB_TOKEN`, but a Copilot Business or Enterprise entitlement is not a generic API key. Organization policy may restrict SDK access, models, data handling, request quotas, or billing. Confirm allowed work-account use with your administrator and never commit a token.

### OpenAI-compatible

```bash
python -m pip install -e '.[openai]'
export OPENAI_API_KEY=...
export OPENAI_MODEL=...
# export OPENAI_BASE_URL=https://compatible.example/v1
trajectory decide "Should I keep polishing this pull request?" --provider openai
```

Provider failures are surfaced directly. Trajectory never silently falls back to the deterministic provider.

## Desktop chat

The experimental desktop app requires Node.js 22 and npm 10. It currently
launches the Python package from this repository as a local sidecar, so install
the Python environment first.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[all]'
npm install --prefix desktop
npm run dev --prefix desktop
```

Choose GitHub Copilot, OpenAI-compatible, or the deterministic demo from the
model selector. The deterministic provider supports only the synthetic
pull-request scenario used by the CLI demo. Provider setup and environment
variables are the same as above.

Conversation history is encrypted with Electron `safeStorage` beneath the
operating system's application-data directory. The app refuses to persist
history if OS-backed encryption is unavailable; it never falls back to
plaintext. Messages sent to Copilot or an OpenAI-compatible provider are still
subject to that provider's processing and retention policies.

Create an unpacked development build with:

```bash
npm run package --prefix desktop
```

The packaged app does not yet bundle Python. Set `TRAJECTORY_SIDECAR_PATH` to an
installed `trajectory` executable before launching it, or ensure `trajectory`
is available on `PATH`. Signed installers and a bundled Python runtime remain
future work.

## Configuration

The demo user configuration lives in `examples/demo/user/`:

- `values.yaml` — values, non-negotiables, and unacceptable tradeoffs
- `goals.yaml` — stable goal IDs, priorities, domains, criteria, and tags
- `current_state.yaml` — responsibilities, projects, deadlines, energy, and progress
- `constraints.yaml` — practical constraints and protected commitments
- `communication.yaml` — directness, challenge, uncertainty, and prohibited patterns

The fictional mentor under `resources/mentors/demo_mentor/` exists only to test source and principle linkage. Its records are explicitly synthetic and are not empirical evidence or a representation of a real person.

## Privacy boundary

Trajectory reads only the user and mentor directories passed to the command. It does not crawl the repository, home directory, messages, shell history, or employer systems. Telemetry is absent. Trajectory does not persist request or response content in its own storage; the Copilot adapter also deletes its SDK session before shutdown.

The deterministic provider remains local. Copilot and OpenAI-compatible providers receive the selected values, goals, current state, constraints, communication preferences, and synthetic mentor grounding. Provider-side processing and retention remain governed by the selected provider and organization policies. Do not submit employer-confidential or otherwise restricted information.

## Development

```bash
python -m pip install -e '.[all,dev]'
pytest
ruff check .
ruff format --check .
mypy
python -m build
```

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
