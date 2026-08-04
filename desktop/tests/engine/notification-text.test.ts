import { describe, expect, it } from "vitest";

import {
  GENERIC_NOTIFICATION_BODY,
  NOTIFICATION_BODY_LIMIT,
  notificationBodyFor,
  sanitizeHeadline,
} from "../../src/engine/notification-text";

describe("notification text", () => {
  it("passes a normal headline through unchanged", () => {
    const headline = "Behind on the training block — protect the afternoon.";

    expect(notificationBodyFor({ headline, includeHeadline: true })).toBe(
      headline,
    );
  });

  it("collapses a headline to a single line", () => {
    // A newline would render as a second line in Notification Center, showing
    // text the model wrote as a continuation rather than as a headline.
    expect(
      notificationBodyFor({
        headline: "On track.\nBut the design proposal has slipped three days.",
        includeHeadline: true,
      }),
    ).toBe("On track. But the design proposal has slipped three days.");
  });

  it("strips carriage returns and tabs as well as newlines", () => {
    expect(sanitizeHeadline("One\r\nTwo\tThree")).toBe("One Two Three");
  });

  it("caps a headline longer than the notification limit", () => {
    const body = notificationBodyFor({
      headline: "a".repeat(400),
      includeHeadline: true,
    });

    expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_LIMIT);
    expect(body.endsWith("…")).toBe(true);
  });

  it("keeps a headline exactly at the limit intact", () => {
    const headline = "a".repeat(NOTIFICATION_BODY_LIMIT);

    expect(notificationBodyFor({ headline, includeHeadline: true })).toBe(
      headline,
    );
  });

  it("substitutes a generic line when the user has opted out", () => {
    // The opt-out is the whole privacy control. A headline leaking through here
    // would reach the lock screen of a user who explicitly said no.
    const headline = "Nine straight training days against your recovery limit.";

    expect(notificationBodyFor({ headline, includeHeadline: false })).toBe(
      GENERIC_NOTIFICATION_BODY,
    );
    expect(notificationBodyFor({ headline, includeHeadline: false })).not.toContain(
      "training",
    );
  });

  it("falls back to the generic line for an empty headline", () => {
    // An empty body renders as a bare title and reads like a bug.
    for (const headline of ["", "   ", "\n\t"]) {
      expect(notificationBodyFor({ headline, includeHeadline: true })).toBe(
        GENERIC_NOTIFICATION_BODY,
      );
    }
  });

  it("keeps the generic line free of anything specific", () => {
    expect(GENERIC_NOTIFICATION_BODY).toMatch(/check-in is ready/);
    expect(GENERIC_NOTIFICATION_BODY.length).toBeLessThanOrEqual(
      NOTIFICATION_BODY_LIMIT,
    );
  });

  it("never returns a multi-line body, whatever it is given", () => {
    for (const headline of [
      "a\nb",
      `${"a".repeat(200)}\n${"b".repeat(200)}`,
      "  \n  leading and trailing  \n  ",
    ]) {
      const body = notificationBodyFor({ headline, includeHeadline: true });
      expect(body).not.toContain("\n");
      expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_LIMIT);
    }
  });
});
