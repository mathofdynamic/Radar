import { describe, expect, it } from "vitest";
import { reserveNebulaCall } from "../src/db";

function fakeDatabase(initialCalls: number | null = null): { db: D1Database; calls: () => number | null } {
  let currentCalls = initialCalls;
  const db = {
    prepare(sql: string) {
      expect(sql).toContain("ON CONFLICT(usage_date, stage)");
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              const maxCalls = Number(values[3]);
              if (currentCalls === null) {
                currentCalls = 1;
                return { meta: { changes: 1 } };
              }
              if (currentCalls >= maxCalls) return { meta: { changes: 0 } };
              currentCalls += 1;
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
  return { db, calls: () => currentCalls };
}

describe("Nebula pair-call budget", () => {
  it("allows calls up to the finite limit and rejects exhaustion", async () => {
    const fake = fakeDatabase();
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 2)).toBe(true);
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 2)).toBe(true);
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 2)).toBe(false);
    expect(fake.calls()).toBe(2);
  });

  it("fails closed when the configured budget is zero", async () => {
    const fake = fakeDatabase();
    expect(await reserveNebulaCall(fake.db, "intelligence_pair", 0)).toBe(false);
    expect(fake.calls()).toBeNull();
  });
});
