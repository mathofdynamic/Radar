import { describe, expect, it } from "vitest";
import { parseTelegramPublicPage } from "../src/polling/parser";

describe("Telegram public page parser", () => {
  it("extracts bounded message records and canonical links", async () => {
    const html = `<div class="tgme_widget_message_wrap" data-post="example/42"><div class="tgme_widget_message_text">خبر مهم درباره ایران &amp; بازار</div><time datetime="2026-08-08T10:00:00+00:00">10:00</time></div><div class="tgme_widget_message_wrap" data-post="example/43"><div class="tgme_widget_message_text">گزارش دوم<br>با جزئیات</div><time datetime="2026-08-08T10:05:00+00:00">10:05</time></div>`;
    const result = await parseTelegramPublicPage(html, 1, "example", "example");
    expect(result.warnings).toEqual([]);
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].canonicalUrl).toBe("https://t.me/example/42");
    expect(result.posts[0].text).toContain("ایران & بازار");
  });

  it("rejects an unrecognized page as a parser warning", async () => {
    const result = await parseTelegramPublicPage("<html>blocked</html>", 1, "example", "example");
    expect(result.posts).toHaveLength(0);
    expect(result.warnings).toContain("not_a_telegram_public_page");
  });
});
