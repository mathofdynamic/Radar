import { describe, expect, it } from "vitest";
import { parseStructuredAiResult } from "../src/intelligence/ai";

describe("structured AI parsing", () => {
  it("accepts native JSON-mode response objects", () => {
    expect(parseStructuredAiResult({ response: { publish_recommendation: "PUBLISH", reason: "important" } }))
      .toEqual({ publish_recommendation: "PUBLISH", reason: "important" });
  });

  it("accepts nested result responses from compatible gateways", () => {
    expect(parseStructuredAiResult({ result: { response: { status: "MONITOR" } } }))
      .toEqual({ status: "MONITOR" });
  });

  it("accepts OpenAI-compatible chat completion content", () => {
    expect(parseStructuredAiResult({ choices: [{ message: { content: "{\"status\":\"MONITOR\"}" } }] }))
      .toEqual({ status: "MONITOR" });
  });

  it("accepts fenced JSON from non-compliant model output", () => {
    expect(parseStructuredAiResult({ response: "```json\n{\"title\":\"خبر مهم\"}\n```" }))
      .toEqual({ title: "خبر مهم" });
  });

  it("extracts a JSON object from accidental surrounding text", () => {
    expect(parseStructuredAiResult({ response: "نتیجه: {\"status\":\"MONITOR\"} پایان" }))
      .toEqual({ status: "MONITOR" });
  });
});
