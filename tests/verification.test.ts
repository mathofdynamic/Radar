import { describe, expect, it } from "vitest";
import { calculateVerification, originGroupFor } from "../src/intelligence/verification";
import type { EventRow, RawPostRow, SourceRow } from "../src/types";

const event = { verification_status: "UNVERIFIED", independent_confirmation_count: 0 } as EventRow;
const source = (id: number, trust_score: number, role: SourceRow["role"]): SourceRow => ({ id, source_key: `s${id}`, name: `S${id}`, telegram_username: `s${id}`, role, priority_tier: trust_score > 0.6 ? "TIER_1" : "TIER_3", category: "IRAN", language: "fa", source_type: "news", trust_score, is_wire_origin: role === "primary_source", public_url: `https://t.me/s${id}`, is_active: 1, health_status: "healthy", next_poll_at: null, last_seen_message_id: null, last_error: null });
const raw = (id: number, text: string, metadata = "{}"): RawPostRow => ({ id, source_id: id, telegram_message_id: id, canonical_url: `https://t.me/s${id}/${id}`, update_type: "create", published_at: new Date().toISOString(), edited_at: null, observed_at: new Date().toISOString(), language: "fa", original_text: text, normalized_text: text, content_hash: "a".repeat(64), media_type: null, raw_html_snippet: null, raw_metadata_json: metadata, is_deleted: 0, is_noise: 0, noise_reason: null, processing_status: "analyzed" });

describe("independent verification", () => {
  it("does not count copied reports as independent when origin group is shared", () => {
    const result = calculateVerification(event, [
      { source: source(1, 0.8, "primary_source"), rawPost: raw(1, "خبر اصلی"), originGroup: "origin:a", originType: "original_reporting" },
      { source: source(2, 0.8, "authority_confirmation"), rawPost: raw(2, "خبر کپی"), originGroup: "origin:a", originType: "wire_republish" }
    ]);
    expect(result.independentConfirmations).toBe(1);
    expect(result.status).toBe("DEVELOPING");
  });

  it("confirms two credible independent origin groups", () => {
    const result = calculateVerification(event, [
      { source: source(1, 0.8, "primary_source"), rawPost: raw(1, "خبر اصلی"), originGroup: "origin:a", originType: "original_reporting" },
      { source: source(2, 0.8, "primary_source"), rawPost: raw(2, "گزارش مستقل"), originGroup: "origin:b", originType: "original_reporting" }
    ]);
    expect(result.independentConfirmations).toBe(2);
    expect(result.status).toBe("CONFIRMED");
  });

  it("normalizes cited and forwarded origins instead of counting the republisher", () => {
    expect(originGroupFor(source(2, 0.8, "authority_confirmation"), raw(2, "به نقل از رویترز", JSON.stringify({ cited_source: "Reuters" })))).toBe("origin:reuters");
    expect(originGroupFor(source(3, 0.8, "authority_confirmation"), raw(3, "فوروارد", JSON.stringify({ forwarded_from: "@irna_1313" })))).toBe("origin:irna");
  });
});
