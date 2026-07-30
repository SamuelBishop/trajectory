/**
 * Text bounding shared by every adapter.
 *
 * Implements: [HC-SECRETS-ENV-ONLY], [HC-NO-PRIVATE-DATA-COMMITS]
 *
 * Summaries are bounded at the source rather than in the prompt builder. A
 * commit body, a task description, or an activity note is unbounded, is written
 * for a different audience, and occasionally contains a pasted credential. One
 * line with a hard cap is both a context-budget decision and a privacy one.
 *
 * This lives apart from any single adapter because it is the same decision
 * everywhere, and a Notion adapter reaching into the GitHub adapter for it
 * would be a dependency that describes nothing true about either.
 */

/** First line only, hard-capped, with an ellipsis marking what was cut. */
export function firstLine(message: string, limit = 280): string {
  const line = message.split(/\r\n|\r|\n/, 1)[0]?.trim() ?? "";
  if (line.length === 0) {
    return "";
  }
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}
