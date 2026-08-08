import { describe, expect, it } from "vitest";
import { combinedSimilarity, cosineSimilarity, extractEntityKeys, inferCategory } from "../src/intelligence/similarity";

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
});
