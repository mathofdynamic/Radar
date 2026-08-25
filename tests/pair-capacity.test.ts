import { describe, expect, it, vi } from "vitest";
import { runtimeConfig } from "../src/config";
import { reserveNebulaCall } from "../src/db";
import { generateNebulaJson, NebulaError } from "../src/intelligence/ai";
import {
  createCurrentWindowTelemetry,
  pairBudgetUsageSignal,
  recordPairReservationTelemetry
} from "../src/intelligence/pipeline";
import { CURRENT_WINDOW_PAIR_ACCEPTANCE_CONFIDENCE } from "../src/intelligence/current-window";
import { z } from "zod";

interface MeteredDatabaseOptions {
  initialCalls?: Record<string, number>;
}

function meteredDatabase(options: MeteredDatabaseOptions = {}): { db: D1Database; calls: (stage: string) => number } {
  const stageCalls = new Map(Object.entries(options.initialCalls ?? {}));
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (!sql.includes("INSERT INTO ai_usage")) return { meta: { changes: 1 } };
              const stage = String(values[1]);
              const maxCalls = Number(values[3]);
              const current = stageCalls.get(stage) ?? 0;
              if (current >= maxCalls) return { meta: { changes: 0 } };
              stageCalls.set(stage, current + 1);
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
  return { db, calls: (stage) => stageCalls.get(stage) ?? 0 };
}

function nebulaEnv(db: D1Database, pairBudget: number): Env {
  return {
    DB: db,
    NEBULA_API_KEY: "unit-test-secret",
    NEBULA_BASE_URL: "https://nebula.example/v1",
    NEBULA_INTELLIGENCE_MODEL: "@cf/google/gemma-4-26b-a4b-it",
    MAX_INTELLIGENCE_SECOND_PASS_CALLS_PER_DAY: String(pairBudget),
    MAX_INTELLIGENCE_BATCHES_PER_DAY: "500"
  } as unknown as Env;
}

const pairSchema = z.object({
  relationship: z.enum(["SAME_EVENT", "DIFFERENT_EVENT", "UNCERTAIN"]),
  confidence: z.number()
});

function pairResponse(relationship = "SAME_EVENT", confidence = 0.99): Response {
  return new Response(JSON.stringify({
    model: "@cf/google/gemma-4-26b-a4b-it",
    choices: [{ message: { content: JSON.stringify({ relationship, confidence }) } }]
  }), { status: 200 });
}

function pairContext(onReservation: (event: Parameters<typeof recordPairReservationTelemetry>[1]) => void) {
  return {
    batch_id: 221,
    logical_pair_check_id: "batch:221:18020:18022",
    left_post_id: 18020,
    right_post_id: 18022,
    onReservation
  };
}

