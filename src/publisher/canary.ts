import type { RuntimeConfig } from "../config";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export type TelegramCanaryBlockReason =
  | "canary_disabled"
  | "canary_configuration_invalid"
  | "canary_state_unavailable"
  | "canary_total_exhausted"
  | "canary_hour_exhausted"
  | "canary_cycle_exhausted";

export interface TelegramCanaryCounts {
  total: number;
  hourly: number;
  cycle: number;
}

export interface TelegramCanaryDecision {
  allowed: boolean;
  reason: "allowed" | TelegramCanaryBlockReason;
  counts: TelegramCanaryCounts;
  cycleStart: string | null;
  hourStart: string | null;
}

interface TelegramCanaryRow {
  total: number | string | null;
  hourly: number | string | null;
  cycle: number | string | null;
}

export interface TelegramCanaryRuntimeConfig {
  telegramCanaryEnabled: boolean;
  telegramCanaryStartAt: string;
  telegramCanaryMaxPerCycle: number;
  telegramCanaryMaxPerHour: number;
  telegramCanaryMaxTotal: number;
}

function emptyCounts(): TelegramCanaryCounts {
  return { total: 0, hourly: 0, cycle: 0 };
}

function asCount(value: number | string | null): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function cycleStartFor(nowMs: number): Date {
  return new Date(Math.floor(nowMs / FIVE_MINUTES_MS) * FIVE_MINUTES_MS);
}

/**
 * The canary cycle is the existing five-minute Radar intelligence cadence.
 * Publication history is the durable source of truth; failed attempts remain
 * counted because their row's updated_at is inside the canary period.
 */
export async function evaluateTelegramCanary(
  db: D1Database,
  config: TelegramCanaryRuntimeConfig,
  now = new Date()
): Promise<TelegramCanaryDecision> {
  if (!config.telegramCanaryEnabled) {
    return { allowed: true, reason: "canary_disabled", counts: emptyCounts(), cycleStart: null, hourStart: null };
  }

  const startMs = Date.parse(config.telegramCanaryStartAt);
  if (!Number.isFinite(startMs) || config.telegramCanaryStartAt.trim() === "") {
    return { allowed: false, reason: "canary_configuration_invalid", counts: emptyCounts(), cycleStart: null, hourStart: null };
  }
  if (![config.telegramCanaryMaxPerCycle, config.telegramCanaryMaxPerHour, config.telegramCanaryMaxTotal]
    .every((value) => Number.isInteger(value) && value > 0)) {
    return { allowed: false, reason: "canary_configuration_invalid", counts: emptyCounts(), cycleStart: null, hourStart: null };
  }

  const cycleStart = cycleStartFor(now.getTime());
  const cycleEnd = new Date(cycleStart.getTime() + FIVE_MINUTES_MS);
  const hourStart = new Date(now.getTime() - HOUR_MS);
  const startAt = new Date(startMs).toISOString();
  const cycleStartIso = cycleStart.toISOString();
  const cycleEndIso = cycleEnd.toISOString();
  const hourStartIso = hourStart.toISOString();

  try {
    const row = await db.prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN MAX(COALESCE(published_at, ''), COALESCE(updated_at, '')) >= ? THEN 1 ELSE 0 END), 0) AS hourly,
         COALESCE(SUM(CASE WHEN MAX(COALESCE(published_at, ''), COALESCE(updated_at, '')) >= ?
                                AND MAX(COALESCE(published_at, ''), COALESCE(updated_at, '')) < ? THEN 1 ELSE 0 END), 0) AS cycle
       FROM published_stories
       WHERE MAX(COALESCE(published_at, ''), COALESCE(updated_at, '')) >= ?`
    ).bind(hourStartIso, cycleStartIso, cycleEndIso, startAt).first<TelegramCanaryRow>();
    const counts = {
      total: asCount(row?.total ?? null),
      hourly: asCount(row?.hourly ?? null),
      cycle: asCount(row?.cycle ?? null)
    };
    if (counts.total === null || counts.hourly === null || counts.cycle === null) {
      return { allowed: false, reason: "canary_state_unavailable", counts: emptyCounts(), cycleStart: cycleStartIso, hourStart: hourStartIso };
    }

    const normalizedCounts = counts as TelegramCanaryCounts;
    if (normalizedCounts.total >= config.telegramCanaryMaxTotal) {
      return { allowed: false, reason: "canary_total_exhausted", counts: normalizedCounts, cycleStart: cycleStartIso, hourStart: hourStartIso };
    }
    if (normalizedCounts.hourly >= config.telegramCanaryMaxPerHour) {
      return { allowed: false, reason: "canary_hour_exhausted", counts: normalizedCounts, cycleStart: cycleStartIso, hourStart: hourStartIso };
    }
    if (normalizedCounts.cycle >= config.telegramCanaryMaxPerCycle) {
      return { allowed: false, reason: "canary_cycle_exhausted", counts: normalizedCounts, cycleStart: cycleStartIso, hourStart: hourStartIso };
    }
    return { allowed: true, reason: "allowed", counts: normalizedCounts, cycleStart: cycleStartIso, hourStart: hourStartIso };
  } catch {
    return { allowed: false, reason: "canary_state_unavailable", counts: emptyCounts(), cycleStart: cycleStartIso, hourStart: hourStartIso };
  }
}

export function telegramCanaryConfig(config: RuntimeConfig): TelegramCanaryRuntimeConfig {
  return {
    telegramCanaryEnabled: config.telegramCanaryEnabled,
    telegramCanaryStartAt: config.telegramCanaryStartAt,
    telegramCanaryMaxPerCycle: config.telegramCanaryMaxPerCycle,
    telegramCanaryMaxPerHour: config.telegramCanaryMaxPerHour,
    telegramCanaryMaxTotal: config.telegramCanaryMaxTotal
  };
}
