/**
 * The boundary where a briefing headline leaves the application and becomes an
 * operating-system notification.
 *
 * Implements: [HC-NO-EXFILTRATION] (adjacent), [HC-NO-PLAINTEXT-HISTORY]
 *
 * `[HC-NO-EXFILTRATION]` governs network egress, so handing text to macOS is
 * not a breach of it. It is close enough to deserve a single, obvious place
 * where it happens: everything that reaches `Notification` passes through
 * `notificationBodyFor` below, and nothing else in the app constructs one.
 *
 * What macOS does with the text is outside our control. It may render on the
 * lock screen, and Continuity may mirror it to a paired iPhone. Two defences,
 * in order:
 *
 * 1. The system prompt tells the model what a headline may not contain. That is
 *    the real control, and it is the only one that understands meaning.
 * 2. This file enforces shape, not meaning — one line, bounded length — because
 *    a model instruction is not a guarantee and a newline-injected second line
 *    would render as body text the user never sees in the app.
 *
 * When the user opts out, a fixed string is used and the headline never leaves
 * the encrypted store at all.
 */

/** Shorter than the schema's 120 so macOS truncates rarely rather than always. */
export const NOTIFICATION_BODY_LIMIT = 110;

export const GENERIC_NOTIFICATION_BODY = "Your midday check-in is ready.";

export const NOTIFICATION_TITLE = "Trajectory";

/**
 * Collapses to a single line and caps the length.
 *
 * A headline is schema-validated at 120 characters, but validation happens on
 * the model's output and this runs on whatever reaches the notifier — including
 * a record read back from disk written by an older version. Defending here as
 * well costs one function call.
 */
export function sanitizeHeadline(headline: string): string {
  const oneLine = headline.replace(/\s+/gu, " ").trim();
  if (oneLine.length <= NOTIFICATION_BODY_LIMIT) {
    return oneLine;
  }
  return `${oneLine.slice(0, NOTIFICATION_BODY_LIMIT - 1).trimEnd()}…`;
}

/**
 * The text that will be handed to the operating system.
 *
 * Falls back to the generic line when the user has opted out, and also when the
 * headline is empty or whitespace — an empty notification body would render as
 * a bare title and read like a bug.
 */
export function notificationBodyFor(options: {
  headline: string;
  includeHeadline: boolean;
}): string {
  if (!options.includeHeadline) {
    return GENERIC_NOTIFICATION_BODY;
  }
  const sanitized = sanitizeHeadline(options.headline);
  return sanitized.length > 0 ? sanitized : GENERIC_NOTIFICATION_BODY;
}
