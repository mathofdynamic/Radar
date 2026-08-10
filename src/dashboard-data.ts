import { isPublishingEnabled } from "./db";

interface DashboardSource {
  id: number;
  sourceKey: string;
  name: string;
  username: string;
  category: string;
  priorityTier: string;
  isActive: boolean;
  healthStatus: string;
  lastPolledAt: string | null;
  nextPollAt: string | null;
  lastSeenMessageId: number | null;
  lastError: string | null;
}

interface DashboardPost {
  id: number;
  sourceId: number;
  sourceName: string;
  username: string;
  sourceCategory: string;
  messageId: number;
  canonicalUrl: string;
  updateType: string;
  publishedAt: string | null;
  editedAt: string | null;
  observedAt: string;
  originalText: string;
  normalizedText: string;
  mediaType: string | null;
  isNoise: boolean;
  noiseReason: string | null;
  processingStatus: string;
}

interface DashboardEvent {
  id: number;
  title: string;
  coreFact: string;
  category: string;
  verificationStatus: string;
  importanceScore: number;
  sourceCount: number;
  independentConfirmations: number;
  firstSeenAt: string;
  lastUpdatedAt: string;
  eventVersion: number;
}

interface DashboardStory {
  id: number;
  eventId: number;
  eventVersion: number;
  publishedAt: string | null;
  title: string;
  description: string;
  verificationStatus: string;
  publicationState: string;
  telegramMessageId: number | null;
  lastError: string | null;
  category: string;
  createdAt: string;
}

interface DashboardCandidate {
  eventId: number;
  eventVersion: number;
  title: string;
  decision: string;
  score: number;
  status: string;
  createdAt: string;
}

interface DashboardActivity {
  id: string;
  kind: "poll" | "post" | "event" | "publish" | "source";
  timestamp: string;
  title: string;
  detail: string;
  tone: "lime" | "cyan" | "amber" | "coral" | "muted";
  url?: string;
}

export interface DashboardSnapshot {
  generatedAt: string;
  system: {
    environment: string;
    destinationUrl: string;
    destinationChatId: string;
    publishingEnabled: boolean;
    today: string;
  };
  overview: {
    sourcesTotal: number;
    sourcesActive: number;
    sourcesDegraded: number;
    latestPollAt: string | null;
    postsObserved: number;
    rawPostsPersisted: number;
    eventsCreated: number;
    eventsScored: number;
    storiesPublished: number;
    pollEnvelopesQueued: number;
    queueFailures: number;
    aiCalls: number;
    aiNeurons: number;
  };
  sources: DashboardSource[];
  posts: DashboardPost[];
  events: DashboardEvent[];
  stories: DashboardStory[];
  candidates: DashboardCandidate[];
  activity: DashboardActivity[];
  counters: Array<{ metric: string; value: number }>;
  aiUsage: Array<{ stage: string; calls: number; estimatedNeurons: number }>;
}

interface SourceQueryRow {
  id: number;
  source_key: string;
  name: string;
  telegram_username: string;
  category: string;
  priority_tier: string;
  is_active: number;
  health_status: string;
  last_polled_at: string | null;
  next_poll_at: string | null;
  last_seen_message_id: number | null;
  last_error: string | null;
}

interface PostQueryRow {
  id: number;
  source_id: number;
  source_name: string;
  telegram_username: string;
  source_category: string;
  telegram_message_id: number;
  canonical_url: string;
  update_type: string;
  published_at: string | null;
  edited_at: string | null;
  observed_at: string;
  original_text: string;
  normalized_text: string;
  media_type: string | null;
  is_noise: number;
  noise_reason: string | null;
  processing_status: string;
}

interface EventQueryRow {
  id: number;
  canonical_title: string | null;
  core_fact: string;
  category: string;
  verification_status: string;
  importance_score: number;
  source_count: number;
  independent_confirmation_count: number;
  first_seen_at: string;
  last_updated_at: string;
  event_version: number;
}

interface StoryQueryRow {
  id: number;
  event_id: number;
  event_version: number;
  published_at: string | null;
  title: string;
  description: string;
  verification_status: string;
  publication_state: string;
  telegram_message_id: number | null;
  last_error: string | null;
  category: string;
  created_at: string;
}

interface CandidateQueryRow {
  event_id: number;
  event_version: number;
  canonical_title: string | null;
  decision: string;
  score: number;
  status: string;
  created_at: string;
}

interface CounterQueryRow {
  metric: string;
  value: number;
}

