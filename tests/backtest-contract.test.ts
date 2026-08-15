import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backtestSource = readFileSync(resolve(process.cwd(), "scripts/v8-backtest.mjs"), "utf8");

describe("V8 backtest contract", () => {
  it("pins the historical baseline by deterministic date bounds", () => {
    expect(backtestSource).toContain('const SAMPLE = process.env.RADAR_BACKTEST_SAMPLE || "latest-v8-500";');
    expect(backtestSource).toContain('SAMPLE === "baseline-v8-500"');
    expect(backtestSource).toContain('2026-08-13T20:37:52.000Z');
    expect(backtestSource).toContain('2026-08-14T07:55:01.000Z');
  });

  it("uses radar-fast and the shared strict JSON Schema", () => {
    expect(backtestSource).toContain('model: "radar-fast"');
    expect(backtestSource).toContain('type: "json_schema"');
    expect(backtestSource).toContain('import intelligenceBatchJsonSchema');
  });

  it("projects target traffic by five-minute windows instead of low-traffic sample density", () => {
    expect(backtestSource).toContain('const reportsPerHour = 341;');
    expect(backtestSource).toContain('const windowsPerHour = 12;');
    expect(backtestSource).toContain('const reportsPerWindow = reportsPerHour / windowsPerHour;');
    expect(backtestSource).toContain('payloadReportCapacity');
    expect(backtestSource).not.toContain('const targetScale = reports.length > 0 ? 341 / reports.length : null;');
  });
});
