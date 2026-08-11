import { describe, expect, it } from "vitest";
import { getEmbeddingCheckpoint, saveEmbeddingCheckpoint } from "../src/db";
import {
  isReusableEmbeddingCheckpoint,
  isStaleAnalysisLease,
  shouldApplyEventVersion,
  shouldSkipAnalyzedPost
} from "../src/intelligence/analysis-state";
import type { EmbeddingCheckpointRow } from "../src/types";

class CheckpointDb {
  private checkpoint: EmbeddingCheckpointRow | null = null;

  prepare(sql: string): D1PreparedStatement {
    const database = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (!sql.includes("FROM embedding_checkpoints")) return null;
            const [rawPostId, contentHash, embeddingModel] = args as [number, string, string];
            const row = database.checkpoint;
            return row
              && row.raw_post_id === rawPostId
              && row.content_hash === contentHash
              && row.embedding_model === embeddingModel
              ? row as T
              : null;
          },
          async run(): Promise<D1Result<unknown>> {
            if (sql.includes("INSERT INTO embedding_checkpoints")) {
              const [rawPostId, contentHash, embeddingModel, vectorJson, state, embeddedAt, updatedAt] = args as [number, string, string, string | null, "ready" | "deferred", string | null, string];
              database.checkpoint = { raw_post_id: rawPostId, content_hash: contentHash, embedding_model: embeddingModel, vector_json: vectorJson, embedding_state: state, embedded_at: embeddedAt, updated_at: updatedAt };
              return { success: true, meta: { changes: 1 } } as D1Result<unknown>;
            }
            return { success: true, meta: { changes: 0 } } as D1Result<unknown>;
          }
        } as unknown as D1PreparedStatement;
      }
    } as unknown as D1PreparedStatement;
  }
}

describe("V6 analysis idempotency", () => {
  it("stores one durable embedding and reuses it after a downstream retry", async () => {
    const db = new CheckpointDb() as unknown as D1Database;
    const contentHash = "content-a";
    const model = "@cf/baai/bge-m3";
    let embeddingCalls = 0;

    const prepareOrReuse = async (): Promise<number[]> => {
      const checkpoint = await getEmbeddingCheckpoint(db, 7, contentHash, model);
      if (isReusableEmbeddingCheckpoint(checkpoint, contentHash, model)) return JSON.parse(checkpoint.vector_json as string) as number[];
      embeddingCalls += 1;
      const vector = [0.1, 0.2, 0.3];
      await saveEmbeddingCheckpoint(db, {
        raw_post_id: 7,
        content_hash: contentHash,
        embedding_model: model,
        vector_json: JSON.stringify(vector),
        embedding_state: "ready",
        embedded_at: new Date().toISOString()
      });
      return vector;
    };

    expect(await prepareOrReuse()).toEqual([0.1, 0.2, 0.3]);
    // Simulate Vectorize/event finalization failing before the Queue job ends.
    expect(await prepareOrReuse()).toEqual([0.1, 0.2, 0.3]);
    expect(embeddingCalls).toBe(1);
  });

  it("invalidates a checkpoint when normalized content or model changes", async () => {
    const checkpoint: EmbeddingCheckpointRow = {
      raw_post_id: 7,
      content_hash: "content-a",
      embedding_model: "model-a",
      vector_json: "[0.1,0.2]",
      embedding_state: "ready",
      embedded_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    expect(isReusableEmbeddingCheckpoint(checkpoint, "content-a", "model-a")).toBe(true);
    expect(isReusableEmbeddingCheckpoint(checkpoint, "content-b", "model-a")).toBe(false);
    expect(isReusableEmbeddingCheckpoint(checkpoint, "content-a", "model-b")).toBe(false);
  });

  it("applies event version advancement once even when evidence insertion is retried", () => {
    let eventVersion = 4;
    let eventSourceRows = 0;
    let versionMarker = 0;
    const finalizeEvidence = () => {
      if (eventSourceRows === 0) eventSourceRows = 1;
      if (shouldApplyEventVersion(versionMarker)) {
        eventVersion += 1;
        versionMarker = 2;
      }
    };

    finalizeEvidence();
    finalizeEvidence();
    expect(eventSourceRows).toBe(1);
    expect(eventVersion).toBe(5);
    expect(versionMarker).toBe(2);
  });

  it("no-ops already analyzed posts and only recovers stale leases", () => {
    expect(shouldSkipAnalyzedPost("analyzed")).toBe(true);
    expect(shouldSkipAnalyzedPost("processing")).toBe(false);
    const now = "2026-08-11T12:00:00.000Z";
    expect(isStaleAnalysisLease("2026-08-11T11:55:00.000Z", now)).toBe(false);
    expect(isStaleAnalysisLease("2026-08-11T11:40:00.000Z", now)).toBe(true);
    expect(isStaleAnalysisLease(null, now)).toBe(true);
  });
});
