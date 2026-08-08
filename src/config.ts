export interface RuntimeConfig {
  destinationChatId: string;
  destinationUrl: string;
  publishEnabled: boolean;
  pollBatchSize: number;
  pollIntervalSeconds: number;
  maxHtmlBytes: number;
  embeddingModel: string;
  textModel: string;
  imageModel: string;
  aiDailyNeuronBudget: number;
  maxEmbeddingsPerDay: number;
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
  return {
    destinationChatId: env.RADAR_DESTINATION_CHAT_ID,
    destinationUrl: env.RADAR_DESTINATION_URL,
    publishEnabled: String(env.PUBLISH_ENABLED) === "true",
    pollBatchSize: Math.max(1, Math.min(2, numberSetting(env.POLL_BATCH_SIZE, 2))),
    pollIntervalSeconds: Math.max(300, numberSetting(env.POLL_INTERVAL_SECONDS, 900)),
    maxHtmlBytes: Math.max(64_000, numberSetting(env.MAX_HTML_BYTES, 524_288)),
    embeddingModel: env.AI_EMBEDDING_MODEL,
    textModel: env.AI_TEXT_MODEL,
    imageModel: env.AI_IMAGE_MODEL,
    aiDailyNeuronBudget: numberSetting(env.AI_DAILY_NEURON_BUDGET, 8_000),
    maxEmbeddingsPerDay: numberSetting(env.MAX_EMBEDDINGS_PER_DAY, 500),
    maxStage1CallsPerDay: numberSetting(env.MAX_STAGE1_CALLS_PER_DAY, 100),
    maxStage2CallsPerDay: numberSetting(env.MAX_STAGE2_CALLS_PER_DAY, 30),
    maxCoversPerDay: numberSetting(env.MAX_COVERS_PER_DAY, 10),
    editorialMinScore: numberSetting(env.EDITORIAL_MIN_SCORE, 78),
    breakingScore: numberSetting(env.BREAKING_SCORE, 90),
    dailyStoryBudget: numberSetting(env.DAILY_STORY_BUDGET, 15),
    busyDayStoryBudget: numberSetting(env.BUSY_DAY_STORY_BUDGET, 25)
  };
}
