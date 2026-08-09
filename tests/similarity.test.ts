import { describe, expect, it } from "vitest";
import { combinedSimilarity, cosineSimilarity, extractEntityKeys, inferCategory, semanticEventScore } from "../src/intelligence/similarity";

describe("event similarity utilities", () => {
  it("calculates cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("identifies event category and entities", () => {
    expect(inferCategory("حمله موشکی به اسرائیل", "IRAN")).toBe("WAR_SECURITY");
    expect(extractEntityKeys("ایران و OpenAI درباره اینترنت")).toEqual(expect.arrayContaining(["iran", "openai", "internet"]));
  });

  it("keeps similar reports above unrelated reports", () => {
    expect(combinedSimilarity("ایران بازار ارز را بررسی کرد", "بازار ارز ایران بررسی شد", 1)).toBeGreaterThan(combinedSimilarity("ایران بازار ارز را بررسی کرد", "مسابقه فوتبال فردا برگزار می‌شود", 1));
  });

  it("lets semantic similarity connect differently worded reports", () => {
    const sameEvent = semanticEventScore(0.91, "ایران حمله موشکی جدیدی را آغاز کرد", "منابع از شلیک چندین موشک از خاک ایران خبر می‌دهند", 0.95);
    const unrelated = semanticEventScore(0.31, "ایران حمله موشکی جدیدی را آغاز کرد", "قیمت طلا در بازار کاهش یافت", 0.95);
    expect(sameEvent).toBeGreaterThanOrEqual(0.66);
    expect(sameEvent).toBeGreaterThan(unrelated);
  });
});
