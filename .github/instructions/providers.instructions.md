---
applyTo: "src/trajectory/providers/**"
description: Model provider contract and SDK boundary
---

> Implements: `[HC-NO-PROVIDER-FALLBACK]`, `[HC-PROVIDER-PARITY]`,
> `[HC-STRICT-SCHEMA-REQUIRED]`, `[HC-SDK-BOUNDARY]`,
> `[HC-SECRETS-ENV-ONLY]`, `[HC-NO-EXFILTRATION]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

This is the only directory allowed to make outbound network calls or import a
vendor SDK.

## The protocol

`base.py` defines it. Every provider implements **both** methods:

```python
class MentorProvider(Protocol):
    name: str

    async def generate(self, request: DecisionRequest) -> Recommendation: ...

    async def chat(self, request: ChatRequest) -> ChatResponse: ...
```

A provider that implements one and raises on the other turns the provider
selector into a trap. Adding a third method means updating `deterministic.py`,
`openai_compatible.py`, and `copilot.py` in the same change.

## Failure is the output

```python
# ❌ the user asked for a specific model and silently got a different answer
except OpenAIError:
    return await deterministic.generate(request)

# ✅
except OpenAIError as exc:
    raise ProviderError(f"OpenAI request failed: {exc}") from exc
```

No fallback. No canned response. No retry against a different vendor. A raised
error is a correct outcome here.

Retrying the *same* provider on malformed structured output is fine and already
implemented — that is recovering from a bad response, not substituting a
different source of truth.

## Strict structured output

Under `strict: true`, every property must appear in `required` — including
properties with defaults.

```python
# ❌ Pydantic omits this from `required`; the API rejects the whole schema
observations: list[str] = Field(default_factory=list)

# ✅ required in the schema, emptiness handled by validation
observations: list[str]
```

This shipped as a runtime failure once. When adding a field to a
structured-output model, check the emitted schema, not just the type.

## SDK boundary

Keep the vendor inside the module:

- Import the SDK lazily and raise a clear `ProviderError` naming the extra to
  install when the import fails.
- Request the least authority available — tools disabled, permissions denied.
- Clean up in `finally`, so an exception mid-request still deletes the session.
- Wrap every vendor exception in `ProviderError`. Nothing outside `providers/`
  should ever need to catch an SDK type.

## Credentials

Read from the environment, or use the host's existing GitHub authentication for
Copilot. Never from a file, an argument, or an interactive prompt. When missing,
name the variable and stop — never echo the value, not even partially masked.

## Tests

Every provider test stubs the SDK at the module boundary; none makes a network
call. `tests/test_providers.py` is the pattern to copy.
