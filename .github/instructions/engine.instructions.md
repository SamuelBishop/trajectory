---
applyTo: "desktop/src/engine/**,desktop/tests/engine/**"
description: Mentorship engine conventions
---

> Implements: `[HC-EXPLICIT-CONFIG-PATHS]`, `[HC-CITATIONS-RESOLVE]`,
> `[HC-BIDIRECTIONAL-ATTRIBUTION]`, `[HC-OBSERVATION-VS-INFERENCE]`,
> `[HC-REFUSE-UNGROUNDED]`, `[SC-UNCERTAINTY-DECLARED]`,
> `[HC-SECRETS-ENV-ONLY]`, `[HC-PRIVATE-INPUT-STDIN]`,
> `[HC-STRICT-SCHEMA-REQUIRED]`, `[HC-TEST-WITH-BEHAVIOR]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

## Layout

The engine runs inside the Electron **main** process. The renderer must never
import from `desktop/src/engine/` — it talks to the engine only through IPC.

| Module | Owns |
| --- | --- |
| `domain.ts` | Zod contracts. Every other module speaks these types. |
| `errors.ts` | The project's error classes |
| `config.ts` | Loading and validating user configuration from disk |
| `paths.ts` | userData resolution and first-launch seeding |
| `selection.ts` | Deterministic choice of which goals/principles are relevant |
| `prompting.ts` | Context assembly and response parsing |
| `validation.ts` | Attribution checks against loaded records |
| `mentorship.ts` | Orchestration of the above |
| `providers/` | Model access. See `providers.instructions.md`. |

Dependencies point inward toward `domain.ts`. `domain.ts` imports nothing from
the rest of the engine.

## Patterns

**Response schemas may not use `.optional()` or `.default()`.**
`recommendationSchema` and `chatResponseSchema` are sent to the model through
`zodResponseFormat`, which requires every property. An optional field produces a
schema the API rejects at runtime. Config schemas are unconstrained.

**Validation is not optional decoration.** Model output is parsed by a zod schema
and *then* checked against loaded records by `validation.ts`. Both steps run.
Skipping the second is how an unresolvable citation reaches the user.

**Fail with the remedy.** Errors name the file, the identifier, or the
environment variable involved.

```ts
// ❌ hides which of six files is malformed
throw new ConfigurationError("invalid configuration");

// ✅
throw new ConfigurationError(`Duplicate goal IDs: ${duplicates.join(", ")}`);
```

**Never widen a search to find data.** The engine takes `userDirectory` and
`mentorDirectory` as arguments and resolves nothing itself. Path resolution
lives in `paths.ts` and is called by the main process.

**Seeding never overwrites.** Bundled demo data is copied into userData only
when the destination is absent. The user's edits are theirs.

**Keep observation and inference in their own fields** all the way through the
pipeline. Do not concatenate them for rendering convenience.

**Refuse rather than generalize.** When selection finds no relevant goal, throw.
An answer with no grounding is worse than no answer, because it looks the same
as a grounded one.

## Style

- Full type annotations. `tsc --noEmit` clean under the existing strict config,
  including `noUncheckedIndexedAccess`.
- `async` for anything touching the filesystem or a provider.
- Prefer a pure function over a class when there is no state. The providers are
  classes because they hold configuration; nothing else needs to be.
- Node built-ins are imported with the `node:` prefix.

## Tests

Vitest, in `desktop/tests/engine/`. Run `cd desktop && npm test`.

Name tests after the behavior, not the function: "rejects an unapproved source"
rather than "loadConfig case 3". Read the existing names before adding one; they
form a readable inventory of what the engine guarantees.

Tests that need a mutated fixture copy it into a temp directory first — see
`tests/engine/fixtures.ts`. Never edit `examples/` or `resources/` from a test.

Never use real personal data in a fixture. Invent it.
