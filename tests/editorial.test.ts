import { describe, expect, it } from "vitest";
import { scoreEvent, shouldPublish } from "../src/editorial/scoring";
import { buildReplyMarkup, formatCaption } from "../src/publisher/telegram";
import type { EventRow } from "../src/types";

const baseEvent = (overrides: Partial<EventRow> = {}): EventRow => ({
  id: 1, canonical_title: null, core_fact: "گزارش مهم درباره ایران", claims_json: "{}", category: "WAR_SECURITY", verification_status: "CONFIRMED", importance_score: 0, confidence_score: 0, novelty_score: 0, iran_relevance_score: 0, impact_score: 0, urgency_score: 0, geopolitical_score: 0, subscores_json: "{}", first_seen_at: new Date().toISOString(), last_updated_at: new Date().toISOString(), event_state: "active", event_version: 1, source_count: 2, independent_confirmation_count: 2, ...overrides
});

describe("editorial engine", () => {
  it("scores a confirmed security event as a candidate", () => {
    const score = scoreEvent(baseEvent());
    expect(score.finalScore).toBeGreaterThanOrEqual(78);
    expect(score.band).toBe("CANDIDATE");
  });

  it("blocks unverified automatic publication", () => {
    const event = baseEvent({ verification_status: "UNVERIFIED", independent_confirmation_count: 0 });
    expect(shouldPublish(event, scoreEvent(event), true, 0, { editorialMinScore: 78, breakingScore: 90, dailyStoryBudget: 15, busyDayStoryBudget: 25 })).toBe(false);
  });

  it("formats a Telegram caption with escaped HTML", () => {
    const caption = formatCaption({ eventId: 1, eventVersion: 1, title: "<خبر>", description: "شرح", verificationStatus: "CONFIRMED", independentConfirmations: 2, primarySources: [], category: "IRAN", tags: ["ایران"], links: [{ label: "منبع", url: "https://t.me/a/1" }], coverConcept: "symbolic" });
    expect(caption).toContain("&lt;خبر&gt;");
    expect(caption).toContain("#ایران");
  });

  it("does not repeat a duplicated title or metadata in the caption", () => {
    const caption = formatCaption({ eventId: 1, eventVersion: 1, title: "خبر مهم", description: "خبر مهم\nوضعیت: تأییدشده | تأیید مستقل: 2", verificationStatus: "CONFIRMED", independentConfirmations: 2, primarySources: [], category: "IRAN", tags: [], links: [], coverConcept: "symbolic" });
    expect(caption.match(/خبر مهم/gu)?.length).toBe(1);
    expect(caption).not.toContain("CONFIRMED");
    expect(caption).toContain("تأیید مستقل: ۲");
  });

  it("places source buttons in compact rows and removes duplicate URLs", () => {
    const markup = buildReplyMarkup({ eventId: 1, eventVersion: 1, title: "خبر", description: "شرح", verificationStatus: "CONFIRMED", independentConfirmations: 1, primarySources: [], category: "IRAN", tags: [], links: [
      { label: "منبع اول", url: "https://t.me/a/1" },
      { label: "منبع دوم", url: "https://t.me/b/2" },
      { label: "تکراری", url: "https://t.me/a/1" },
      { label: "منبع سوم", url: "https://t.me/c/3" }
    ], coverConcept: "symbolic" });
    expect(markup.inline_keyboard).toEqual([
      [{ text: "منبع اول", url: "https://t.me/a/1" }, { text: "منبع دوم", url: "https://t.me/b/2" }],
      [{ text: "منبع سوم", url: "https://t.me/c/3" }]
    ]);
  });
});
