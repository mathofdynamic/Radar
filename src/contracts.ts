import { z } from "zod";

const jsonObjectSchema = z.record(z.unknown());

export const polledPostSchema = z.object({
  sourceId: z.number().int().positive(),
  sourceKey: z.string().min(1),
  username: z.string().min(1),
  messageId: z.number().int().positive(),
  canonicalUrl: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
  editedAt: z.string().datetime({ offset: true }).nullable(),
  text: z.string().max(200_000),
  mediaType: z.string().max(64).nullable(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawHtmlSnippet: z.string().max(12_000),
  metadata: jsonObjectSchema
});

export const telegramWebPollEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  transport: z.literal("telegram_public_web"),
  sourceId: z.number().int().positive(),
  sourceKey: z.string().min(1),
  externalMessageId: z.number().int().positive(),
  updateType: z.enum(["create", "edit", "delete"]),
  observedAt: z.string().datetime({ offset: true }),
  post: polledPostSchema
});

export const storyDraftSchema = z.object({
  eventId: z.number().int().positive(),
  eventVersion: z.number().int().positive(),
  title: z.string().min(1).max(180),
  description: z.string().min(1).max(1_000),
  verificationStatus: z.enum(["CONFIRMED", "DEVELOPING", "DISPUTED", "UNVERIFIED"]),
  independentConfirmations: z.number().int().nonnegative(),
  primarySources: z.array(z.object({ name: z.string().min(1), url: z.string().url() })).max(5),
  category: z.string().min(1).max(32),
  tags: z.array(z.string().min(1).max(64)).max(8),
  links: z.array(z.object({ label: z.string().min(1).max(64), url: z.string().url() })).max(5),
  coverConcept: z.string().min(1).max(500)
});

export const aiEditorialOutputSchema = z.object({
  publish_recommendation: z.enum(["PUBLISH", "MONITOR", "IGNORE"]),
  importance_adjustment: z.number().min(-20).max(20).default(0),
  reason: z.string().max(500),
  category: z.string().max(32).optional(),
  is_breaking_candidate: z.boolean().default(false)
});

export type TelegramWebPollEnvelopeInput = z.infer<typeof telegramWebPollEnvelopeSchema>;

export function parseEnvelope(input: unknown): TelegramWebPollEnvelopeInput {
  return telegramWebPollEnvelopeSchema.parse(input);
}
