import { runtimeConfig } from "../config";
import { reserveAiCall } from "../db";
import type { JsonObject } from "../types";

export type GeneratedImageMimeType = "image/png" | "image/jpeg";

export interface GeneratedImage {
  bytes: ArrayBuffer;
  mimeType: GeneratedImageMimeType;
}

export async function generateEmbedding(env: Env, text: string): Promise<number[] | null> {
  const config = runtimeConfig(env);
  const allowed = await reserveAiCall(env.DB, "embedding", config.maxEmbeddingsPerDay, 12, config.aiDailyNeuronBudget);
  if (!allowed) return null;
  try {
    const result = await env.AI.run(config.embeddingModel, { text: [text.slice(0, 4_000)] });
    if (isNumberArray(result)) return result;
    if (isEmbeddingResult(result)) return result.data[0] ?? null;
    return null;
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_embedding_failed", error: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

export async function generateStructuredText(env: Env, prompt: string, stage: "stage1" | "stage2"): Promise<JsonObject | null> {
  const config = runtimeConfig(env);
  const maxCalls = stage === "stage1" ? config.maxStage1CallsPerDay : config.maxStage2CallsPerDay;
  const allowed = await reserveAiCall(env.DB, stage, maxCalls, stage === "stage1" ? 40 : 120, config.aiDailyNeuronBudget);
  if (!allowed) return null;
  try {
    const result = await env.AI.run(config.textModel, {
      messages: [
        { role: "system", content: "You are a Persian-language news editor. Return one valid JSON object only. The title and description must always be written in Persian script. Translate English evidence into Persian; never copy an English sentence. Do not use Markdown fences. Do not invent facts." },
        { role: "user", content: prompt.slice(0, 8_000) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 600
    });
    return parseStructuredAiResult(result);
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_structured_text_failed", stage, error: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

export async function generateImage(env: Env, prompt: string): Promise<GeneratedImage | null> {
  const config = runtimeConfig(env);
  const allowed = await reserveAiCall(env.DB, "cover", config.maxCoversPerDay, 500, config.aiDailyNeuronBudget);
  if (!allowed) {
    console.info(JSON.stringify({ event: "ai_image_skipped", reason: "daily_budget_exhausted", model: config.imageModel }));
    return null;
  }
  try {
    const form = new FormData();
    form.append("prompt", prompt.slice(0, 1_000));
    form.append("width", "640");
    form.append("height", "360");
    const multipartResponse = new Response(form);
    const contentType = multipartResponse.headers.get("content-type");
    if (!multipartResponse.body || !contentType) return null;
    const result = await env.AI.run(config.imageModel, {
      multipart: {
        body: multipartResponse.body,
        contentType
      }
    });
    if (isJsonObject(result) && typeof result.image === "string") return decodeBase64Image(result.image);
    if (result instanceof ArrayBuffer) return identifyImage(result);
    if (result instanceof Uint8Array) {
      const copy = new Uint8Array(result.byteLength);
      copy.set(result);
      return identifyImage(copy.buffer);
    }
    if (isReadableStream(result)) {
      const bytes = await new Response(result).arrayBuffer();
      return identifyImage(bytes);
    }
    console.error(JSON.stringify({ event: "ai_image_invalid", model: config.imageModel, reason: "unsupported_response" }));
    return null;
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_image_failed", error: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

export function parseStructuredAiResult(value: unknown): JsonObject | null {
  if (!isJsonObject(value)) return null;

  if (isJsonObject(value.response)) return value.response;
  if (isJsonObject(value.result)) return value.result;
  if (isJsonObject(value.result) && isJsonObject(value.result.response)) return value.result.response;

  const text = extractText(value);
  if (!text) return null;
  const cleaned = stripMarkdownFence(text).trim();
  const direct = tryParseJson(cleaned);
  if (direct) return direct;

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return tryParseJson(cleaned.slice(firstBrace, lastBrace + 1));
  return null;
}

function extractText(value: JsonObject): string | null {
  if (typeof value.response === "string") return value.response;
  if (typeof value.result === "string") return value.result;
  if (isJsonObject(value.result) && typeof value.result.response === "string") return value.result.response;
  return null;
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "");
}

function tryParseJson(value: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isEmbeddingResult(value: unknown): value is { data: number[][] } {
  return isJsonObject(value) && Array.isArray(value.data) && value.data.every((row) => isNumberArray(row));
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && "getReader" in value && typeof value.getReader === "function";
}

function decodeBase64Image(value: string): GeneratedImage | null {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  try {
    const binary = atob(encoded.replace(/\s+/gu, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return identifyImage(bytes.buffer);
  } catch {
    return null;
  }
}

function identifyImage(bytes: ArrayBuffer): GeneratedImage | null {
  const mimeType = detectImageMimeType(bytes);
  return mimeType ? { bytes, mimeType } : null;
}

export function detectImageMimeType(bytes: ArrayBuffer): GeneratedImageMimeType | null {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 12));
  const isPng = header.length >= 8 && header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71 && header[4] === 13 && header[5] === 10 && header[6] === 26 && header[7] === 10;
  if (isPng) return "image/png";

  const isJpeg = header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (isJpeg) return "image/jpeg";

  return null;
}
