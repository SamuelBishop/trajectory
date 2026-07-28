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
