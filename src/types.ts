export type JsonObject = Record<string, unknown>;

export type UpdateType = "create" | "edit" | "delete";
export type VerificationStatus = "CONFIRMED" | "DEVELOPING" | "DISPUTED" | "UNVERIFIED";
export type EventUpdateType = "NO_CHANGE" | "MINOR_UPDATE" | "MAJOR_UPDATE" | "CORRECTION" | "CONTRADICTION";
export type EditorialDecision = "PUBLISH" | "MONITOR" | "IGNORE";
export type SourceRole = "primary_source" | "authority_confirmation" | "breaking_radar" | "specialist" | "aggregator";
export type PriorityTier = "TIER_1" | "TIER_2" | "TIER_3";
export type IntelligenceAction =
  | "MATCH_EXISTING_EVENT"
  | "NEW_EVENT"
  | "DUPLICATE"
  | "UPDATE_EXISTING_EVENT"
  | "NOISE"
  | "UNCERTAIN";
export type EventCategory = "IRAN" | "WORLD" | "POLITICS" | "WAR_SECURITY" | "SOCIETY" | "ECONOMY" | "TECHNOLOGY";
export type IntelligenceBatchStatus = "queued" | "processing" | "completed" | "failed";

export interface SourceSeed {
  source_key: string;
  name: string;
  telegram_username: string;
  role: SourceRole;
  priority_tier: PriorityTier;
  category: string;
  language: string;
  source_type: string;
  trust_score: number;
  is_wire_origin: boolean;
}

export interface SourceRow extends SourceSeed {
  id: number;
  public_url: string;
  is_active: number;
  health_status: string;
  next_poll_at: string | null;
  last_seen_message_id: number | null;
  last_error: string | null;
}

export interface PolledPost {
  sourceId: number;
  sourceKey: string;
  username: string;
  messageId: number;
  canonicalUrl: string;
  publishedAt: string | null;
  editedAt: string | null;
  text: string;
  mediaType: string | null;
  contentHash: string;
  rawHtmlSnippet: string;
  metadata: JsonObject;
}

export interface TelegramWebPollEnvelope {
  schemaVersion: 1;
  transport: "telegram_public_web";
  sourceId: number;
  sourceKey: string;
  externalMessageId: number;
  updateType: UpdateType;
  observedAt: string;
  post: PolledPost;
}

export interface RawPostRow {
  id: number;
  source_id: number;
  telegram_message_id: number;
  canonical_url: string;
  update_type: UpdateType;
  published_at: string | null;
  edited_at: string | null;
  observed_at: string;
  language: string | null;
  original_text: string;
  normalized_text: string;
  content_hash: string;
  media_type: string | null;
  raw_html_snippet: string | null;
  raw_metadata_json: string;
  is_deleted: number;
  is_noise: number;
  noise_reason: string | null;
  processing_status: string;
  analysis_content_hash?: string | null;
  analysis_lease_at?: string | null;
  analysis_attempts?: number;
  created_at?: string;
  updated_at?: string;
}

export interface IntelligenceDecision {
  post_ids: number[];
  action: IntelligenceAction;
  event_id: number | null;
  duplicate_of_post_id: number | null;
  confidence: number;
  canonical_fact: string;
  category: EventCategory;
  reason: string;
}

export interface IntelligenceBatchRow {
  id: number;
  batch_key: string;
  window_start: string;
  window_end: string;
  batch_sequence: number;
  status: IntelligenceBatchStatus;
  report_count: number;
  model_requested: string;
  provider_used: string | null;
  attempts: number;
  prompt_tokens: number;
  completion_tokens: number;
  lease_at: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
}

export interface IntelligenceBatchItemRow {
  batch_id: number;
  raw_post_id: number;
  action: IntelligenceAction;
  event_id: number | null;
  duplicate_of_post_id: number | null;
  confidence: number;
  item_status: "claimed" | "applied" | "released";
  decision_json: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  canonical_title: string | null;
  core_fact: string;
  claims_json: string;
  category: string;
  verification_status: VerificationStatus;
  importance_score: number;
  confidence_score: number;
  novelty_score: number;
  iran_relevance_score: number;
  impact_score: number;
  urgency_score: number;
  geopolitical_score: number;
  subscores_json: string;
  first_seen_at: string;
  last_updated_at: string;
  event_state: string;
  event_version: number;
  source_count: number;
  independent_confirmation_count: number;
  originating_raw_post_id?: number | null;
}

export interface EventEvidence {
  event: EventRow;
  sourceName: string;
  sourceRole: SourceRole;
  sourceTier: PriorityTier;
  rawPost: RawPostRow;
  originType: string;
  originGroup: string;
}

export interface ScoreResult {
  impact: number;
  iranRelevance: number;
  urgency: number;
  confidence: number;
  novelty: number;
  geopoliticalSignificance: number;
  finalScore: number;
  band: "IGNORE" | "MONITOR" | "CANDIDATE" | "BREAKING";
  reasons: string[];
}

export interface EditorialCandidate {
  eventId: number;
  eventVersion: number;
  decision: EditorialDecision;
  score: number;
  reasons: string[];
}

export interface StoryDraft {
  eventId: number;
  eventVersion: number;
  title: string;
  description: string;
  verificationStatus: VerificationStatus;
  independentConfirmations: number;
  primarySources: Array<{ name: string; url: string }>;
  category: string;
  tags: string[];
  links: Array<{ label: string; url: string }>;
  coverConcept: string;
}

export interface PublishJob {
  eventId: number;
  eventVersion: number;
  publishKey: string;
  story: StoryDraft;
  mode?: "publish" | "edit";
  telegramMessageId?: number;
}

export type QueueName = "radar-raw-ingest" | "radar-event-analysis" | "radar-editorial" | "radar-publish";
