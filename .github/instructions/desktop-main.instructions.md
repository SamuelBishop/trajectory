---
applyTo: "desktop/src/main/**,desktop/src/preload/**,desktop/electron.vite.config.ts"
description: Electron main process and preload security
---

> Implements: `[HC-RENDERER-LEAST-PRIVILEGE]`, `[HC-PRELOAD-CJS]`,
> `[HC-VALIDATE-IPC-INPUT]`, `[HC-NO-RENDERER-URL-FROM-ENV]`,
> `[HC-ATOMIC-SERIALIZED-WRITES]`, `[HC-NO-PLAINTEXT-HISTORY]`,
> `[HC-PRIVATE-INPUT-STDIN]`
>
> Bars live in `docs/methodology/CONSTITUTION.md`. This file is patterns only.

Five of the six real defects found in this app were in these files. Every
pattern below is transcribed from one of them — none is hypothetical.

## Files

| File | Owns |
| --- | --- |
| `index.ts` | App lifecycle, window creation, renderer URL policy |
| `ipc.ts` | The IPC handler surface. The trust boundary. |
| `store.ts` | Encrypted conversation persistence |
| `../engine/**` | The mentorship engine, called in-process. See `engine.instructions.md`. |

## Window options are load-bearing

```ts
contextIsolation: true,
nodeIntegration: false,
sandbox: true,
```

Nothing in the test suite fails if these are changed. Treat an edit here as a
security change requiring explicit justification.

## The preload must be CommonJS

`electron.vite.config.ts` forces `format: "cjs"` and
`entryFileNames: "[name].cjs"`, and `index.ts` loads `../preload/index.cjs`.

A sandboxed preload cannot be an ES module. Without the override the bundler
emits `.mjs`, the preload silently fails to load, and `window.trajectory` is
`undefined` — **only in the packaged app**. Dev mode looks perfectly fine.

If you change the preload build config or its entry filename, run
`npm run package && npm run smoke`. `npm run typecheck && npm test &&
npm run build` all pass while this is broken, and so does `npm run package` —
`electron-builder --dir` never launches the app. `npm run smoke` does.

## The preload is an allow-list, not a pipe

```ts
// ❌ hands the renderer the whole IPC surface
contextBridge.exposeInMainWorld("trajectory", { invoke: ipcRenderer.invoke });

// ✅ named verbs only
contextBridge.exposeInMainWorld("trajectory", {
  listConversations: () => ipcRenderer.invoke("chat:list"),
  sendMessage: (input) => ipcRenderer.invoke("chat:send", input),
});
```

The renderer never chooses an executable path, a working directory, or a
filesystem location. Main decides *where*; the renderer only asks *what*.

## Validate at the handler

Every `ipcMain.handle` treats its payload as untrusted. Check the shape and the
identifier, and reject rather than coerce. Renderer-side checks are UX, not
control — a compromised renderer skips them.

## Renderer URL

```ts
const value = process.env.ELECTRON_RENDERER_URL;
if (app.isPackaged || !value) return null;  // packaged builds ignore it entirely
```

Without the `isPackaged` gate, an environment variable can point a privileged
window holding the preload bridge at an arbitrary remote page.

## Store writes

Two separate properties, both required:

- **Atomic** — write a temp file, `fsync`, then `rename`. A partial write must
  never be observable.
- **Serialized** — chain mutations through one promise queue. Two concurrent
  creates that both read-modify-write will drop one conversation.

Encryption is mandatory. When `safeStorage.isEncryptionAvailable()` is false, or
the Linux backend is `basic_text`, fail and surface it. There is no plaintext
path.

## Sidecar

Private message and history payloads go over **stdin as JSON**. Argv is visible
to any local process listing. Errors from the Python process get surfaced to the
user with the actual message, not a generic failure.

## Tests

Only `store.test.ts` exists. Everything else here rests on review — see
`docs/methodology/coverage-gaps.md`. Adding a test for IPC validation or window
options would close a real gap.
