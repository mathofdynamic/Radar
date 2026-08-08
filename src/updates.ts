import type { EventUpdateType } from "./types";

export function classifyEventUpdate(previous: { core_fact: string; verification_status: string; importance_score: number }, next: { core_fact: string; verification_status: string; importance_score: number }): EventUpdateType {
  if (previous.core_fact === next.core_fact && previous.verification_status === next.verification_status && previous.importance_score === next.importance_score) return "NO_CHANGE";
  if (previous.verification_status !== next.verification_status && (next.verification_status === "DISPUTED" || previous.verification_status === "CONFIRMED")) return "CONTRADICTION";
  if (previous.core_fact !== next.core_fact && previous.importance_score - next.importance_score >= 15) return "CORRECTION";
  if (Math.abs(previous.importance_score - next.importance_score) >= 15 || previous.core_fact !== next.core_fact) return "MAJOR_UPDATE";
  return "MINOR_UPDATE";
}
