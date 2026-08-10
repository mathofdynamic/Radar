import { describe, expect, it } from "vitest";
import { isPersianStory } from "../src/editorial/story";

describe("story language gate", () => {
  it("accepts Persian title and description", () => {
    expect(isPersianStory({
      title: "وزیر دفاع ایران بر نقش رسانه‌ها در بازدارندگی تأکید کرد",
      description: "وزیر دفاع گفت رسانه‌ها علاوه بر گزارش دستاوردها، در تقویت قدرت ملی و دفاع صنعتی نقش دارند."
    })).toBe(true);
  });

  it("rejects an English story before publication", () => {
    expect(isPersianStory({
      title: "Iran's Defense Minister Says Media Plays Key Role",
      description: "The defense minister emphasized the importance of the media in the country's deterrence system."
    })).toBe(false);
  });

  it("allows necessary Latin names inside a Persian story", () => {
    expect(isPersianStory({
      title: "پزشکان دربارهٔ تصمیم جدید Farsna توضیح دادند",
      description: "پزشکان گفتند تصمیم جدید پس از بررسی‌های تخصصی و با هدف افزایش ایمنی اجرا می‌شود."
    })).toBe(true);
  });
});
