import { describe, expect, it } from "vitest";
import { authenticateDashboardLogin, isDashboardSession, logoutDashboard } from "../src/auth";

const env = {
  RADAR_DASHBOARD_USERNAME: "radar-operator",
  RADAR_DASHBOARD_PASSWORD: "a-long-local-test-password-9f7c"
} as Env;

describe("dashboard authentication", () => {
  it("creates and validates an HttpOnly session cookie", async () => {
    const form = new URLSearchParams({ username: "radar-operator", password: "a-long-local-test-password-9f7c" });
    const response = await authenticateDashboardLogin(new Request("https://radar.test/admin/api/login", { method: "POST", body: form }), env);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    expect(await isDashboardSession(new Request("https://radar.test/admin/api/overview", { headers: { cookie: cookie ?? "" } }), env)).toBe(true);
  });

  it("rejects invalid credentials and clears sessions on logout", async () => {
    const form = new URLSearchParams({ username: "radar-operator", password: "wrong" });
    const response = await authenticateDashboardLogin(new Request("https://radar.test/admin/api/login", { method: "POST", body: form }), env);
    expect(response.status).toBe(401);
    expect(logoutDashboard().headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
