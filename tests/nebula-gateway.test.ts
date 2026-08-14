import { describe, expect, it, vi } from "vitest";
import { intelligenceBatchOutputSchema } from "../src/contracts";
import { generateNebulaJson, NebulaError } from "../src/intelligence/ai";

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
    NEBULA_MODEL: "auto",
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
  it("uses the OpenAI-compatible endpoint, model auto, and validates JSON output", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      model: "auto",
      provider: "test-provider",
      usage: { prompt_tokens: 12, completion_tokens: 8 },
      choices: [{ message: { content: JSON.stringify(validOutput) } }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    try {
      const result = await generateNebulaJson(fakeEnv(), "intelligence", "system", "user", intelligenceBatchOutputSchema);
      expect(result?.data).toEqual(validOutput);
      expect(result?.usage.promptTokens).toBe(12);
      expect(result?.usage.provider).toBe("test-provider");
      expect(fetchMock).toHaveBeenCalledWith("https://nebula.example/v1/chat/completions", expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"model":"auto"')
      }));
    } finally {
      fetchMock.mockRestore();
    }
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
