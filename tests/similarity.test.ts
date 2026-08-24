import { describe, expect, it } from "vitest";
import { entityOverlap, extractEntityKeys, inferCategory, lexicalTemporalSimilarity, temporalProximity } from "../src/intelligence/similarity";

describe("deterministic support utilities", () => {
  it("identifies categories and bounded entity keys", () => {
    expect(inferCategory("missile attack near Tehran", "IRAN")).toBe("WAR_SECURITY");
    expect(extractEntityKeys("Iran and OpenAI discuss internet policy")).toEqual(expect.arrayContaining(["iran", "openai", "internet"]));
  });

  it("keeps lexical copy support separate from semantic event reasoning", () => {
    const sameWording = lexicalTemporalSimilarity("Iran market report", "Iran market report", 1);
    const unrelated = lexicalTemporalSimilarity("Iran market report", "football match tomorrow", 1);
    expect(sameWording).toBeGreaterThan(unrelated);
    expect(sameWording).toBeLessThanOrEqual(1);
  });

  it("uses entity overlap and time only as deterministic support signals", () => {
    expect(entityOverlap("Iran and Tehran", "Tehran in Iran")).toBeGreaterThan(0);
    expect(temporalProximity("2026-08-14T00:00:00.000Z", "2026-08-14T01:00:00.000Z")).toBeGreaterThan(0.9);
    expect(temporalProximity("2026-08-14T00:00:00.000Z", "2026-08-16T00:00:00.000Z")).toBe(0);
  });
});
