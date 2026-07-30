/**
 * Electron wraps every handler failure with the channel name, which is an
 * implementation detail the user cannot act on. Strip it and keep the message
 * the main process actually wrote.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': /, "");
  }
  return "Something went wrong.";
}

/**
 * Run an action that may throw *before* it returns a promise, and get a promise
 * either way.
 *
 * Every save button in this app follows the same shape: set a busy flag, call
 * across the bridge, then clear the flag in `.finally`. Written as
 * `action().then(…).catch(…).finally(…)`, that shape has a hole. If `action`
 * throws synchronously — which is exactly what calling a bridge method the
 * preload does not have does — the throw escapes before any handler is
 * attached. The `.catch` never sees it, the `.finally` never runs, and the
 * button reads "Saving…" forever while saying nothing about why.
 *
 * That is not hypothetical. A renderer hot-reloads on save; the preload does
 * not. Any development session that adds a bridge method spends time in a state
 * where the new UI is talking to an older preload, and the first symptom was a
 * credential field that hung with no message rather than one that said the
 * method was missing.
 */
export function attempt<T>(action: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(action);
}