interface AiQueryRow {
  stage: string;
  calls: number;
  estimated_neurons: number;
}

export async function dashboardSnapshot(env: Env): Promise<DashboardSnapshot> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const [sourceResult, postResult, eventResult, storyResult, candidateResult, counterResult, aiResult, publishingEnabled] = await Promise.all([
    env.DB.prepare(
      `SELECT id, source_key, name, telegram_username, category, priority_tier, is_active,
              health_status, last_polled_at, next_poll_at, last_seen_message_id, last_error
         FROM sources ORDER BY is_active DESC, health_status ASC, id ASC`
    ).all<SourceQueryRow>(),
    env.DB.prepare(
      `SELECT rp.id, rp.source_id, s.name AS source_name, s.telegram_username, s.category AS source_category,
              rp.telegram_message_id, rp.canonical_url, rp.update_type, rp.published_at, rp.edited_at,
              rp.observed_at, rp.original_text, rp.normalized_text, rp.media_type, rp.is_noise,
              rp.noise_reason, rp.processing_status
         FROM raw_posts rp JOIN sources s ON s.id = rp.source_id
        ORDER BY COALESCE(rp.published_at, rp.observed_at) DESC LIMIT 60`
    ).all<PostQueryRow>(),
    env.DB.prepare(
      `SELECT id, canonical_title, core_fact, category, verification_status, importance_score,
              source_count, independent_confirmation_count, first_seen_at, last_updated_at, event_version
         FROM events ORDER BY last_updated_at DESC LIMIT 40`
    ).all<EventQueryRow>(),
    env.DB.prepare(
      `SELECT id, event_id, event_version, published_at, title, description, verification_status,
              publication_state, telegram_message_id, last_error, category, created_at
         FROM published_stories ORDER BY COALESCE(published_at, created_at) DESC LIMIT 30`
    ).all<StoryQueryRow>(),
    env.DB.prepare(
      `SELECT ec.event_id, ec.event_version, e.canonical_title, ec.decision, ec.score, ec.status, ec.created_at
         FROM editorial_candidates ec JOIN events e ON e.id = ec.event_id
        ORDER BY ec.created_at DESC LIMIT 40`
    ).all<CandidateQueryRow>(),
    env.DB.prepare(
      "SELECT metric, value FROM operational_counters WHERE counter_date = ? ORDER BY metric"
    ).bind(today).all<CounterQueryRow>(),
    env.DB.prepare(
      "SELECT stage, calls, estimated_neurons FROM ai_usage WHERE usage_date = ? ORDER BY stage"
    ).bind(today).all<AiQueryRow>(),
    isPublishingEnabled(env.DB, String(env.PUBLISH_ENABLED) === "true")
  ]);

  const counters = counterResult.results;
  const counterMap = new Map(counters.map((row) => [row.metric, row.value]));
  const sources = sourceResult.results.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
    name: row.name,
    username: row.telegram_username,
    category: row.category,
    priorityTier: row.priority_tier,
    isActive: row.is_active === 1,
    healthStatus: row.health_status,
    lastPolledAt: row.last_polled_at,
    nextPollAt: row.next_poll_at,
    lastSeenMessageId: row.last_seen_message_id,
    lastError: row.last_error
  }));
  const posts = postResult.results.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    username: row.telegram_username,
    sourceCategory: row.source_category,
    messageId: row.telegram_message_id,
    canonicalUrl: row.canonical_url,
    updateType: row.update_type,
    publishedAt: row.published_at,
    editedAt: row.edited_at,
    observedAt: row.observed_at,
    originalText: truncate(row.original_text, 1_800),
    normalizedText: truncate(row.normalized_text, 1_800),
    mediaType: row.media_type,
    isNoise: row.is_noise === 1,
    noiseReason: row.noise_reason,
    processingStatus: row.processing_status
  }));
  const events = eventResult.results.map((row) => ({
    id: row.id,
    title: row.canonical_title || truncate(row.core_fact, 120),
    coreFact: truncate(row.core_fact, 300),
    category: row.category,
    verificationStatus: row.verification_status,
    importanceScore: Math.round(row.importance_score),
    sourceCount: row.source_count,
    independentConfirmations: row.independent_confirmation_count,
    firstSeenAt: row.first_seen_at,
    lastUpdatedAt: row.last_updated_at,
    eventVersion: row.event_version
  }));
  const stories = storyResult.results.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventVersion: row.event_version,
    publishedAt: row.published_at,
    title: row.title,
    description: truncate(row.description, 800),
    verificationStatus: row.verification_status,
    publicationState: row.publication_state,
    telegramMessageId: row.telegram_message_id,
    lastError: row.last_error,
    category: row.category,
    createdAt: row.created_at
  }));
  const candidates = candidateResult.results.map((row) => ({
    eventId: row.event_id,
    eventVersion: row.event_version,
    title: row.canonical_title || `Event ${row.event_id}`,
    decision: row.decision,
    score: Math.round(row.score),
    status: row.status,
    createdAt: row.created_at
  }));
  const aiUsage = aiResult.results.map((row) => ({ stage: row.stage, calls: row.calls, estimatedNeurons: row.estimated_neurons }));
  const activity = buildActivity(sources, posts, events, stories);
  const latestPollAt = sources
    .map((source) => source.lastPolledAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const aiCalls = aiUsage.reduce((total, row) => total + row.calls, 0);
  const aiNeurons = aiUsage.reduce((total, row) => total + row.estimatedNeurons, 0);

  return {
    generatedAt: now.toISOString(),
    system: {
      environment: env.ENVIRONMENT,
      destinationUrl: env.RADAR_DESTINATION_URL,
      destinationChatId: env.RADAR_DESTINATION_CHAT_ID,
      publishingEnabled,
      today
    },
    overview: {
      sourcesTotal: sources.length,
      sourcesActive: sources.filter((source) => source.isActive).length,
      sourcesDegraded: sources.filter((source) => source.healthStatus !== "healthy").length,
      latestPollAt,
      postsObserved: counterMap.get("posts_observed") ?? 0,
      rawPostsPersisted: counterMap.get("raw_posts_persisted") ?? 0,
      eventsCreated: counterMap.get("events_created") ?? 0,
      eventsScored: counterMap.get("events_scored") ?? 0,
      storiesPublished: counterMap.get("stories_published") ?? 0,
      pollEnvelopesQueued: counterMap.get("poll_envelopes_queued") ?? 0,
      queueFailures: counterMap.get("queue_failures") ?? 0,
      aiCalls,
      aiNeurons
    },
    sources,
    posts,
    events,
    stories,
    candidates,
    activity,
    counters,
    aiUsage
  };
}

