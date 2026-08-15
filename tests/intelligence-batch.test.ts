import { describe, expect, it } from "vitest";
import {
  ambiguousPostIds,
  IntelligenceValidationError,
  isCorrectableIntelligenceValidationError,
  replaceAmbiguousDecisions,
  validateIntelligenceDecisions
} from "../src/intelligence/decision";
import { scopeIntelligenceBatchJsonSchema } from "../src/contracts";

const newEvent = (postIds: number[], reason = "same event") => ({
  post_ids: postIds,
  action: "NEW_EVENT" as const,
  event_id: null,
  duplicate_of_post_id: null,
  confidence: 0.94,
  canonical_fact: "گزارش مشترک درباره یک رویداد",
  category: "IRAN" as const,
  reason
});

type ScopedSchema = {
  properties: {
    decisions: {
      items: {
        properties: Record<string, { items?: { enum?: number[] }; anyOf?: Array<{ enum?: number[]; type?: string }> }>;
      };
    };
  };
};

describe("Nebula batch decision validation", () => {
  it("scopes post, event, and duplicate references to the current request", () => {
    const schema = scopeIntelligenceBatchJsonSchema([101, 102, 103], [50, 51]) as unknown as ScopedSchema;
    const decision = schema.properties.decisions.items;
    expect(decision.properties.post_ids.items!.enum).toEqual([101, 102, 103]);
    expect(decision.properties.event_id.anyOf![0].enum).toEqual([50, 51]);
    expect(decision.properties.duplicate_of_post_id.anyOf![0].enum).toEqual([101, 102, 103]);
    expect(decision.properties.post_ids.items!.enum).not.toContain(999);
    expect(decision.properties.event_id.anyOf![0].enum).not.toContain(999);
    expect(decision.properties.duplicate_of_post_id.anyOf![0].enum).not.toContain(999);
  });

  it("forces event_id to null when the request supplies no active events", () => {
    const schema = scopeIntelligenceBatchJsonSchema([101, 102], []) as unknown as ScopedSchema;
    expect(schema.properties.decisions.items.properties.event_id).toEqual({ type: "null" });
  });

  it("keeps second-pass post coverage focused while allowing broader duplicate targets", () => {
    const schema = scopeIntelligenceBatchJsonSchema([101], [50], [101, 102, 103]) as unknown as ScopedSchema;
    const decision = schema.properties.decisions.items;
    expect(decision.properties.post_ids.items!.enum).toEqual([101]);
    expect(decision.properties.duplicate_of_post_id.anyOf![0].enum).toEqual([101, 102, 103]);
  });
  it("allows several reports to create exactly one new event decision", () => {
    const decisions = validateIntelligenceDecisions(
      { decisions: [newEvent([8101, 8104, 8110])] },
      [8101, 8104, 8110],
      new Set()
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.post_ids).toEqual([8101, 8104, 8110]);
  });

  it("allows differently worded Persian and English reports to share an event", () => {
    const decisions = validateIntelligenceDecisions(
      { decisions: [newEvent([8101, 8102], "Persian and English descriptions refer to the same timestamped event")] },
      [8101, 8102],
      new Set()
    );
    expect(decisions[0]?.action).toBe("NEW_EVENT");
  });

  it("requires existing-event IDs to come from the supplied active-event list", () => {
    expect(validateIntelligenceDecisions(
      {
        decisions: [{
          post_ids: [8101], action: "MATCH_EXISTING_EVENT", event_id: 1042,
          duplicate_of_post_id: null, confidence: 0.96, canonical_fact: "known event",
          category: "WAR_SECURITY", reason: "same event"
        }]
      },
      [8101],
      new Set([1042])
    )[0]?.event_id).toBe(1042);
  });

  it("records copied reports as duplicates without changing confirmation semantics", () => {
    const decisions = validateIntelligenceDecisions(
      {
        decisions: [{
          post_ids: [8102], action: "DUPLICATE", event_id: null, duplicate_of_post_id: 8101,
          confidence: 0.99, canonical_fact: "copied report", category: "WORLD", reason: "same source wording"
        }]
      },
      [8102],
      new Set(),
      new Set([8101, 8102])
    );
    expect(decisions[0]?.duplicate_of_post_id).toBe(8101);
  });

  it("rejects unknown IDs, contradictory assignments, and malformed JSON", () => {
    expect(() => validateIntelligenceDecisions(
      { decisions: [{
        post_ids: [8101], action: "MATCH_EXISTING_EVENT", event_id: 999,
        duplicate_of_post_id: null, confidence: 0.8, canonical_fact: "unknown event",
        category: "IRAN", reason: "invalid event id"
      }] },
      [8101],
      new Set([1042])
    )).toThrow("intelligence_unknown_event_id");

    expect(() => validateIntelligenceDecisions(
      { decisions: [newEvent([8101]), newEvent([8102])] },
      [8101],
      new Set()
    )).toThrow("intelligence_unknown_post_id");

    expect(() => validateIntelligenceDecisions(
      { decisions: [newEvent([8101]), newEvent([8101])] },
      [8101],
      new Set()
    )).toThrow("intelligence_contradictory_post_assignment");

    expect(() => validateIntelligenceDecisions(
      { decisions: [{ ...newEvent([8101]), category: "MADE_UP" }] },
      [8101],
      new Set()
    )).toThrow("intelligence_output_invalid");

    expect(() => validateIntelligenceDecisions(
      {
        decisions: [
          { ...newEvent([8101]), action: "NOISE" as const },
          { post_ids: [8102], action: "DUPLICATE", event_id: null, duplicate_of_post_id: 8101, confidence: 0.9, canonical_fact: "copy", category: "IRAN", reason: "copy" }
        ]
      },
      [8101, 8102],
      new Set(),
      new Set([8101, 8102])
    )).toThrow("intelligence_invalid_duplicate_target");
  });

  it("classifies only cross-decision contract violations as correctable", () => {
    let error: unknown;
    try {
      validateIntelligenceDecisions(
        {
          decisions: [
            { ...newEvent([8101]), action: "NOISE" as const },
            { post_ids: [8102], action: "DUPLICATE", event_id: null, duplicate_of_post_id: 8101, confidence: 0.9, canonical_fact: "copy", category: "IRAN", reason: "copy" }
          ]
        },
        [8101, 8102],
        new Set(),
        new Set([8101, 8102])
      );
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IntelligenceValidationError);
    expect(isCorrectableIntelligenceValidationError(error)).toBe(true);

    expect(() => validateIntelligenceDecisions(
      { decisions: [{ ...newEvent([8101]), post_ids: [999] }] },
      [8101],
      new Set()
    )).toThrow("intelligence_unknown_post_id");
  });

  it("handles bounded ambiguity resolution and preserves separate events when unresolved", () => {
    const primary = [
      { ...newEvent([8101]), confidence: 0.51, action: "UNCERTAIN" as const, reason: "two plausible events" },
      { ...newEvent([8102]), confidence: 0.95 }
    ];
    const uncertain = ambiguousPostIds(primary, 0.72);
    expect(uncertain).toEqual([8101]);
    const resolved = [{ ...newEvent([8101]), reason: "focused pass still uncertain", action: "UNCERTAIN" as const, confidence: 0.61 }];
    const final = replaceAmbiguousDecisions(primary, resolved, new Set(uncertain));
    expect(final.map((decision) => decision.post_ids[0])).toEqual([8102, 8101]);
    expect(final.find((decision) => decision.post_ids[0] === 8101)?.action).toBe("UNCERTAIN");
  });

  it("keeps same-entity, different-time reports as separate assignments", () => {
    const decisions = validateIntelligenceDecisions(
      { decisions: [newEvent([8101], "event at 00:00"), newEvent([8102], "different event two days later")] },
      [8101, 8102],
      new Set()
    );
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.post_ids).not.toEqual(decisions[1]?.post_ids);
  });
});
