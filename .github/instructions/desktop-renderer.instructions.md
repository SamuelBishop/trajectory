---
applyTo: "desktop/src/renderer/**"
description: Renderer UI conventions and trust boundary
---

> Implements: `[HC-RENDERER-LEAST-PRIVILEGE]`, `[HC-VALIDATE-IPC-INPUT]`,
> `[HC-OBSERVATION-VS-INFERENCE]`, `[SC-UNCERTAINTY-DECLARED]`,
> `[SC-NO-PLACEHOLDERS]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

## Trust boundary

The renderer is sandboxed. It has no Node.js, no filesystem, and no subprocess
access, and it reaches the outside world only through `window.trajectory`.

Validation written here is **user experience, not security**. Every check that
matters is repeated in the main process. Do not remove a main-process check
because the renderer already does it.

If a feature seems to need a capability the preload does not expose, add a named
verb to the preload and a validated handler in main. Never widen the bridge to a
generic pass-through.

## React

React 19 with StrictMode. Effects run twice in development.

```tsx
// ❌ creates two conversations on mount in dev
useEffect(() => { void createConversation(); }, []);

// ✅ guard the initialization
const initialized = useRef(false);
useEffect(() => {
  if (initialized.current) return;
  initialized.current = true;
  void createConversation();
}, []);
```

Both of these shipped as real bugs:

**Double initialization** — StrictMode remounting created duplicate
conversations.

**Stale conversation overwrite** — a reply arriving after the user switched
chats was written into whichever conversation was open. Capture the target ID
before the await and check it still matches before applying the result:

```tsx
const targetId = activeId;
const reply = await window.trajectory.sendMessage({ id: targetId, text });
if (targetId !== activeIdRef.current) return; // user moved on
```

This applies to results that *belong to a specific conversation*. Navigation
handlers like `openConversation` and `newConversation` deliberately set the
active conversation after their await — that is the user's intent, not a stale
write. The question to ask is whether the awaited result is still the one the
user is looking at.

## Editing configuration

Every configuration file is edited two ways: a structured form and a raw YAML
tab. They are two views of one document, so `useDocument` holds a single rule —
after any save, re-read the file from disk and reset both surfaces from that
result. The screen then shows what was written, not what we hoped was written.

Switching tabs is blocked while there are unsaved edits. The alternative is
serializing the form to YAML in the renderer, which means a second serializer
that can drift from `engine/writer.ts`, and showing the stale tab instead would
silently discard the user's edits on the next save.

A file that fails to parse still opens. It returns its text with a `problem`
set, the form steps aside, and the YAML tab is selected — refusing to open the
editor is the one response that makes the file unrepairable.

Never validate a config edit only in the renderer. The schema check that
decides whether bytes hit the disk runs in the main process, over the same zod
schemas the loader uses.

## Presenting grounded output

Assistant messages render GitHub-flavored Markdown with `react-markdown`.
Do not add `rehype-raw`: raw HTML must remain escaped and inert. The main
window denies both navigation and new windows, so a Markdown link may be
visible without granting the renderer authority to navigate the privileged
page.

Streaming events are request-scoped and conversation-scoped. The renderer
creates one optimistic assistant message named by the request ID, accepts only
deltas for the active request and matching conversation, and replaces that
temporary message with the persisted conversation returned by `chat:send`.
Changing conversations while a request runs must never append its private text
to the newly selected conversation.

Observations and inferences arrive in separate fields and stay visually
separate. Do not merge them into one paragraph — the user needs to be able to
disagree with the model's reasoning without doubting what it read.

Show grounding metadata and confidence where the response carries them. An
answer that looks authoritative but has no citations is the exact failure this
product exists to avoid.

## Errors

Surface the message the engine threw. "Something went wrong" hides the missing
environment variable, the unmatched goal, or the absent Copilot runtime that
would let the user actually fix it.

## Style

- TypeScript strict, no `any`, no non-null assertions on IPC results.
- Loading and error states are part of the feature, not a follow-up.
- Plain CSS in `styles.css`. No component library.

## Commands

```bash
cd desktop && npm run dev        # Vite + Electron, hot reload
cd desktop && npm run typecheck
cd desktop && npm test
```

Remember that dev mode cannot detect a broken preload bridge — see
`desktop-main.instructions.md` and `[HC-PRELOAD-CJS]`.