describe("V8 pair verification capacity", () => {
  it("uses a finite 1400-call default for the pair stage", () => {
    expect(runtimeConfig({} as Env).maxIntelligenceSecondPassCallsPerDay).toBe(1400);
  });

  it("allows reservations 1 through 1400 and fails closed at 1401", async () => {
    const fake = meteredDatabase();
    let successes = 0;
    for (let attempt = 0; attempt < 1_400; attempt += 1) {
      if (await reserveNebulaCall(fake.db, "intelligence_pair", 1_400)) successes += 1;
    }
    expect(successes).toBe(1_400);
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 1_400)).toBe(false);
    expect(fake.calls("intelligence_pair")).toBe(1_400);
  });

  it("keeps proposal accounting separate from pair capacity", async () => {
    const fake = meteredDatabase();
    expect(await reserveNebulaCall(fake.db, "intelligence_proposal", 1)).toBe(true);
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 1)).toBe(true);
    expect(await reserveNebulaCall(fake.db, "intelligence_proposal", 1)).toBe(false);
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 1)).toBe(false);
    expect(fake.calls("intelligence_proposal")).toBe(1);
    expect(fake.calls("intelligence_pair")).toBe(1);
  });

  it("records RESERVED telemetry without exposing the credential", async () => {
    const fake = meteredDatabase();
    const telemetry = createCurrentWindowTelemetry(2);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(pairResponse());
    try {
      await generateNebulaJson(
        nebulaEnv(fake.db, 1),
        "intelligence_pair",
        "system",
        "user",
        pairSchema,
        150,
        { pairReservation: pairContext((event) => recordPairReservationTelemetry(telemetry, event)) }
      );
      expect(telemetry.pair_reservation_attempts).toBe(1);
      expect(telemetry.pair_reservation_successes).toBe(1);
      expect(telemetry.pair_reservation_budget_blocked).toBe(0);
      expect(telemetry.pair_reservation_telemetry[0]).toMatchObject({
        batch_id: 221,
        stage: "intelligence_pair",
        logical_pair_check_id: "batch:221:18020:18022",
        left_post_id: 18020,
        right_post_id: 18022,
        physical_attempt: 1,
        reservation: "RESERVED",
        retry: false
      });
      expect(JSON.stringify(telemetry)).not.toContain("unit-test-secret");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("records BUDGET_BLOCKED and returns no pair result at exhaustion", async () => {
    const fake = meteredDatabase({ initialCalls: { intelligence_pair: 1 } });
    const telemetry = createCurrentWindowTelemetry(2);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      await expect(generateNebulaJson(
        nebulaEnv(fake.db, 1),
        "intelligence_pair",
        "system",
        "user",
        pairSchema,
        150,
        { pairReservation: pairContext((event) => recordPairReservationTelemetry(telemetry, event)) }
      )).rejects.toBeInstanceOf(NebulaError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(telemetry.pair_reservation_attempts).toBe(1);
      expect(telemetry.pair_reservation_successes).toBe(0);
      expect(telemetry.pair_reservation_budget_blocked).toBe(1);
      expect(CURRENT_WINDOW_PAIR_ACCEPTANCE_CONFIDENCE).toBe(0.95);
      expect(JSON.stringify(telemetry)).not.toContain("unit-test-secret");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("reserves a second physical call for a retry", async () => {
    const fake = meteredDatabase();
    const telemetry = createCurrentWindowTelemetry(2);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("gateway failure", { status: 502 }))
      .mockResolvedValueOnce(pairResponse());
    try {
      const result = await generateNebulaJson(
        nebulaEnv(fake.db, 2),
        "intelligence_pair",
        "system",
        "user",
        pairSchema,
        150,
        { pairReservation: pairContext((event) => recordPairReservationTelemetry(telemetry, event)) }
      );
      expect(result?.data.relationship).toBe("SAME_EVENT");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(telemetry.pair_reservation_attempts).toBe(2);
      expect(telemetry.pair_reservation_successes).toBe(2);
      expect(telemetry.pair_physical_retries).toBe(1);
      expect(telemetry.pair_reservation_telemetry.map((event) => event.retry)).toEqual([false, true]);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("bounds per-attempt records while retaining truncation telemetry", () => {
    const telemetry = createCurrentWindowTelemetry(2);
    const base = {
      batch_id: 221,
      stage: "intelligence_pair" as const,
      logical_pair_check_id: "batch:221:18020:18022",
      left_post_id: 18020,
      right_post_id: 18022,
      physical_attempt: 1,
      reservation: "RESERVED" as const,
      usage_date: "2026-08-25",
      retry: false,
      timestamp: "2026-08-25T00:00:00.000Z"
    };
    for (let index = 0; index < 2_100; index += 1) {
      recordPairReservationTelemetry(telemetry, { ...base, logical_pair_check_id: `${base.logical_pair_check_id}:${index}` });
    }
    expect(telemetry.pair_reservation_telemetry).toHaveLength(2_048);
    expect(telemetry.pair_reservation_telemetry_truncated).toBe(52);
    expect(telemetry.pair_reservation_attempts).toBe(2_100);
    expect(JSON.stringify(telemetry)).not.toContain("NEBULA_API_KEY");
  });

  it("exposes high and critical usage signals without changing the cap", () => {
    expect(pairBudgetUsageSignal(1_099)).toBeNull();
    expect(pairBudgetUsageSignal(1_100)).toBe("HIGH");
    expect(pairBudgetUsageSignal(1_249)).toBe("HIGH");
    expect(pairBudgetUsageSignal(1_250)).toBe("CRITICAL");
    expect(pairBudgetUsageSignal(1_400)).toBe("CRITICAL");
  });
});
