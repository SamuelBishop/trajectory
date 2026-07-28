---
applyTo: "desktop/src/engine/providers/**"
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

`types.ts` defines it. Every provider implements **both** methods:

```ts
export interface MentorProvider {
  readonly name: string;
  generate(request: DecisionRequest): Promise<Recommendation>;
  chat(request: ChatRequest): Promise<ChatResponse>;
}
```

A provider that implements one and throws on the other turns the provider
selector into a trap. Adding a third method means updating `deterministic.ts`,
`openai.ts`, and `copilot.ts` in the same change — the interface makes that a
compile error, which is the point.

`factory.ts` maps a `ProviderName` to an instance. Its `switch` is exhaustive on
the union, so a new provider name will not compile until it is handled.

## Failure is the output

```ts
// ❌ the user asked for a specific model and silently got a different answer
} catch (error) {
  return await new DeterministicProvider().generate(request);
}

// ✅
} catch (error) {
  throw new ProviderError("OpenAI-compatible request failed ...", { cause: error });
}
```

No fallback. No canned response. No retry against a different vendor. A raised
error is a correct outcome here.

Retrying the *same* provider on malformed structured output is fine and already
implemented — that is recovering from a bad response, not substituting a
different source of truth.

## Strict structured output

Under `strict: true`, every property must appear in `required` — including
properties with defaults.

```ts
// ❌ zodResponseFormat marks this optional; the API rejects the whole schema
observations: z.array(text).optional(),

// ✅ required in the schema, emptiness handled by validation
observations: z.array(text),
```

This shipped as a runtime failure once, under Pydantic. Zod makes it harder to
reintroduce but not impossible — `.optional()` and `.default()` on a response
schema still produce a schema the API rejects. `domain.test.ts` asserts the
emitted shape directly, so add the field and run the tests rather than reasoning
about it.

## SDK boundary

Keep the vendor inside the module:

- Import the SDK with a dynamic `await import()` and throw a clear
  `ProviderError` when it fails, so a broken install is diagnosable.
- Request the least authority available — tools disabled, permissions denied.
  Denial means the SDK's actual refusal decision. Copilot's
  `{ kind: "no-result" }` sends no decision at all and leaves the request
  hanging; `{ kind: "reject", feedback }` is the denial.
- Give the runtime nothing ambient to read. Copilot's default `copilot-cli` mode
  loads `AGENTS.md`, `.github/copilot-instructions.md` and `CLAUDE.md` from its
  working directory — `process.cwd()` by default — into the prompt. Use
  `mode: "empty"` with an application-owned `baseDirectory` and
  `workingDirectory`, `skipCustomInstructions: true`, and
  `enableSessionTelemetry: false`. The main process chooses that directory; the
  provider never defaults it.
- Clean up in `finally`, so an exception mid-request still deletes the session —
  and never let teardown throw over the original error. Attach
  `.catch(() => undefined)` rather than nesting another `try`.
- Wrap every vendor error in `ProviderError`. Nothing outside `providers/`
  should ever need to catch an SDK type.
- Expose an injection seam (`client`, `clientFactory`) so tests can exercise the
  boundary without a network call or a local runtime.

## Credentials

Read from the environment, from the encrypted secret store, or from the host's
existing GitHub authentication for Copilot. Never from a file, an argument, or
an interactive prompt. When missing, name the variable and stop — never echo the
value, not even partially masked.

A provider never reaches into the secret store itself. `createProvider` takes a
`ProviderContext` carrying the resolved `model` and `openaiApiKey`, and every
constructor still reads from an environment-shaped object — so the injection
seam that makes these testable without a network call stays the only seam.

In-app settings override the environment, because a GUI app launched from
Finder inherits no shell environment: the value typed into the window is the
only one the user can see or change.

Treat an empty string as absent. `env.COPILOT_MODEL ?? DEFAULT` passes an
exported-but-empty variable through as though it were a real model name; the
check is on trimmed content, not on `undefined`.

## The packaged app is a different environment

`[HC-PACKAGED-RUNTIME]`. An SDK that works in `npm test` and `npm run dev` can
still be broken in the shipped app, and the failure is usually silent.

The Copilot SDK demonstrated all three shapes of this in one sitting:

| Assumption the SDK made | What happened in the packaged app |
| --- | --- |
| `process.execPath` is Node | It is the Electron binary, so the spawn launched a second copy of the app. `start()` never resolved — no error, no log, no timeout. |
| `ELECTRON_RUN_AS_NODE` fixes that | The runtime's own parser branches on `process.versions.electron`, which Electron still reports in Node mode, and it ate the script path as a positional argument. |
| A resolved module path can be spawned | Executables cannot run from inside `app.asar`. `spawn` returned `ENOTDIR`. |

The provider now resolves the platform package's native binary and rewrites
`app.asar` to `app.asar.unpacked`, and refuses with a clear `ProviderError` when
it cannot find one. Prefer refusing to hanging: a hang gives the user nothing to
act on.

Default to a model every entitlement can reach — `auto` — rather than naming a
specific one. `COPILOT_MODEL` overrides it.

After changing anything about how a provider reaches its runtime, run
`npm run package && npm run smoke` from `desktop/`. The unit tests cover the
resolution logic; only the smoke test proves the result is spawnable.

## Tests

Every provider test stubs the SDK at the module boundary; none makes a network
call or spawns a runtime. `desktop/tests/engine/providers.test.ts` is the
pattern to copy.
