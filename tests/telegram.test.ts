import { afterEach, describe, expect, it, vi } from "vitest";
import { publishStory } from "../src/publisher/telegram";
import type { StoryDraft } from "../src/types";

const story: StoryDraft = {
  eventId: 42,
  eventVersion: 3,
  title: "خبر آزمایشی",
  description: "شرح خبر",
  verificationStatus: "CONFIRMED",
  independentConfirmations: 2,
  primarySources: [],
  category: "IRAN",
  tags: ["ایران"],
  links: [],
  coverConcept: "symbolic"
};

const env = {
  TELEGRAM_BOT_TOKEN: "test-token",
  RADAR_DESTINATION_CHAT_ID: "-100"
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Telegram cover handling", () => {
  it("publishes text-only when no cover is available", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      calls.push(String(input));
      return Response.json({ ok: true, result: { message_id: 101 } });
    }));

    const result = await publishStory(env, story, null);

    expect(result).toEqual({ telegramMessageId: 101, cover: null });
    expect(calls).toEqual(["https://api.telegram.org/bottest-token/sendMessage"]);
  });

  it("switches to text-only when Telegram rejects the image", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/sendPhoto")) return Response.json({ ok: false, description: "IMAGE_PROCESS_FAILED" }, { status: 400 });
      return Response.json({ ok: true, result: { message_id: 102 } });
    }));

    const result = await publishStory(env, story, {
      reference: "ai-generated:events/42/v3",
      mimeType: "image/jpeg",
      bytes: new Uint8Array([255, 216, 255, 224]).buffer
    });

    expect(result).toEqual({ telegramMessageId: 102, cover: null });
    expect(calls).toEqual([
      "https://api.telegram.org/bottest-token/sendPhoto",
      "https://api.telegram.org/bottest-token/sendMessage"
    ]);
  });
});
