import { describe, expect, it } from "vitest";
import { AI_EDITOR_MIN_SCORE, shouldUseAiEditor } from "../src/editorial/judge";

describe("AI editorial gate", () => {
  it("skips LLM review below the V4 threshold", () => {
    expect(AI_EDITOR_MIN_SCORE).toBe(75);
    expect(shouldUseAiEditor(60)).toBe(false);
    expect(shouldUseAiEditor(74)).toBe(false);
  });

  it("allows LLM review at or above the threshold", () => {
    expect(shouldUseAiEditor(75)).toBe(true);
    expect(shouldUseAiEditor(90)).toBe(true);
  });
});
