import type { EventRow, ScoreResult, VerificationStatus } from "../types";

const weights = {
  impact: 0.25,
  iranRelevance: 0.25,
  urgency: 0.15,
  confidence: 0.15,
  novelty: 0.1,
  geopoliticalSignificance: 0.1
} as const;

export function scoreEvent(event: EventRow, now = new Date()): ScoreResult {
  const ageHours = Math.max(0, (now.getTime() - new Date(event.first_seen_at).getTime()) / 3_600_000);
  const confidence = verificationConfidence(event.verification_status, event.independent_confirmation_count);
  const impact = clamp(30 + event.independent_confirmation_count * 15 + categoryImpact(event.category));
  const iranRelevance = clamp(event.category === "IRAN" || event.category === "POLITICS" || event.category === "WAR_SECURITY" ? 85 : 45);
  const urgency = clamp(100 - ageHours * 8 + (event.event_state === "active" ? 10 : 0));
  const novelty = clamp(event.event_version === 1 ? 80 : Math.max(20, 80 - (event.event_version - 1) * 12));
  const geopoliticalSignificance = clamp(["WAR_SECURITY", "WORLD", "POLITICS"].includes(event.category) ? 78 : 42);
  const finalScore = Math.round(
    impact * weights.impact +
    iranRelevance * weights.iranRelevance +
    urgency * weights.urgency +
    confidence * weights.confidence +
    novelty * weights.novelty +
    geopoliticalSignificance * weights.geopoliticalSignificance
  );
  const band = finalScore >= 90 ? "BREAKING" : finalScore >= 78 ? "CANDIDATE" : finalScore >= 60 ? "MONITOR" : "IGNORE";
  return {
    impact,
    iranRelevance,
    urgency,
    confidence,
    novelty,
    geopoliticalSignificance,
    finalScore,
    band,
    reasons: [
      `category:${event.category}`,
      `verification:${event.verification_status}`,
      `independent_confirmations:${event.independent_confirmation_count}`,
      `age_hours:${Math.round(ageHours)}`
    ]
  };
}

export function shouldPublish(event: EventRow, score: ScoreResult, highPrioritySource: boolean, dailyPublished: number, config: { editorialMinScore: number; breakingScore: number; dailyStoryBudget: number; busyDayStoryBudget: number }): boolean {
  if (event.verification_status === "UNVERIFIED") return false;
  if (event.verification_status === "DEVELOPING" && !(score.finalScore >= config.breakingScore && highPrioritySource)) return false;
  if (event.verification_status === "DISPUTED" && score.finalScore < config.breakingScore) return false;
  const budget = score.finalScore >= config.breakingScore ? config.busyDayStoryBudget : config.dailyStoryBudget;
  if (dailyPublished >= budget && score.finalScore < config.breakingScore) return false;
  return score.finalScore >= config.editorialMinScore;
}

function verificationConfidence(status: VerificationStatus, confirmations: number): number {
  if (status === "CONFIRMED") return clamp(75 + confirmations * 8);
  if (status === "DEVELOPING") return clamp(45 + confirmations * 10);
  if (status === "DISPUTED") return 25;
  return 10;
}

function categoryImpact(category: string): number {
  if (category === "WAR_SECURITY" || category === "POLITICS") return 35;
  if (category === "ECONOMY" || category === "SOCIETY") return 25;
  if (category === "TECHNOLOGY") return 20;
  return 10;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
