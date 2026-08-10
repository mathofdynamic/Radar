import { generateImage } from "../intelligence/ai";
import type { GeneratedImageMimeType } from "../intelligence/ai";
import type { StoryDraft } from "../types";

export interface CoverArtifact {
  reference: string;
  mimeType: GeneratedImageMimeType;
  bytes: ArrayBuffer;
}

/**
 * Create an optional cover in memory. A missing result is intentional: the
 * publisher sends the story as text-only instead of inventing a replacement
 * graphic.
 */
export async function createCover(env: Env, story: StoryDraft): Promise<CoverArtifact | null> {
  const prompt = `Editorial illustration, not documentary photography. Radar news identity. Category: ${story.category}. Concept: ${story.coverConcept}. No readable text. Symbolic, restrained, high contrast, Persian news channel cover.`;
  const generated = await generateImage(env, prompt);
  if (!generated) {
    console.warn(JSON.stringify({
      event: "ai_cover_unavailable",
      event_id: story.eventId,
      event_version: story.eventVersion,
      action: "publish_text_only"
    }));
    return null;
  }
  return {
    reference: `ai-generated:events/${story.eventId}/v${story.eventVersion}`,
    mimeType: generated.mimeType,
    bytes: generated.bytes
  };
}
