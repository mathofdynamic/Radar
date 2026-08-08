import { describe, expect, it } from "vitest";
import { createDeterministicCover } from "../src/publisher/covers";
import type { StoryDraft } from "../src/types";

const story: StoryDraft = {
  eventId: 42,
  eventVersion: 3,
  title: "خبر آزمایشی <مهم>",
  description: "شرح خبر",
  verificationStatus: "CONFIRMED",
  independentConfirmations: 2,
  primarySources: [],
  category: "IRAN",
  tags: ["ایران"],
  links: [],
  coverConcept: "symbolic"
};

describe("deterministic covers", () => {
  it("creates the same Telegram-ready PNG for the same story version", async () => {
    const first = createDeterministicCover(story);
    const second = createDeterministicCover(story);
    expect(first.reference).toBe("deterministic-png:events/42/v3");
    expect(first.mimeType).toBe("image/png");
    expect(await new Response(first.bytes).arrayBuffer()).toEqual(await new Response(second.bytes).arrayBuffer());
    expect(new Uint8Array(first.bytes).slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
