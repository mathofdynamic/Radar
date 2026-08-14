import { intelligenceBatchOutputSchema } from "../contracts";
import type { IntelligenceBatchOutput } from "../contracts";
import type { IntelligenceDecision } from "../types";

export function validateIntelligenceDecisions(
  value: unknown,
  expectedPostIds: number[],
  knownEventIds: ReadonlySet<number>,
  allowedPostIds: ReadonlySet<number> = new Set(expectedPostIds)
): IntelligenceDecision[] {
  const parsed = intelligenceBatchOutputSchema.safeParse(value);
  if (!parsed.success) throw new Error(`intelligence_output_invalid:${parsed.error.issues[0]?.message ?? "schema"}`);

  const expected = new Set(expectedPostIds);
  const assigned = new Set<number>();
  const actionByPost = new Map<number, IntelligenceDecision["action"]>();
  for (const decision of parsed.data.decisions) {
    if (decision.event_id !== null && !knownEventIds.has(decision.event_id)) {
      throw new Error(`intelligence_unknown_event_id:${decision.event_id}`);
    }
    for (const postId of decision.post_ids) {
      if (!allowedPostIds.has(postId)) throw new Error(`intelligence_unknown_post_id:${postId}`);
      if (assigned.has(postId)) throw new Error(`intelligence_contradictory_post_assignment:${postId}`);
      assigned.add(postId);
      actionByPost.set(postId, decision.action);
    }
    if (decision.duplicate_of_post_id !== null && !allowedPostIds.has(decision.duplicate_of_post_id)) {
      throw new Error(`intelligence_unknown_duplicate_target:${decision.duplicate_of_post_id}`);
    }
  }

  for (const postId of assigned) {
    if (!expected.has(postId)) throw new Error(`intelligence_unexpected_post_assignment:${postId}`);
  }
  for (const postId of expected) {
    if (!assigned.has(postId)) throw new Error(`intelligence_missing_post_assignment:${postId}`);
  }
  for (const decision of parsed.data.decisions) {
    if (decision.duplicate_of_post_id === null) continue;
    const targetAction = actionByPost.get(decision.duplicate_of_post_id);
    if (targetAction === "NOISE" || targetAction === "DUPLICATE" || targetAction === "UNCERTAIN") {
      throw new Error(`intelligence_invalid_duplicate_target:${decision.duplicate_of_post_id}`);
    }
  }
  return parsed.data.decisions.map((decision) => ({
    ...decision,
    duplicate_of_post_id: decision.duplicate_of_post_id ?? null
  }));
}

export function ambiguousPostIds(decisions: IntelligenceDecision[], threshold: number): number[] {
  return [...new Set(decisions
    .filter((decision) => decision.action === "UNCERTAIN" || decision.confidence < threshold)
    .flatMap((decision) => decision.post_ids))];
}

export function replaceAmbiguousDecisions(
  primary: IntelligenceDecision[],
  resolved: IntelligenceDecision[],
  uncertainPostIds: ReadonlySet<number>
): IntelligenceDecision[] {
  const retained = primary.filter((decision) => !decision.post_ids.some((postId) => uncertainPostIds.has(postId)));
  return [...retained, ...resolved];
}

export function outputForDecisions(decisions: IntelligenceDecision[]): IntelligenceBatchOutput {
  return { decisions };
}