function buildActivity(
  sources: DashboardSource[],
  posts: DashboardPost[],
  events: DashboardEvent[],
  stories: DashboardStory[]
): DashboardActivity[] {
  const activity: DashboardActivity[] = [];
  for (const post of posts.slice(0, 30)) {
    activity.push({
      id: `post-${post.id}`,
      kind: "post",
      timestamp: post.observedAt,
      title: `${post.sourceName} / message ${post.messageId}`,
      detail: truncate(post.originalText || "Media-only post", 180),
      tone: post.isNoise ? "muted" : "cyan",
      url: post.canonicalUrl
    });
  }
  for (const event of events.slice(0, 20)) {
    activity.push({
      id: `event-${event.id}-v${event.eventVersion}`,
      kind: "event",
      timestamp: event.lastUpdatedAt,
      title: `${event.verificationStatus} · ${event.title}`,
      detail: `${event.sourceCount} sources · score ${event.importanceScore}`,
      tone: event.verificationStatus === "CONFIRMED" ? "lime" : event.verificationStatus === "DISPUTED" ? "coral" : "amber"
    });
  }
  for (const story of stories.slice(0, 20)) {
    activity.push({
      id: `story-${story.id}`,
      kind: "publish",
      timestamp: story.publishedAt || story.createdAt,
      title: story.publicationState === "published" ? "Story published" : `Story ${story.publicationState}`,
      detail: truncate(story.lastError ? `${story.title} · ${story.lastError}` : story.title, 180),
      tone: story.publicationState === "published" ? "lime" : story.publicationState === "failed" ? "coral" : "amber"
    });
  }
  const sourceFailures = sources.filter((source) => source.lastError);
  for (const source of sourceFailures.slice(0, 10)) {
    activity.push({
      id: `source-${source.id}-${source.lastPolledAt || "unknown"}`,
      kind: "source",
      timestamp: source.lastPolledAt || new Date(0).toISOString(),
      title: `${source.name} · ${source.healthStatus}`,
      detail: truncate(source.lastError || "Source health changed", 180),
      tone: "coral"
    });
  }
  return activity.sort((left, right) => right.timestamp.localeCompare(left.timestamp)).slice(0, 60);
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}
