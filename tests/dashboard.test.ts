import { describe, expect, it } from "vitest";
import { dashboardResponse } from "../src/dashboard";

describe("dashboard surface", () => {
  it("returns a non-cacheable protected console shell", async () => {
    const response = dashboardResponse();
    const html = await response.text();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).toContain("رادار / اتاق عملیات");
    expect(html).toContain("setInterval(loadSnapshot, 60000)");
    expect(html).toContain('href="/admin/news"');
    expect(html).toContain('href="/admin/events"');
    expect(html).toContain('href="/admin/sources"');
    expect(html).toContain('href="/admin/publish"');
    expect(html).toContain('href="/admin/system"');
    expect(html).toContain('class="nav-glyph"');
    expect(html).toContain('class="nav-surface"');
    expect(html).toContain(".nav-link.active .nav-surface");
    expect(html).toContain('id="publishing-toggle"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("/admin/api/actions/set-publishing");
    expect(html).toContain("انتشار تلگرام روشن شود؟");
    expect(html).toContain("history.pushState");
    expect(html).toContain("aej4FOV7nKCWdXvwA03Yb9TX2i40Gw7yNtgknEQAPWJhYCO8");
    expect(html).toContain("aej4FOV7nKCWkhCK7UBlTIYdxai4rQEHcnsA2U9h6GjuS0OK");
    expect(html).toContain("font-family: \"RadarPersian\"");
    expect(html).toContain("--accent: #91a8ff");
    expect(html).not.toContain('font-family: "Inter"');
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("#d5ff3f");
  });
});
