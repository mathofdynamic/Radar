export interface RuntimeConfig {
  destinationChatId: string;
  destinationUrl: string;
  publishEnabled: boolean;
  pollBatchSize: number;
  pollIntervalSeconds: number;
  maxHtmlBytes: number;
  nebulaBaseUrl: string;
  nebulaIntelligenceModel: string;
  nebulaEditorialModel: string;
  nebulaIntelligenceTimeoutMs: number;
  nebulaEditorialTimeoutMs: number;
  intelligenceMaxReportsPerBatch: number;
  intelligenceMaxActiveEvents: number;
  intelligenceMaxPayloadChars: number;
  intelligenceMaxReportChars: number;
  intelligenceAmbiguityThreshold: number;
  maxIntelligenceBatchesPerDay: number;
  maxIntelligenceSecondPassCallsPerDay: number;
  imageModel: string;
  aiDailyNeuronBudget: number;
  maxStage1CallsPerDay: number;
  maxStage2CallsPerDay: number;
  maxCoversPerDay: number;
  editorialMinScore: number;
  breakingScore: number;
  dailyStoryBudget: number;
  busyDayStoryBudget: number;
}

function numberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function runtimeConfig(env: Env): RuntimeConfig {
  const legacyModel = env.NEBULA_MODEL || "auto";
  const legacyTimeout = numberSetting(env.NEBULA_TIMEOUT_MS, 25_000);
  return {
    destinationChatId: env.RADAR_DESTINATION_CHAT_ID,
    destinationUrl: env.RADAR_DESTINATION_URL,
    publishEnabled: String(env.PUBLISH_ENABLED) === "true",
    pollBatchSize: Math.max(1, Math.min(10, numberSetting(env.POLL_BATCH_SIZE, 5))),
    pollIntervalSeconds: Math.max(60, numberSetting(env.POLL_INTERVAL_SECONDS, 300)),
    maxHtmlBytes: Math.max(64_000, numberSetting(env.MAX_HTML_BYTES, 524_288)),
    nebulaBaseUrl: (env.NEBULA_BASE_URL || "https://nebula-free-llm.nebula-ai-company.workers.dev/v1").replace(/\/+$/u, ""),
    nebulaIntelligenceModel: env.NEBULA_INTELLIGENCE_MODEL || "radar-fast",
    nebulaEditorialModel: env.NEBULA_EDITORIAL_MODEL || legacyModel,
    nebulaIntelligenceTimeoutMs: Math.max(5_000, Math.min(95_000, numberSetting(env.NEBULA_INTELLIGENCE_TIMEOUT_MS, 95_000))),
    nebulaEditorialTimeoutMs: Math.max(5_000, Math.min(55_000, numberSetting(env.NEBULA_EDITORIAL_TIMEOUT_MS, legacyTimeout))),
    intelligenceMaxReportsPerBatch: Math.max(1, Math.min(40, numberSetting(env.INTELLIGENCE_MAX_REPORTS_PER_BATCH, 32))),
    intelligenceMaxActiveEvents: Math.max(1, Math.min(100, numberSetting(env.INTELLIGENCE_MAX_ACTIVE_EVENTS, 40))),
    intelligenceMaxPayloadChars: Math.max(8_000, Math.min(120_000, numberSetting(env.INTELLIGENCE_MAX_PAYLOAD_CHARS, 60_000))),
    intelligenceMaxReportChars: Math.max(400, Math.min(4_000, numberSetting(env.INTELLIGENCE_MAX_REPORT_CHARS, 1_800))),
    intelligenceAmbiguityThreshold: Math.max(0, Math.min(1, numberSetting(env.INTELLIGENCE_AMBIGUITY_THRESHOLD, 0.72))),
    maxIntelligenceBatchesPerDay: Math.max(1, numberSetting(env.MAX_INTELLIGENCE_BATCHES_PER_DAY, 500)),
    maxIntelligenceSecondPassCallsPerDay: Math.max(0, numberSetting(env.MAX_INTELLIGENCE_SECOND_PASS_CALLS_PER_DAY, 100)),
    imageModel: env.AI_IMAGE_MODEL,
    aiDailyNeuronBudget: numberSetting(env.AI_DAILY_NEURON_BUDGET, 8_000),
    maxStage1CallsPerDay: numberSetting(env.MAX_STAGE1_CALLS_PER_DAY, 250),
    maxStage2CallsPerDay: numberSetting(env.MAX_STAGE2_CALLS_PER_DAY, 40),
    maxCoversPerDay: numberSetting(env.MAX_COVERS_PER_DAY, 10),
    editorialMinScore: numberSetting(env.EDITORIAL_MIN_SCORE, 78),
    breakingScore: numberSetting(env.BREAKING_SCORE, 90),
    dailyStoryBudget: numberSetting(env.DAILY_STORY_BUDGET, 15),
    busyDayStoryBudget: numberSetting(env.BUSY_DAY_STORY_BUDGET, 25)
  };
}
