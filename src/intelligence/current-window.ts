import { z } from "zod";

export const CURRENT_WINDOW_CLASSIFICATIONS = ["EVENT", "NOISE", "UNCERTAIN"] as const;
export const CURRENT_WINDOW_RELATIONSHIPS = ["SAME_EVENT", "DIFFERENT_EVENT", "UNCERTAIN"] as const;
export const CURRENT_WINDOW_PAIR_ACCEPTANCE_CONFIDENCE = 0.95;

export const currentWindowClusterSchema = z.object({
  post_ids: z.array(z.number().int().positive()).min(1).max(40),
  classification: z.enum(CURRENT_WINDOW_CLASSIFICATIONS),
  confidence: z.number().min(0).max(1)
}).strict();

export const currentWindowProposalOutputSchema = z.object({
  clusters: z.array(currentWindowClusterSchema).min(1).max(40)
}).strict();

export const currentWindowPairOutputSchema = z.object({
  relationship: z.enum(CURRENT_WINDOW_RELATIONSHIPS),
  confidence: z.number().min(0).max(1)
}).strict();

export type CurrentWindowCluster = z.infer<typeof currentWindowClusterSchema>;
export type CurrentWindowProposal = z.infer<typeof currentWindowProposalOutputSchema>;
export type CurrentWindowPair = z.infer<typeof currentWindowPairOutputSchema>;

export interface CurrentWindowPairCheck {
  leftPostId: number;
  rightPostId: number;
  result: CurrentWindowPair | null;
  hardContradictions?: readonly string[];
}

export interface ReconstructedCurrentWindowCluster {
  postIds: number[];
  classification: CurrentWindowCluster["classification"];
  confidence: number;
  anchorPostId: number | null;
  acceptedEdges: Array<{ leftPostId: number; rightPostId: number; confidence: number }>;
}

export type CurrentWindowValidationCode =
  | "current_window_proposal_invalid"
  | "current_window_pair_invalid"
  | "current_window_unknown_post_id"
  | "current_window_duplicate_post_assignment"
  | "current_window_missing_post_assignment";

export class CurrentWindowValidationError extends Error {
  readonly code: CurrentWindowValidationCode;

  constructor(code: CurrentWindowValidationCode, detail: string) {
    super(`${code}:${detail}`);
    this.name = "CurrentWindowValidationError";
    this.code = code;
  }
}

export function validateCurrentWindowProposal(value: unknown, expectedPostIds: readonly number[]): CurrentWindowProposal {
  const parsed = currentWindowProposalOutputSchema.safeParse(value);
  if (!parsed.success) {
    throw new CurrentWindowValidationError("current_window_proposal_invalid", parsed.error.issues[0]?.message ?? "schema");
  }

  const expected = new Set(expectedPostIds);
  const assigned = new Set<number>();
  for (const cluster of parsed.data.clusters) {
    for (const postId of cluster.post_ids) {
      if (!expected.has(postId)) throw new CurrentWindowValidationError("current_window_unknown_post_id", String(postId));
      if (assigned.has(postId)) throw new CurrentWindowValidationError("current_window_duplicate_post_assignment", String(postId));
      assigned.add(postId);
    }
  }

  const missing = expectedPostIds.filter((postId) => !assigned.has(postId));
  if (missing.length > 0) throw new CurrentWindowValidationError("current_window_missing_post_assignment", missing.join(","));

  return {
    clusters: parsed.data.clusters.map((cluster) => ({
      ...cluster,
      post_ids: [...cluster.post_ids].sort((left, right) => left - right)
    }))
  };
}

export function validateCurrentWindowPair(value: unknown): CurrentWindowPair {
  const parsed = currentWindowPairOutputSchema.safeParse(value);
  if (!parsed.success) throw new CurrentWindowValidationError("current_window_pair_invalid", parsed.error.issues[0]?.message ?? "pair_schema");
  return parsed.data;
}

export function acceptsCurrentWindowPair(pair: CurrentWindowPair | null): boolean {
  return pair?.relationship === "SAME_EVENT" && pair.confidence >= CURRENT_WINDOW_PAIR_ACCEPTANCE_CONFIDENCE;
}

