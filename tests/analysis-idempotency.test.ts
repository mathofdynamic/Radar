import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  floorFiveMinuteWindow,
  isStaleAnalysisLease,
  normalizeLegacyAnalysisStatus,
  shouldSkipAnalyzedPost
} from "../src/intelligence/analysis-state";
import { getEventByOriginatingRawPostId } from "../src/db";

describe("V8 analysis idempotency", () => {
  it("recovers an event row left behind before its source evidence was attached", async () => {
    const event = { id: 42, originating_raw_post_id: 7 };
    const db = {
      prepare(sql: string) {
        expect(sql).toContain("originating_raw_post_id");
        return {
          bind(rawPostId: number) {
            expect(rawPostId).toBe(7);
            return { first: async () => event };
          }
        };
      }
    } as unknown as D1Database;

    await expect(getEventByOriginatingRawPostId(db, 7)).resolves.toEqual(event);
  });

  it("normalizes unfinished V6 states into recoverable pending work", () => {
    expect(normalizeLegacyAnalysisStatus("embedding")).toBe("pending");
    expect(normalizeLegacyAnalysisStatus("embedded")).toBe("pending");
    expect(normalizeLegacyAnalysisStatus("processing")).toBe("pending");
    expect(normalizeLegacyAnalysisStatus("analyzed")).toBe("analyzed");
  });

  it("keeps analyzed and noise rows terminal", () => {
    expect(shouldSkipAnalyzedPost("analyzed")).toBe(true);
    expect(shouldSkipAnalyzedPost("noise")).toBe(true);
    expect(shouldSkipAnalyzedPost("analyzing")).toBe(false);
  });

  it("only recovers stale leases", () => {
    const now = "2026-08-11T12:00:00.000Z";
    expect(isStaleAnalysisLease("2026-08-11T11:55:00.000Z", now)).toBe(false);
    expect(isStaleAnalysisLease("2026-08-11T11:40:00.000Z", now)).toBe(true);
    expect(isStaleAnalysisLease(null, now)).toBe(true);
  });

  it("creates deterministic five-minute windows", () => {
    expect(floorFiveMinuteWindow("2026-08-14T00:07:32.000Z")).toEqual({
      start: "2026-08-14T00:00:00.000Z",
      end: "2026-08-14T00:05:00.000Z"
    });
  });
});

describe("V6.1 event-origin conflict target retained by V8", () => {
  it("keeps event creation and evidence insertion idempotent", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          core_fact TEXT NOT NULL,
          category TEXT NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_updated_at TEXT NOT NULL,
          originating_raw_post_id INTEGER,
          event_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE event_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id INTEGER NOT NULL,
          raw_post_id INTEGER NOT NULL,
          UNIQUE(event_id, raw_post_id)
        );
        CREATE UNIQUE INDEX idx_events_originating_raw_post
          ON events(originating_raw_post_id)
          WHERE originating_raw_post_id IS NOT NULL;
      `);

      const insertSql = `
        INSERT INTO events(core_fact, category, first_seen_at, last_updated_at, originating_raw_post_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(originating_raw_post_id) DO NOTHING
      `;
      expect(() => db.prepare(insertSql).run("fact", "IRAN", "now", "now", 7, "now", "now"))
        .toThrow(/ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint/);

      db.exec(readFileSync(resolve(process.cwd(), "migrations/0007_fix_event_origin_unique_index.sql"), "utf8"));
      const insert = db.prepare(insertSql);
      insert.run("fact", "IRAN", "now", "now", 7, "now", "now");
      insert.run("changed text", "IRAN", "later", "later", 7, "later", "later");

      expect(db.prepare("SELECT COUNT(*) AS count FROM events WHERE originating_raw_post_id = ?").get(7)).toMatchObject({ count: 1 });
      const evidence = db.prepare("INSERT INTO event_sources(event_id, raw_post_id) VALUES (?, ?) ON CONFLICT(event_id, raw_post_id) DO NOTHING");
      evidence.run(1, 7);
      evidence.run(1, 7);
      expect(db.prepare("SELECT COUNT(*) AS count FROM event_sources WHERE event_id = ? AND raw_post_id = ?").get(1, 7)).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });
});

describe("V8 migration", () => {
  it("drops obsolete checkpoints, requeues unfinished legacy rows, and creates batch audit tables", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const migrations = ["0001_initial.sql", "0002_rename_cover_reference.sql", "0003_event_publication_locks.sql", "0004_runtime_settings.sql", "0005_ai_runtime_safety.sql", "0006_analysis_idempotency.sql", "0007_fix_event_origin_unique_index.sql"];
      for (const migration of migrations) db.exec(readFileSync(resolve(process.cwd(), "migrations", migration), "utf8"));
      db.prepare(
        `INSERT INTO sources(source_key, name, source_type, telegram_username, public_url, language, category, role, created_at, updated_at)
         VALUES ('test', 'Test', 'telegram', 'test', 'https://t.me/test', 'fa', 'IRAN', 'specialist', 'now', 'now')`
      ).run();
      db.prepare(
        `INSERT INTO raw_posts(source_id, telegram_message_id, canonical_url, update_type, observed_at, original_text, content_hash, processing_status, created_at, updated_at)
         VALUES (1, 1, 'https://t.me/test/1', 'create', 'now', 'legacy', 'hash', 'embedded', 'now', 'now')`
      ).run();

      db.exec(readFileSync(resolve(process.cwd(), "migrations/0008_remove_embedding_pipeline.sql"), "utf8"));
      expect(db.prepare("SELECT processing_status FROM raw_posts WHERE id = 1").get()).toMatchObject({ processing_status: "pending" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embedding_checkpoints'").get()).toBeUndefined();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_batches'").get()).toMatchObject({ name: "intelligence_batches" });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_batch_items'").get()).toMatchObject({ name: "intelligence_batch_items" });
    } finally {
      db.close();
    }
  });
});
