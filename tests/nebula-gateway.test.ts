import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { intelligenceBatchJsonSchema, intelligenceBatchOutputSchema } from "../src/contracts";
import { generateNebulaJson, NebulaError, parseRoutedVia } from "../src/intelligence/ai";
import { runtimeConfig } from "../src/config";
import { ANALYSIS_STALE_AFTER_MS } from "../src/intelligence/analysis-state";

function fakeEnv(): Env {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            first: async () => null,
            run: async () => ({ meta: { changes: 1 } })
          };
        }
      };
    }
  } as unknown as D1Database;
  return {
    DB: db,
    NEBULA_API_KEY: "test-key",
    NEBULA_BASE_URL: "https://nebula.example/v1",
    NEBULA_INTELLIGENCE_MODEL: "radar-fast",
    NEBULA_EDITORIAL_MODEL: "auto",
    NEBULA_MODEL: "auto",
    NEBULA_INTELLIGENCE_TIMEOUT_MS: "95000",
    NEBULA_EDITORIAL_TIMEOUT_MS: "25000",
    NEBULA_TIMEOUT_MS: "25000",
    MAX_INTELLIGENCE_BATCHES_PER_DAY: "500",
    MAX_INTELLIGENCE_SECOND_PASS_CALLS_PER_DAY: "100",
    MAX_STAGE1_CALLS_PER_DAY: "250",
    MAX_STAGE2_CALLS_PER_DAY: "40"
  } as unknown as Env;
}

const validOutput = {
  decisions: [{
    post_ids: [8101],
    action: "NEW_EVENT",
    event_id: null,
    duplicate_of_post_id: null,
    confidence: 0.9,
    canonical_fact: "test event",
    category: "IRAN",
    reason: "test"
  }]
};

describe("Nebula gateway", () => {
  it("uses radar-fast, strict JSON Schema, and captures routing headers for intelligence", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "radar-fast",
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      choices: [{ message: { content: JSON.stringify(validOutput) } }]
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-routed-via": "cloudflare/@cf/meta/llama-3.1-8b-instruct-fast",
        "x-fallback-attempts": "2",
        "x-request-id": "req-test-123"
      }
    }));
    try {
      const result = await generateNebulaJson(fakeEnv(), "intelligence", "system", "user", intelligenceBatchOutputSchema);
      expect(result?.data).toEqual(validOutput);
      expect(result?.usage.promptTokens).toBe(12);
      expect(result?.usage.requestedModel).toBe("radar-fast");
      expect(result?.usage.provider).toBe("cloudflare");
      expect(result?.usage.routedModel).toBe("@cf/meta/llama-3.1-8b-instruct-fast");
      expect(result?.usage.fallbackAttempts).toBe(2);
      expect(result?.usage.requestId).toBe("req-test-123");
      expect(result?.usage.status).toBe(200);
      expect(result?.usage.latencyMs).toBeGreaterThanOrEqual(0);
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(request.body)) as { model: string; response_format: { type: string; json_schema: { name: string; strict: boolean; schema: typeof intelligenceBatchJsonSchema } } };
      expect(body.model).toBe("radar-fast");
      expect(body.response_format.type).toBe("json_schema");
      expect(body.response_format.json_schema.name).toBe("radar_intelligence_batch");
      expect(body.response_format.json_schema.strict).toBe(true);
      expect(body.response_format.json_schema.schema).toEqual(intelligenceBatchJsonSchema);
      expect(fetchMock).toHaveBeenCalledWith("https://nebula.example/v1/chat/completions", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"radar-fast"')
      }));
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps editorial text on auto and json_object", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "auto",
      choices: [{ message: { content: "{}" } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      await generateNebulaJson(fakeEnv(), "stage1", "system", "user", z.record(z.unknown()));
      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(String(request.body)) as { model: string; response_format: { type: string } };
      expect(body.model).toBe("auto");
      expect(body.response_format).toEqual({ type: "json_object" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("parses a routed model containing additional slashes", () => {
    expect(parseRoutedVia("cloudflare/@cf/meta/llama-3.1-8b-instruct-fast")).toEqual({
      provider: "cloudflare",
      model: "@cf/meta/llama-3.1-8b-instruct-fast"
    });
  });

  it("allows the intelligence gateway fallback deadline while keeping editorial timeout separate", () => {
    const config = runtimeConfig(fakeEnv());
    expect(config.nebulaIntelligenceTimeoutMs).toBe(95_000);
    expect(config.nebulaEditorialTimeoutMs).toBe(25_000);
    expect(ANALYSIS_STALE_AFTER_MS).toBeGreaterThan(config.nebulaIntelligenceTimeoutMs);
  });

  it("keeps the JSON Schema and Zod contract aligned", () => {
    expect(intelligenceBatchJsonSchema.required).toEqual(["decisions"]);
    const decisionSchema = intelligenceBatchJsonSchema.properties.decisions.items;
    expect(decisionSchema.required).toEqual([
      "post_ids", "action", "event_id", "duplicate_of_post_id",
      "confidence", "canonical_fact", "category", "reason"
    ]);
    expect(decisionSchema).not.toHaveProperty("allOf");
    expect(decisionSchema).toHaveProperty("anyOf");
    expect(decisionSchema.properties.post_ids).not.toHaveProperty("uniqueItems");
    expect(intelligenceBatchOutputSchema.safeParse(validOutput).success).toBe(true);
    expect(intelligenceBatchOutputSchema.safeParse({ ...validOutput, extra: true }).success).toBe(false);
    expect(intelligenceBatchOutputSchema.safeParse({
      ...validOutput,
      decisions: [{ ...validOutput.decisions[0], action: "MATCH_EXISTING_EVENT", event_id: null }]
    }).success).toBe(false);
  });

  it.each([429, 500])("surfaces HTTP %s for bounded Queue retry", async (status) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream failure", { status }));
    try {
      await expect(generateNebulaJson(fakeEnv(), "intelligence", "system", "user", intelligenceBatchOutputSchema))
        .rejects.toMatchObject({ name: "NebulaError", status, message: `nebula_http_${status}` });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("never includes the Authorization value in safe failure telemetry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream failure", { status: 500 }));
    const warnMock = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(generateNebulaJson(fakeEnv(), "intelligence", "system", "user", intelligenceBatchOutputSchema)).rejects.toBeInstanceOf(NebulaError);
      expect(JSON.stringify(warnMock.mock.calls)).not.toContain("test-key");
    } finally {
      fetchMock.mockRestore();
      warnMock.mockRestore();
    }
  });

  it("rejects malformed structured output before callers can apply it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"decisions\": [{\"post_ids\": [999]}]}" } }]
    }), { status: 200 }));
    try {
      await expect(generateNebulaJson(fakeEnv(), "intelligence", "system", "user", intelligenceBatchOutputSchema))
        .rejects.toMatchObject({ name: "NebulaError" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("exposes a typed gateway error for missing credentials", async () => {
    const env = fakeEnv();
    env.NEBULA_API_KEY = "";
    await expect(generateNebulaJson(env, "intelligence", "system", "user", intelligenceBatchOutputSchema))
      .rejects.toBeInstanceOf(NebulaError);
  });
});
