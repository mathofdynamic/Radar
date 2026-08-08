import { describe, expect, it } from "vitest";
import { lexicalOverlap, normalizePersianText } from "../src/normalization";

describe("Persian normalization", () => {
  it("normalizes Arabic variants without destroying text", () => {
    const result = normalizePersianText("خبر درباره يک بازار مهم و تازه");
    expect(result.normalizedText).toContain("یک");
    expect(result.isNoise).toBe(false);
  });

  it("flags obvious promotional text conservatively", () => {
    const result = normalizePersianText("برای تبلیغات و عضویت در کانال ما را دنبال کنید");
    expect(result.isNoise).toBe(true);
    expect(result.noiseReason).toBe("promotion_or_advertisement");
  });

  it("calculates lexical overlap", () => {
    expect(lexicalOverlap("ایران در بازار مهم", "بازار مهم ایران امروز")).toBeGreaterThan(0.5);
  });
});
