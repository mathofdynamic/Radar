import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backtestSource = readFileSync(resolve(process.cwd(), "scripts/v8-backtest.mjs"), "utf8");
const pipelineSource = readFileSync(resolve(process.cwd(), "src/intelligence/pipeline.ts"), "utf8");
const wranglerSource = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");

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
    expect(backtestSource).toContain("scopeIntelligenceBatchJsonSchema");
    expect(backtestSource).toContain("expectedPostIds");
    expect(backtestSource).toContain("duplicateTargetPostIds");
    expect(backtestSource).toContain("fetchNebulaResponse");
    expect(backtestSource).toContain("controller.abort()");
  });

  it("projects target traffic by five-minute windows instead of low-traffic sample density", () => {
    expect(backtestSource).toContain('const reportsPerHour = 341;');
    expect(backtestSource).toContain('const windowsPerHour = 12;');
    expect(backtestSource).toContain('const reportsPerWindow = reportsPerHour / windowsPerHour;');
    expect(backtestSource).toContain('payloadReportCapacity');
    expect(backtestSource).not.toContain('const targetScale = reports.length > 0 ? 341 / reports.length : null;');
  });

  it("reports bounded recovery separately from raw gateway reliability", () => {
    expect(backtestSource).toContain("initial_logical_requests");
    expect(backtestSource).toContain("transient_retry_calls");
    expect(backtestSource).toContain("contract_correction_calls");
    expect(backtestSource).toContain("final_logical_batches_successful");
    expect(backtestSource).toContain("end_to_end_latency_samples");
  });

  it("keeps D1 application after final deterministic validation", () => {
    expect(pipelineSource.indexOf("const finalValidation = await validateDecisionSetWithCorrection")).toBeGreaterThan(-1);
    expect(pipelineSource.indexOf("const outcome = await applyBatchDecisions")).toBeGreaterThan(-1);
    expect(pipelineSource.indexOf("const finalValidation = await validateDecisionSetWithCorrection")).toBeLessThan(pipelineSource.indexOf("const outcome = await applyBatchDecisions"));
  });

  it("keeps the bounded Queue retry safety net unchanged", () => {
    expect(wranglerSource).toContain('"max_retries": 3');
  });
});
