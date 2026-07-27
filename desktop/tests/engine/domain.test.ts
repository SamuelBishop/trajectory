import { zodResponseFormat } from "openai/helpers/zod";
import { describe, expect, it } from "vitest";

import {
  chatResponseSchema,
  goalSchema,
  mentorPrincipleSchema,
  recommendationSchema,
  valuesConfigSchema,
} from "../../src/engine/domain";

const goal = {
  id: "deep_work",
  description: "Protect two deep work blocks each week",
  motivation: "Shipping requires uninterrupted time",
  priority: 2,
  domain: "focus",
  success_criteria: ["Two blocks held for four consecutive weeks"],
  status: "active",
  target_date: null,
  tags: ["focus"],
};

describe("domain schemas", () => {
  it("trims text and rejects blank values", () => {
    const parsed = valuesConfigSchema.parse({
      core_values: ["  Honesty  "],
    });
    expect(parsed.core_values).toEqual(["Honesty"]);
    expect(
      valuesConfigSchema.safeParse({ core_values: ["   "] }).success,
    ).toBe(false);
    expect(valuesConfigSchema.safeParse({ core_values: [] }).success).toBe(
      false,
    );
  });

  it("applies defaults for omitted optional lists", () => {
    const parsed = valuesConfigSchema.parse({ core_values: ["Honesty"] });
    expect(parsed.non_negotiables).toEqual([]);
    expect(parsed.unacceptable_tradeoffs).toEqual([]);
  });

  it("rejects unknown keys", () => {
    expect(goalSchema.safeParse({ ...goal, surprise: 1 }).success).toBe(false);
  });

  it("enforces the identifier pattern", () => {
    expect(goalSchema.safeParse({ ...goal, id: "Deep_Work" }).success).toBe(
      false,
    );
    expect(goalSchema.safeParse({ ...goal, id: "_leading" }).success).toBe(
      false,
    );
    expect(goalSchema.safeParse({ ...goal, id: "deep-work-2" }).success).toBe(
      true,
    );
  });

  it("bounds priority and confidence", () => {
    expect(goalSchema.safeParse({ ...goal, priority: 0 }).success).toBe(false);
    expect(goalSchema.safeParse({ ...goal, priority: 6 }).success).toBe(false);
    expect(
      mentorPrincipleSchema.safeParse({
        id: "p1",
        mentor_id: "m1",
        name: "n",
        description: "d",
        domains: ["focus"],
        source_ids: ["s1"],
        support_type: "synthetic_demo",
        confidence: 1.2,
        interpretation_notes: "notes",
        review_status: "reviewed",
      }).success,
    ).toBe(false);
  });

  it("accepts an ISO target date and rejects other date shapes", () => {
    expect(
      goalSchema.safeParse({ ...goal, target_date: "2026-01-15" }).success,
    ).toBe(true);
    expect(
      goalSchema.safeParse({ ...goal, target_date: "15/01/2026" }).success,
    ).toBe(false);
  });

  it("rejects dates that match the shape but are not real days", () => {
    // A pattern check alone lets an impossible date through to the provider as
    // grounded context. Python's `date` rejected these, so this must too.
    for (const impossible of [
      "2026-99-99",
      "2026-13-01",
      "2026-02-30",
      "2025-02-29",
      "2026-00-10",
      "2026-01-00",
    ]) {
      expect(
        goalSchema.safeParse({ ...goal, target_date: impossible }).success,
      ).toBe(false);
    }
    // A genuine leap day is still a real day.
    expect(
      goalSchema.safeParse({ ...goal, target_date: "2024-02-29" }).success,
    ).toBe(true);
  });

  it("defaults target_date to null when the key is absent", () => {
    const { target_date: _omitted, ...withoutDate } = goal;
    expect(goalSchema.parse(withoutDate).target_date).toBeNull();
  });
});

/**
 * Implements: [HC-STRICT-SCHEMA-REQUIRED]
 *
 * The Python implementation shipped a schema that OpenAI rejected at runtime,
 * because Pydantic omitted fields with defaults from `required`. These tests
 * assert the property directly instead of trusting the generator.
 */
describe("strict response schemas", () => {
  const cases = [
    ["recommendation", recommendationSchema],
    ["chat response", chatResponseSchema],
  ] as const;

  for (const [name, schema] of cases) {
    it(`lists every ${name} property in required`, () => {
      const format = zodResponseFormat(schema, "probe");
      const json = format.json_schema.schema as {
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
      const properties = Object.keys(json.properties).sort();
      expect([...(json.required ?? [])].sort()).toEqual(properties);
      expect(json.additionalProperties).toBe(false);
      expect(format.json_schema.strict).toBe(true);
    });
  }
});
