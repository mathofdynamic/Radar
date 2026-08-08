import { describe, expect, it } from "vitest";
import { classifyEventUpdate } from "../src/updates";

describe("event update classification", () => {
  it("detects no-change", () => {
    const value = { core_fact: "a", verification_status: "CONFIRMED", importance_score: 80 };
    expect(classifyEventUpdate(value, value)).toBe("NO_CHANGE");
  });

  it("detects contradictions", () => {
    expect(classifyEventUpdate({ core_fact: "a", verification_status: "CONFIRMED", importance_score: 80 }, { core_fact: "a", verification_status: "DISPUTED", importance_score: 60 })).toBe("CONTRADICTION");
  });
});
