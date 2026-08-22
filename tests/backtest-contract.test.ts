import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const backtestSource = readFileSync(resolve(process.cwd(), "scripts/v8-backtest.mjs"), "utf8");
const pipelineSource = readFileSync(resolve(process.cwd(), "src/intelligence/pipeline.ts"), "utf8");
const wranglerSource = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/fixtures/v8-baseline-500.json"), "utf8")) as { post_ids: number[]; windows: Array<{ window_end: string; post_ids: number[] }> };

describe("V8 backtest contract", () => {
  it("pins the historical baseline by deterministic date bounds", () => {
    expect(backtestSource).toContain('const SAMPLE = process.env.RADAR_BACKTEST_SAMPLE || "latest-v8-500";');
    expect(backtestSource).toContain('SAMPLE === "baseline-v8-500"');
    expect(backtestSource).toContain('2026-08-13T20:37:52.000Z');
    expect(backtestSource).toContain('2026-08-14T07:55:01.000Z');
  });

  it("persists exactly 500 unique baseline IDs and window membership", () => {
    expect(manifest.post_ids).toHaveLength(500);
    expect(new Set(manifest.post_ids).size).toBe(500);
    expect(manifest.windows.length).toBe(129);
    expect(manifest.windows.flatMap((window) => window.post_ids)).toHaveLength(500);
  });

  it("uses the canonical manifest and historical event eligibility", () => {
    expect(backtestSource).toContain("v8-baseline-500.json");
    expect(backtestSource).toContain("firstSeenMs <= windowEndMs");
    expect(backtestSource).toContain("lastUpdatedMs >= windowEndMs - 48 * 60 * 60 * 1_000");
    expect(backtestSource).not.toContain("datetime('now', '-48 hours')");
    expect(backtestSource).toContain("failed_batch_forensics");
    expect(backtestSource).toContain("queue_equivalent_replay");
    expect(backtestSource).toContain("second_pass_cases");
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
    expect(backtestSource).toContain('high-density-cap-${cap}.json');
    expect(backtestSource).toContain('measured_high_density_payload');
    expect(backtestSource).not.toContain('const targetScale = reports.length > 0 ? 341 / reports.length : null;');
    expect(backtestSource).not.toContain('successful backtest token telemetry divided by reports represented');
  });

  it("reports bounded recovery separately from raw gateway reliability", () => {
    expect(backtestSource).toContain("initial_logical_requests");
    expect(backtestSource).toContain("transient_retry_calls");
    expect(backtestSource).toContain("contract_correction_calls");
    expect(backtestSource).toContain("final_logical_batches_successful");
    expect(backtestSource).toContain("end_to_end_latency_samples");
  });

  it("keeps D1 application after final current-window validation", () => {
    expect(pipelineSource.indexOf("const validatedDecisions = validateIntelligenceDecisions")).toBeGreaterThan(-1);
    expect(pipelineSource.indexOf("const outcome = await applyBatchDecisions")).toBeGreaterThan(-1);
    expect(pipelineSource.indexOf("const validatedDecisions = validateIntelligenceDecisions")).toBeLessThan(pipelineSource.indexOf("const outcome = await applyBatchDecisions"));
  });

  it("keeps the bounded Queue retry safety net unchanged", () => {
    expect(wranglerSource).toContain('"max_retries": 3');
  });
});
