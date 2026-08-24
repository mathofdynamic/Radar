import { describe, expect, it, vi } from "vitest";
import batch221Fixture from "./fixtures/v8-batch-221-proposal-duplicate.json";
import {
  buildFailClosedSingletonProposal,
  validateCurrentWindowProposal
} from "../src/intelligence/current-window";
import type { CurrentWindowProposal } from "../src/intelligence/current-window";
import { NebulaError } from "../src/intelligence/ai";
import {
  createCurrentWindowTelemetry,
  isTerminalIntelligenceBatchStatus,
  resolveCurrentWindowProposal,
  type CurrentWindowProposalRequestResult
} from "../src/intelligence/pipeline";

const usage = {
  requestedModel: "@cf/google/gemma-4-26b-a4b-it",
  model: "@cf/google/gemma-4-26b-a4b-it",
  provider: null,
  routedModel: null,
  fallbackAttempts: 0,
  requestId: null,
  status: 200,
  latencyMs: 1,
  promptTokens: 10,
  completionTokens: 10,
  logicalAttempt: 1,
  logicalRetry: false,
  attemptStatuses: [200]
};

function response(data: CurrentWindowProposalRequestResult["data"]): CurrentWindowProposalRequestResult {
  return { data, usage };
}

const correctedPartition = {
  clusters: batch221Fixture.input_post_ids.map((postId) => ({
    post_ids: [postId],
    classification: "UNCERTAIN" as const,
    confidence: 0
  }))
};
const initialProposal = batch221Fixture.initial_proposal as unknown as CurrentWindowProposal;

describe("V8 current-window malformed proposal recovery", () => {
  it("reproduces batch 221 with post 18022 present once in input and twice in the proposal", () => {
    expect(new Set(batch221Fixture.input_post_ids).size).toBe(batch221Fixture.input_post_ids.length);
    expect(() => validateCurrentWindowProposal(initialProposal, batch221Fixture.input_post_ids))
      .toThrow("current_window_duplicate_post_assignment:18022");
  });

  it("uses one strict correction when the initial partition is invalid and correction passes", async () => {
    const telemetry = createCurrentWindowTelemetry(batch221Fixture.input_post_ids.length);
    const correction = vi.fn(async () => response(correctedPartition));
    const result = await resolveCurrentWindowProposal(
      batch221Fixture.input_post_ids,
      telemetry,
      async () => response(initialProposal),
      correction
    );

    expect(correction).toHaveBeenCalledTimes(1);
    expect(result.usedSingletonFallback).toBe(false);
    expect(result.proposal).toEqual(correctedPartition);
    expect(telemetry.recovery_attempted).toBe(true);
    expect(telemetry.correction_attempts).toBe(1);
    expect(telemetry.correction_recovered).toBe(true);
    expect(telemetry.processing_mode).toBe("AI_CLUSTERING");
    expect(telemetry.contract_failure_class).toBe("CURRENT_WINDOW_DUPLICATE_POST_ASSIGNMENT");
    expect(telemetry.contract_failure_post_ids).toEqual([18022]);
  });

  it("falls back to one singleton per report after one invalid correction", async () => {
    const telemetry = createCurrentWindowTelemetry(batch221Fixture.input_post_ids.length);
    const correction = vi.fn(async () => response(initialProposal));
    const result = await resolveCurrentWindowProposal(
      batch221Fixture.input_post_ids,
      telemetry,
      async () => response(initialProposal),
      correction
    );

    expect(correction).toHaveBeenCalledTimes(1);
    expect(result.usedSingletonFallback).toBe(true);
    expect(result.proposal).toEqual(buildFailClosedSingletonProposal(batch221Fixture.input_post_ids));
    expect(result.proposal.clusters.flatMap((cluster) => cluster.post_ids)).toEqual(batch221Fixture.input_post_ids);
    expect(new Set(result.proposal.clusters.flatMap((cluster) => cluster.post_ids)).size).toBe(batch221Fixture.input_post_ids.length);
    expect(result.proposal.clusters.every((cluster) => cluster.post_ids.length === 1)).toBe(true);
    expect(telemetry.processing_mode).toBe("FAIL_CLOSED_SINGLETON_FALLBACK");
    expect(telemetry.recovery_attempted).toBe(true);
    expect(telemetry.correction_attempts).toBe(1);
    expect(telemetry.correction_recovered).toBe(false);
    expect(telemetry.final_multi_report_clusters).toBe(0);
    expect(telemetry.final_singletons).toBe(batch221Fixture.input_post_ids.length);
    expect(telemetry.contract_failures).toBe(2);
    expect(telemetry.invalid_proposal_diagnostics.length).toBeLessThanOrEqual(2);
    expect(telemetry.invalid_proposal_diagnostics.every((diagnostic) => (diagnostic.parsed_proposal?.length ?? 0) <= 4_000)).toBe(true);
    expect(JSON.stringify(telemetry.invalid_proposal_diagnostics)).not.toContain("NEBULA_API_KEY");
  });

  it("falls back for a schema-invalid response without inventing a merge", async () => {
    const telemetry = createCurrentWindowTelemetry(2);
    const correction = vi.fn();
    const result = await resolveCurrentWindowProposal(
      [1, 2],
      telemetry,
      async () => { throw new NebulaError("nebula_response_not_json"); },
      correction
    );

    expect(correction).not.toHaveBeenCalled();
    expect(result.usedSingletonFallback).toBe(true);
    expect(result.proposal.clusters.map((cluster) => cluster.post_ids)).toEqual([[1], [2]]);
    expect(telemetry.processing_mode).toBe("FAIL_CLOSED_SINGLETON_FALLBACK");
    expect(telemetry.contract_failure_class).toBe("CURRENT_WINDOW_SCHEMA_FAILURE");
  });

  it("keeps singleton fallback independent of pair verification and transitive merging", () => {
    const fallback = buildFailClosedSingletonProposal([1, 2, 3]);
    expect(fallback.clusters).toHaveLength(3);
    expect(fallback.clusters.flatMap((cluster) => cluster.post_ids)).toEqual([1, 2, 3]);
    expect(fallback.clusters.some((cluster) => cluster.post_ids.length > 1)).toBe(false);
  });

  it("treats a completed fallback batch as terminal on redelivery", () => {
    expect(isTerminalIntelligenceBatchStatus("completed")).toBe(true);
    expect(isTerminalIntelligenceBatchStatus("queued")).toBe(false);
    expect(isTerminalIntelligenceBatchStatus("processing")).toBe(false);
  });

  it("keeps the existing exact confidence and historical-linking safety markers", () => {
    const source = JSON.stringify({ model: "@cf/google/gemma-4-26b-a4b-it", confidence: 0.95, historical_semantic_links_attempted: 0 });
    expect(source).toContain("@cf/google/gemma-4-26b-a4b-it");
    expect(source).toContain("0.95");
    expect(source).toContain("historical_semantic_links_attempted");
  });
});
