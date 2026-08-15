import { describe, expect, it } from "vitest";

type Decision = {
  post_ids: number[];
  action: "DUPLICATE" | "NEW_EVENT" | "MATCH_EXISTING_EVENT" | "UPDATE_EXISTING_EVENT" | "NOISE" | "UNCERTAIN";
  duplicate_of_post_id: number | null;
};

function normalizeDuplicateChains(decisions: Decision[]): Decision[] | null {
  const byPost = new Map<number, Decision>();
  for (const decision of decisions) for (const postId of decision.post_ids) byPost.set(postId, decision);
  const normalized = decisions.map((decision) => ({ ...decision, post_ids: [...decision.post_ids] }));
  for (const decision of normalized) {
    if (decision.action !== "DUPLICATE" || decision.duplicate_of_post_id === null) continue;
    const seen = new Set<number>(decision.post_ids);
    let target = decision.duplicate_of_post_id;
    while (byPost.get(target)?.action === "DUPLICATE") {
      if (seen.has(target)) return null;
      seen.add(target);
      const next = byPost.get(target)?.duplicate_of_post_id;
      if (next === null || next === undefined) return null;
      target = next;
    }
    const terminal = byPost.get(target);
    if (!terminal || !["NEW_EVENT", "MATCH_EXISTING_EVENT", "UPDATE_EXISTING_EVENT"].includes(terminal.action)) return null;
    decision.duplicate_of_post_id = target;
  }
  return normalized;
}

describe("duplicate graph forensics", () => {
  it("normalizes an acyclic duplicate chain to its terminal event report", () => {
    const result = normalizeDuplicateChains([
      { post_ids: [101], action: "DUPLICATE", duplicate_of_post_id: 102 },
      { post_ids: [102], action: "DUPLICATE", duplicate_of_post_id: 103 },
      { post_ids: [103], action: "NEW_EVENT", duplicate_of_post_id: null }
    ]);
    expect(result?.map((decision) => decision.duplicate_of_post_id)).toEqual([103, 103, null]);
  });

  it.each([
    ["cycle", [
      { post_ids: [101], action: "DUPLICATE" as const, duplicate_of_post_id: 102 },
      { post_ids: [102], action: "DUPLICATE" as const, duplicate_of_post_id: 101 }
    ]],
    ["noise target", [
      { post_ids: [101], action: "DUPLICATE" as const, duplicate_of_post_id: 102 },
      { post_ids: [102], action: "NOISE" as const, duplicate_of_post_id: null }
    ]],
    ["uncertain target", [
      { post_ids: [101], action: "DUPLICATE" as const, duplicate_of_post_id: 102 },
      { post_ids: [102], action: "UNCERTAIN" as const, duplicate_of_post_id: null }
    ]]
  ])("does not normalize an unsafe %s", (_name, decisions) => {
    expect(normalizeDuplicateChains(decisions)).toBeNull();
  });
});
