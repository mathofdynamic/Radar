import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acceptsCurrentWindowPair,
  currentWindowPairOutputSchema,
  currentWindowProposalJsonSchema,
  reconstructCurrentWindowClusters,
  validateCurrentWindowPair,
  validateCurrentWindowProposal
} from "../src/intelligence/current-window";
import { assertCurrentWindowConfiguration, assertHistoricalSemanticLinkingDisabled, runtimeConfig, V8_CURRENT_WINDOW_MODEL } from "../src/config";

const event = (postIds: number[], confidence = 0.99) => ({
  post_ids: postIds,
  classification: "EVENT" as const,
  confidence
});

const same = (leftPostId: number, rightPostId: number, confidence = 0.99) => ({
  leftPostId,
  rightPostId,
  result: { relationship: "SAME_EVENT" as const, confidence }
});

describe("V8 current-window proposal and pair contracts", () => {
  it("accepts a SAME_EVENT pair at the 0.95 boundary", () => {
    expect(acceptsCurrentWindowPair({ relationship: "SAME_EVENT", confidence: 0.95 })).toBe(true);
    expect(acceptsCurrentWindowPair({ relationship: "SAME_EVENT", confidence: 0.949 })).toBe(false);
    expect(acceptsCurrentWindowPair({ relationship: "DIFFERENT_EVENT", confidence: 1 })).toBe(false);
  });

  it("fails closed when pair verification is unavailable", () => {
    const clusters = reconstructCurrentWindowClusters(
      { clusters: [event([8445, 8448])] },
      [{ leftPostId: 8445, rightPostId: 8448, result: null }]
    );
    expect(clusters.map((cluster) => cluster.postIds)).toEqual([[8445], [8448]]);
  });

  it("reconstructs the 8441/8447/8456 star around anchor 8447", () => {
    const clusters = reconstructCurrentWindowClusters(
      { clusters: [event([8441, 8447, 8456])] },
      [same(8441, 8447, 0.99), same(8447, 8456, 0.98), { leftPostId: 8441, rightPostId: 8456, result: { relationship: "DIFFERENT_EVENT", confidence: 0.99 } }]
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.postIds).toEqual([8441, 8447, 8456]);
    expect(clusters[0]?.anchorPostId).toBe(8447);
  });

  it("does not merge a transitive-only tail without one anchor edge", () => {
    const clusters = reconstructCurrentWindowClusters(
      { clusters: [event([1, 2, 3, 4])] },
      [same(1, 2), same(2, 3), same(3, 4)]
    );
    expect(clusters.map((cluster) => cluster.postIds)).toEqual([[1, 2, 3], [4]]);
  });

  it("rejects unknown and duplicate proposal assignments", () => {
    expect(() => validateCurrentWindowProposal({ clusters: [event([1, 999])] }, [1, 2])).toThrow("current_window_unknown_post_id");
    expect(() => validateCurrentWindowProposal({ clusters: [event([1]), event([1, 2])] }, [1, 2])).toThrow("current_window_duplicate_post_assignment");
    expect(() => validateCurrentWindowProposal({ clusters: [event([1])] }, [1, 2])).toThrow("current_window_missing_post_assignment");
  });

  it("rejects malformed proposal and pair output", () => {
    expect(() => validateCurrentWindowProposal({ clusters: [{ post_ids: [1], classification: "EVENT", confidence: 2 }] }, [1])).toThrow("current_window_proposal_invalid");
    expect(() => validateCurrentWindowPair({ relationship: "SAME_EVENT", confidence: 0.9, extra: true })).toThrow("current_window_pair_invalid");
    expect(currentWindowPairOutputSchema.safeParse({ relationship: "DIFFERENT_EVENT", confidence: 0.9 }).success).toBe(true);
  });

  it("keeps the provider contract historical-free and the flag disabled by default", () => {
    const schema = JSON.stringify(currentWindowProposalJsonSchema([1, 2]));
    expect(schema).not.toContain("event_id");
    expect(schema).not.toContain("historical");
    expect(runtimeConfig({ V8_HISTORICAL_SEMANTIC_LINKING_ENABLED: "false" } as unknown as Env).v8HistoricalSemanticLinkingEnabled).toBe(false);
  });

  it("fails closed when the unsupported historical linker is explicitly requested", () => {
    const config = runtimeConfig({ V8_HISTORICAL_SEMANTIC_LINKING_ENABLED: "true" } as unknown as Env);
    expect(() => assertHistoricalSemanticLinkingDisabled(config)).toThrow("historical_semantic_linking_unsupported");
  });

  it("requires the qualified exact Gemma route", () => {
    const config = runtimeConfig({ NEBULA_INTELLIGENCE_MODEL: V8_CURRENT_WINDOW_MODEL } as unknown as Env);
    expect(() => assertCurrentWindowConfiguration(config)).not.toThrow();
    const wrongModel = runtimeConfig({ NEBULA_INTELLIGENCE_MODEL: "auto" } as unknown as Env);
    expect(() => assertCurrentWindowConfiguration(wrongModel)).toThrow("v8_current_window_model_unsupported");
  });

  it("does not expose the removed historical decision path or enable publishing", () => {
    const pipelineSource = readFileSync(resolve(process.cwd(), "src/intelligence/pipeline.ts"), "utf8");
    const wranglerSource = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    expect(pipelineSource).not.toContain("listActiveEvents");
    expect(pipelineSource).not.toContain("active_events");
    expect(pipelineSource).not.toContain("requestBatchDecisions");
    expect(pipelineSource).toContain("historical_semantic_linking_unsupported");
    expect(wranglerSource).toContain('"PUBLISH_ENABLED": "false"');
  });
});
