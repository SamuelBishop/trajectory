---
applyTo: "src/trajectory/**,tests/**"
description: Python mentorship engine conventions
---

> Implements: `[HC-EXPLICIT-CONFIG-PATHS]`, `[HC-CITATIONS-RESOLVE]`,
> `[HC-BIDIRECTIONAL-ATTRIBUTION]`, `[HC-OBSERVATION-VS-INFERENCE]`,
> `[HC-REFUSE-UNGROUNDED]`, `[SC-UNCERTAINTY-DECLARED]`,
> `[HC-SECRETS-ENV-ONLY]`, `[HC-PRIVATE-INPUT-STDIN]`,
> `[HC-TEST-WITH-BEHAVIOR]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

## Layout

| Module | Owns |
| --- | --- |
| `domain.py` | Pydantic contracts. Every other module speaks these types. |
| `config.py` | Loading and validating user configuration from disk |
| `selection.py` | Deterministic choice of which goals/principles are relevant |
| `prompting.py` | Context assembly and response parsing |
| `validation.py` | Attribution checks against loaded records |
| `mentorship.py` | Orchestration of the above |
| `rendering.py` | Human-readable output |
| `cli.py` | Typer commands, argument handling, stdin mode |
| `errors.py` | The project's exception types |
| `providers/` | Model access. See `providers.instructions.md`. |

Dependencies point inward toward `domain.py`. `domain.py` imports nothing from
the rest of the package.

## Patterns

**Validation is not optional decoration.** Model output is parsed into a
Pydantic type and then checked against loaded records by `validation.py`. Both
steps run. Skipping the second is how an unresolvable citation reaches the user.

**Fail with the remedy.** Errors name the file, the identifier, or the
environment variable involved.

```python
# ❌ hides which of six files is malformed
raise ConfigurationError("invalid configuration")

# ✅
raise ConfigurationError(f"{path}: duplicate goal id {goal_id!r}")
```

**Never widen a search to find data.** Resolve configuration from the explicit
`--user-dir` / `--mentor-dir`, then the declared candidate list. When nothing
matches, report the paths tried.

**Keep observation and inference in their own fields** all the way through the
pipeline. Do not concatenate them for rendering convenience — `rendering.py`
presents them separately on purpose.

**Refuse rather than generalize.** When selection finds no relevant goal, raise.
An answer with no grounding is worse than no answer, because it looks the same
as a grounded one.

## Style

- Python 3.12+, full type annotations, `mypy --strict` clean.
- Ruff with `E,F,I,UP,B,SIM,RUF`, line length 100.
- `async` for anything touching a provider.
- Prefer a pure function over a method when there is no state.

## Tests

`pytest` with `asyncio_mode = "auto"` — no `@pytest.mark.asyncio` needed.

Name tests after the behavior, not the function: `test_rejects_unapproved_source`
rather than `test_load_config_3`. Read the existing names in `tests/` before
adding one; they form a readable inventory of what the engine guarantees.

Never use real personal data in a fixture. Invent it.

Run: `.venv/bin/python -m pytest`. The system Python is 3.9 and will fail.
