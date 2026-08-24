import { describe, expect, it, vi } from "vitest";
import { assertCurrentWindowConfiguration, runtimeConfig } from "../src/config";
import { evaluateTelegramCanary } from "../src/publisher/canary";

const startAt = "2026-08-23T10:00:00.000Z";
const config = {
  telegramCanaryEnabled: true,
  telegramCanaryStartAt: startAt,
  telegramCanaryMaxPerCycle: 1,
  telegramCanaryMaxPerHour: 2,
  telegramCanaryMaxTotal: 5
};

function dbFor(rows: Array<{ published_at: string | null; updated_at: string }>): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          const now = Date.parse("2026-08-23T10:06:00.000Z");
          const start = Date.parse(startAt);
          const hour = now - 60 * 60 * 1_000;
          const cycleStart = Date.parse("2026-08-23T10:05:00.000Z");
          const cycleEnd = Date.parse("2026-08-23T10:10:00.000Z");
          const active = rows.map((row) => row.published_at ? Date.parse(row.published_at) : Date.parse(row.updated_at))
            .filter((timestamp) => Number.isFinite(timestamp) && timestamp >= start);
          return {
            total: active.length,
            hourly: active.filter((timestamp) => timestamp >= hour).length,
            cycle: active.filter((timestamp) => timestamp >= cycleStart && timestamp < cycleEnd).length
          };
        })
      }))
    }))
  } as unknown as D1Database;
}

describe("Telegram canary limiter", () => {
  it("allows the first eligible story", async () => {
    await expect(evaluateTelegramCanary(dbFor([]), config, new Date("2026-08-23T10:06:00.000Z"))).resolves.toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("blocks a second story in the same five-minute publishing cycle", async () => {
    const rows = [{ published_at: "2026-08-23T10:06:00.000Z", updated_at: "2026-08-23T10:06:00.000Z" }];
    await expect(evaluateTelegramCanary(dbFor(rows), config, new Date("2026-08-23T10:06:30.000Z"))).resolves.toMatchObject({ allowed: false, reason: "canary_cycle_exhausted" });
  });

  it("blocks a third story in the hour after two publications", async () => {
    const rows = [
      { published_at: "2026-08-23T10:01:00.000Z", updated_at: "2026-08-23T10:01:00.000Z" },
      { published_at: "2026-08-23T10:04:00.000Z", updated_at: "2026-08-23T10:04:00.000Z" }
    ];
    await expect(evaluateTelegramCanary(dbFor(rows), config, new Date("2026-08-23T10:06:00.000Z"))).resolves.toMatchObject({ allowed: false, reason: "canary_hour_exhausted" });
  });

  it("allows publication after the hourly window clears", async () => {
    const rows = [
      { published_at: "2026-08-23T09:01:00.000Z", updated_at: "2026-08-23T09:01:00.000Z" },
      { published_at: "2026-08-23T09:04:00.000Z", updated_at: "2026-08-23T09:04:00.000Z" }
    ];
    await expect(evaluateTelegramCanary(dbFor(rows), config, new Date("2026-08-23T10:06:00.000Z"))).resolves.toMatchObject({ allowed: true, reason: "allowed" });
  });

  it("allows canary publication number five and blocks number six", async () => {
    const rows = [1, 2, 3, 4].map((index) => ({
      published_at: `2026-08-23T10:0${index}:00.000Z`,
      updated_at: `2026-08-23T10:0${index}:00.000Z`
    }));
    await expect(evaluateTelegramCanary(dbFor(rows), { ...config, telegramCanaryMaxPerCycle: 5, telegramCanaryMaxPerHour: 10 }, new Date("2026-08-23T11:00:00.000Z"))).resolves.toMatchObject({ allowed: true });
    await expect(evaluateTelegramCanary(dbFor([...rows, { published_at: "2026-08-23T10:05:00.000Z", updated_at: "2026-08-23T10:05:00.000Z" }]), { ...config, telegramCanaryMaxPerCycle: 5, telegramCanaryMaxPerHour: 10 }, new Date("2026-08-23T11:00:00.000Z"))).resolves.toMatchObject({ allowed: false, reason: "canary_total_exhausted" });
  });

  it("fails closed when limiter state cannot be read", async () => {
    const db = { prepare: vi.fn(() => { throw new Error("d1_unavailable"); }) } as unknown as D1Database;
    await expect(evaluateTelegramCanary(db, config, new Date("2026-08-23T10:06:00.000Z"))).resolves.toMatchObject({ allowed: false, reason: "canary_state_unavailable" });
  });

  it("counts a failed Telegram attempt so it cannot bypass the limiter", async () => {
    const rows = [{ published_at: null, updated_at: "2026-08-23T10:06:00.000Z" }];
    await expect(evaluateTelegramCanary(dbFor(rows), { ...config, telegramCanaryMaxPerCycle: 5, telegramCanaryMaxPerHour: 5, telegramCanaryMaxTotal: 1 }, new Date("2026-08-23T10:06:30.000Z"))).resolves.toMatchObject({ allowed: false, reason: "canary_total_exhausted" });
  });

  it("does not activate when publishing is disabled", () => {
    const env = {
      PUBLISH_ENABLED: "false",
      TELEGRAM_CANARY_ENABLED: "true",
      TELEGRAM_CANARY_START_AT: startAt,
      TELEGRAM_CANARY_MAX_PER_CYCLE: "1",
      TELEGRAM_CANARY_MAX_PER_HOUR: "2",
      TELEGRAM_CANARY_MAX_TOTAL: "5",
      V8_HISTORICAL_SEMANTIC_LINKING_ENABLED: "false",
      NEBULA_INTELLIGENCE_MODEL: "@cf/google/gemma-4-26b-a4b-it"
    } as unknown as Env;
    expect(runtimeConfig(env).publishEnabled).toBe(false);
  });

  it("keeps historical semantic linking disabled", () => {
    const env = {
      PUBLISH_ENABLED: "false",
      TELEGRAM_CANARY_ENABLED: "true",
      TELEGRAM_CANARY_START_AT: startAt,
      V8_HISTORICAL_SEMANTIC_LINKING_ENABLED: "false",
      NEBULA_INTELLIGENCE_MODEL: "@cf/google/gemma-4-26b-a4b-it"
    } as unknown as Env;
    expect(() => assertCurrentWindowConfiguration(runtimeConfig(env))).not.toThrow();
  });
});
