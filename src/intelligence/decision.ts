import { intelligenceBatchOutputSchema } from "../contracts";
import type { IntelligenceBatchOutput } from "../contracts";
import type { IntelligenceDecision } from "../types";

export type IntelligenceValidationCode =
  | "intelligence_output_invalid"
  | "intelligence_unknown_event_id"
  | "intelligence_unknown_post_id"
  | "intelligence_unknown_duplicate_target"
  | "intelligence_unexpected_post_assignment"
  | "intelligence_contradictory_post_assignment"
  | "intelligence_missing_post_assignment"
  | "intelligence_invalid_duplicate_target"
  | "intelligence_action_reference_mismatch";

export class IntelligenceValidationError extends Error {
  readonly code: IntelligenceValidationCode;
  readonly recoverable: boolean;

  constructor(code: IntelligenceValidationCode, message: string, recoverable: boolean) {
    super(`${code}:${message}`);
    this.name = "IntelligenceValidationError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function isCorrectableIntelligenceValidationError(error: unknown): error is IntelligenceValidationError {
  return error instanceof IntelligenceValidationError && error.recoverable;
}

export function validateIntelligenceDecisions(
  value: unknown,
  expectedPostIds: number[],
  knownEventIds: ReadonlySet<number>,
  allowedPostIds: ReadonlySet<number> = new Set(expectedPostIds)
): IntelligenceDecision[] {
  const parsed = intelligenceBatchOutputSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ?? "schema";
    if (message === "event_id does not match action") {
      throw new IntelligenceValidationError("intelligence_action_reference_mismatch", message, true);
    }
    if (message.startsWith("duplicate target")) {
      throw new IntelligenceValidationError("intelligence_invalid_duplicate_target", message, true);
    }
    throw new IntelligenceValidationError("intelligence_output_invalid", message, false);
  }

  const expected = new Set(expectedPostIds);
  const assigned = new Set<number>();
  const actionByPost = new Map<number, IntelligenceDecision["action"]>();
  for (const decision of parsed.data.decisions) {
    if (decision.event_id !== null && !knownEventIds.has(decision.event_id)) {
      throw new IntelligenceValidationError("intelligence_unknown_event_id", String(decision.event_id), false);
    }
    for (const postId of decision.post_ids) {
      if (!allowedPostIds.has(postId)) throw new IntelligenceValidationError("intelligence_unknown_post_id", String(postId), false);
      if (assigned.has(postId)) throw new IntelligenceValidationError("intelligence_contradictory_post_assignment", String(postId), true);
      assigned.add(postId);
      actionByPost.set(postId, decision.action);
    }
    if (decision.duplicate_of_post_id !== null && !allowedPostIds.has(decision.duplicate_of_post_id)) {
      throw new IntelligenceValidationError("intelligence_unknown_duplicate_target", String(decision.duplicate_of_post_id), false);
    }
  }

  for (const postId of assigned) {
    if (!expected.has(postId)) throw new IntelligenceValidationError("intelligence_unexpected_post_assignment", String(postId), false);
  }
  for (const postId of expected) {
    if (!assigned.has(postId)) throw new IntelligenceValidationError("intelligence_missing_post_assignment", String(postId), true);
  }
  for (const decision of parsed.data.decisions) {
    if (decision.duplicate_of_post_id === null) continue;
    const targetAction = actionByPost.get(decision.duplicate_of_post_id);
    if (targetAction === "NOISE" || targetAction === "DUPLICATE" || targetAction === "UNCERTAIN") {
      throw new IntelligenceValidationError("intelligence_invalid_duplicate_target", String(decision.duplicate_of_post_id), true);
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
