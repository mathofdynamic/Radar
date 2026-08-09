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
  const impact = clamp(20 + Math.min(event.independent_confirmation_count, 3) * 8 + categoryImpact(event.category));
  const iranRelevance = categoryIranRelevance(event.category);
  const urgency = clamp(95 - ageHours * 9 + (event.event_state === "active" ? 5 : 0));
  const novelty = ageHours <= 2 ? 82 : ageHours <= 6 ? 68 : ageHours <= 24 ? 48 : 25;
  const geopoliticalSignificance = categoryGeopoliticalSignificance(event.category);
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

export function scoreWithAdjustment(score: ScoreResult, adjustment: number): ScoreResult {
  const finalScore = clamp(score.finalScore + adjustment);
  return {
    ...score,
    finalScore,
    band: finalScore >= 90 ? "BREAKING" : finalScore >= 78 ? "CANDIDATE" : finalScore >= 60 ? "MONITOR" : "IGNORE"
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
  if (status === "CONFIRMED") return clamp(72 + confirmations * 7);
  if (status === "DEVELOPING") return clamp(42 + confirmations * 9);
  if (status === "DISPUTED") return 24;
  return 8;
}

function categoryImpact(category: string): number {
  if (category === "WAR_SECURITY") return 25;
  if (category === "POLITICS") return 18;
  if (category === "ECONOMY" || category === "SOCIETY") return 18;
  if (category === "WORLD") return 15;
  if (category === "TECHNOLOGY") return 12;
  return 10;
}

function categoryIranRelevance(category: string): number {
  if (category === "IRAN") return 92;
  if (category === "POLITICS" || category === "WAR_SECURITY") return 82;
  if (category === "ECONOMY" || category === "SOCIETY") return 72;
  if (category === "TECHNOLOGY") return 48;
  if (category === "WORLD") return 42;
  return 45;
}

function categoryGeopoliticalSignificance(category: string): number {
  if (category === "WAR_SECURITY") return 72;
  if (category === "POLITICS" || category === "WORLD") return 55;
  if (category === "ECONOMY") return 38;
  if (category === "SOCIETY") return 28;
  if (category === "TECHNOLOGY") return 24;
  return 22;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