export function reconstructCurrentWindowClusters(
  proposal: CurrentWindowProposal,
  pairChecks: readonly CurrentWindowPairCheck[]
): ReconstructedCurrentWindowCluster[] {
  const reconstructed: ReconstructedCurrentWindowCluster[] = [];

  for (const proposedCluster of proposal.clusters) {
    if (proposedCluster.classification !== "EVENT" || proposedCluster.post_ids.length < 2) {
      for (const postId of proposedCluster.post_ids) {
        reconstructed.push({
          postIds: [postId],
          classification: proposedCluster.classification,
          confidence: proposedCluster.confidence,
          anchorPostId: postId,
          acceptedEdges: []
        });
      }
      continue;
    }

    const clusterPostIds = new Set(proposedCluster.post_ids);
    const usableEdges = pairChecks
      .filter((check) => clusterPostIds.has(check.leftPostId) && clusterPostIds.has(check.rightPostId) && acceptsCurrentWindowPair(check.result) && (check.hardContradictions?.length ?? 0) === 0)
      .map((check) => ({
        leftPostId: check.leftPostId,
        rightPostId: check.rightPostId,
        confidence: check.result?.confidence ?? 0
      }));
    const remaining = new Set(proposedCluster.post_ids);

    while (remaining.size > 0) {
      const remainingEdges = usableEdges.filter((edge) => remaining.has(edge.leftPostId) && remaining.has(edge.rightPostId));
      const ranked = [...remaining].map((postId) => {
        const incident = remainingEdges.filter((edge) => edge.leftPostId === postId || edge.rightPostId === postId);
        return {
          postId,
          degree: incident.length,
          confidence: incident.reduce((sum, edge) => sum + edge.confidence, 0)
        };
      }).sort((left, right) =>
        right.degree - left.degree
        || right.confidence - left.confidence
        || left.postId - right.postId
      );
      const anchor = ranked[0]?.postId;
      if (anchor === undefined) break;

      const attachedEdges = remainingEdges.filter((edge) => edge.leftPostId === anchor || edge.rightPostId === anchor);
      const attachedPostIds = [anchor, ...attachedEdges.map((edge) => edge.leftPostId === anchor ? edge.rightPostId : edge.leftPostId)]
        .filter((postId, index, values) => values.indexOf(postId) === index && remaining.has(postId))
        .sort((left, right) => left - right);
      const edgeConfidence = attachedEdges.map((edge) => edge.confidence);
      reconstructed.push({
        postIds: attachedPostIds,
        classification: "EVENT",
        confidence: Math.min(proposedCluster.confidence, ...(edgeConfidence.length > 0 ? edgeConfidence : [proposedCluster.confidence])),
        anchorPostId: anchor,
        acceptedEdges: attachedEdges
      });
      for (const postId of attachedPostIds) remaining.delete(postId);
    }
  }

  return reconstructed;
}

export function currentWindowProposalJsonSchema(allowedPostIds: readonly number[]): Record<string, unknown> {
  const ids = uniquePositiveIds(allowedPostIds);
  return {
    type: "object",
    additionalProperties: false,
    required: ["clusters"],
    properties: {
      clusters: {
        type: "array",
        minItems: 1,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["post_ids", "classification", "confidence"],
          properties: {
            post_ids: { type: "array", minItems: 1, maxItems: ids.length, items: { type: "integer", enum: ids } },
            classification: { type: "string", enum: [...CURRENT_WINDOW_CLASSIFICATIONS] },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
}

export const currentWindowPairJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["relationship", "confidence"],
  properties: {
    relationship: { type: "string", enum: [...CURRENT_WINDOW_RELATIONSHIPS] },
    confidence: { type: "number", minimum: 0, maximum: 1 }
  }
};

function uniquePositiveIds(values: readonly number[]): number[] {
  return [...new Set(values)].filter((value) => Number.isSafeInteger(value) && value > 0).sort((left, right) => left - right);
}
