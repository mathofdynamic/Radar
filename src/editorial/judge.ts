import { aiEditorialOutputSchema } from "../contracts";
import { generateStructuredText } from "../intelligence/ai";
import type { EventRow, ScoreResult } from "../types";

export const AI_EDITOR_MIN_SCORE = 75;

export interface EditorialJudgment {
  usedAi: boolean;
  recommendation: "PUBLISH" | "MONITOR" | "IGNORE";
  adjustedScore: number;
  reason: string;
  isBreakingCandidate: boolean;
}

export function shouldUseAiEditor(deterministicScore: number): boolean {
  return deterministicScore >= AI_EDITOR_MIN_SCORE;
}

export async function judgeEvent(env: Env, event: EventRow, deterministic: ScoreResult): Promise<EditorialJudgment> {
  if (!shouldUseAiEditor(deterministic.finalScore)) {
    return {
      usedAi: false,
      recommendation: deterministic.finalScore >= 60 ? "MONITOR" : "IGNORE",
      adjustedScore: deterministic.finalScore,
      reason: "below_ai_editor_gate",
      isBreakingCandidate: false
    };
  }

  const evidence = await env.DB.prepare(
    `SELECT s.name, s.role, s.priority_tier, s.trust_score, rp.normalized_text
       FROM event_sources es
       JOIN sources s ON s.id = es.source_id
       JOIN raw_posts rp ON rp.id = es.raw_post_id
      WHERE es.event_id = ?
      ORDER BY s.priority_tier, s.trust_score DESC
      LIMIT 6`
  ).bind(event.id).all<{ name: string; role: string; priority_tier: string; trust_score: number; normalized_text: string }>();

  const prompt = JSON.stringify({
    task: "Act as a strict Persian news editor. Decide whether this event is genuinely important enough for a very low-noise private news channel. Routine statements, recycled commentary, minor incidents, and stories with little real-world consequence must stay MONITOR or IGNORE even when several outlets repeat them. Prioritize concrete consequences, scale, urgency, geopolitical/economic significance, and relevance to Iran. Do not reward raw source count. Return JSON only.",
    editorial_policy: {
      very_high: ["war or military escalation", "major Iran government decision", "sanctions or currency shock", "major internet restriction/outage", "major geopolitical change", "major AI/technology development", "large disaster"],
      low: ["routine official statement", "minor local incident", "celebrity gossip", "football rumor", "opinion", "clickbait", "repeated background"]
    },
    event: {
      core_fact: event.core_fact,
      category: event.category,
      verification_status: event.verification_status,
      independent_confirmations: event.independent_confirmation_count,
      age_first_seen: event.first_seen_at,
      deterministic_score: deterministic.finalScore
    },
    evidence: evidence.results.map((item) => ({
      source: item.name,
      role: item.role,
      tier: item.priority_tier,
      trust: item.trust_score,
      report: item.normalized_text.slice(0, 700)
    })),
    output_schema: {
      publish_recommendation: "PUBLISH | MONITOR | IGNORE",
      importance_adjustment: "integer -20..20",
      reason: "short reason",
      is_breaking_candidate: "boolean"
    }
  });

  const raw = await generateStructuredText(env, prompt, "stage1");
  const parsed = aiEditorialOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      usedAi: false,
      recommendation: "MONITOR",
      adjustedScore: deterministic.finalScore,
      reason: "ai_editor_unavailable",
      isBreakingCandidate: deterministic.band === "BREAKING"
    };
  }

  const adjustedScore = clamp(deterministic.finalScore + parsed.data.importance_adjustment);
  return {
    usedAi: true,
    recommendation: parsed.data.publish_recommendation,
    adjustedScore,
    reason: parsed.data.reason,
    isBreakingCandidate: parsed.data.is_breaking_candidate
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
