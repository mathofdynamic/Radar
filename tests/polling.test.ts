import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_SOURCE_TIMEOUT_MS, pollSource } from "../src/polling/poller";
import type { SourceRow } from "../src/types";

const source: SourceRow = {
  id: 1,
  source_key: "test-source",
  name: "Test source",
  telegram_username: "test_source",
  role: "specialist",
  priority_tier: "TIER_2",
  category: "WORLD",
  language: "fa",
  source_type: "telegram",
  trust_score: 0.8,
  is_wire_origin: false,
  public_url: "https://t.me/test_source",
  is_active: 1,
  health_status: "healthy",
  next_poll_at: null,
  last_seen_message_id: null,
  last_error: null
};

const env = {
  MAX_HTML_BYTES: "524288"
} as unknown as Env;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("source polling timeout", () => {
  it("fails a stalled Telegram fetch instead of holding the queue consumer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));

    const assertion = expect(pollSource(env, source)).rejects.toThrow("telegram_fetch_timeout");
    await vi.advanceTimersByTimeAsync(POLL_SOURCE_TIMEOUT_MS);

    await assertion;
  });
});
