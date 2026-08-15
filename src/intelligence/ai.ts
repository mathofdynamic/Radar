import { z, type ZodType } from "zod";
import { readBoundedText } from "../crypto";
import { runtimeConfig } from "../config";
import { intelligenceBatchJsonSchema } from "../contracts";
import { incrementCounter, reserveNebulaCall, reserveWorkersAiCall } from "../db";
import type { JsonObject } from "../types";

export type GeneratedImageMimeType = "image/png" | "image/jpeg";
export type NebulaStage = "intelligence" | "intelligence_second_pass" | "stage1" | "stage2";

export interface GeneratedImage {
  bytes: ArrayBuffer;
  mimeType: GeneratedImageMimeType;
}

export interface NebulaUsage {
  requestedModel: string;
  model: string;
  provider: string | null;
  routedModel: string | null;
  fallbackAttempts: number;
  requestId: string | null;
  status: number | null;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  logicalAttempt: number;
  logicalRetry: boolean;
}

export interface NebulaJsonResult<T> {
  data: T;
  usage: NebulaUsage;
}

export class NebulaError extends Error {
  readonly status: number | null;
  readonly telemetry: NebulaTelemetry | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null = null, telemetry: NebulaTelemetry | null = null, retryable = false) {
    super(message);
    this.name = "NebulaError";
    this.status = status;
    this.telemetry = telemetry;
    this.retryable = retryable;
  }
}

export interface NebulaTelemetry {
  requestedModel: string;
  provider: string | null;
  routedModel: string | null;
  fallbackAttempts: number;
  requestId: string | null;
  status: number | null;
  latencyMs: number;
  logicalAttempt: number;
  logicalRetry: boolean;
}

export interface NebulaRequestOptions {
  responseSchema?: Record<string, unknown>;
}

const nebulaJsonSchema = z.record(z.unknown());

export async function generateNebulaJson<T>(
  env: Env,
  stage: NebulaStage,
  systemPrompt: string,
  userPrompt: string,
  schema: ZodType<T>,
  maxTokens = 1_600,
  options: NebulaRequestOptions = {}
): Promise<NebulaJsonResult<T> | null> {
  const config = runtimeConfig(env);
  const apiKey = env.NEBULA_API_KEY?.trim();
  if (!apiKey) throw new NebulaError("nebula_api_key_missing");

  const isIntelligence = stage === "intelligence" || stage === "intelligence_second_pass";
  const requestedModel = isIntelligence ? config.nebulaIntelligenceModel : config.nebulaEditorialModel;
  const timeoutMs = isIntelligence ? config.nebulaIntelligenceTimeoutMs : config.nebulaEditorialTimeoutMs;

  const maxCalls = stage === "intelligence"
    ? config.maxIntelligenceBatchesPerDay
    : stage === "intelligence_second_pass"
      ? config.maxIntelligenceSecondPassCallsPerDay
      : stage === "stage1"
        ? config.maxStage1CallsPerDay
        : config.maxStage2CallsPerDay;
  const maxLogicalAttempts = isIntelligence ? 2 : 1;
  for (let logicalAttempt = 1; logicalAttempt <= maxLogicalAttempts; logicalAttempt += 1) {
    const reserved = await reserveNebulaCall(env.DB, stage, maxCalls);
    if (!reserved) {
      if (logicalAttempt > 1) await safeIncrementCounter(env.DB, "nebula_logical_retry_failures");
      return null;
    }
    await safeIncrementCounter(env.DB, "intelligence_ai_calls");
    if (stage === "intelligence_second_pass") await safeIncrementCounter(env.DB, "intelligence_second_pass_calls");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    let telemetry: NebulaTelemetry = {
      requestedModel,
      provider: null,
      routedModel: null,
      fallbackAttempts: 0,
      requestId: null,
      status: null,
      latencyMs: 0,
      logicalAttempt,
      logicalRetry: logicalAttempt > 1
    };
    try {
      const response = await fetch(`${config.nebulaBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: requestedModel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: isIntelligence
            ? {
                type: "json_schema",
                json_schema: {
                  name: "radar_intelligence_batch",
                  strict: true,
                  schema: options.responseSchema ?? intelligenceBatchJsonSchema
                }
              }
            : { type: "json_object" },
          temperature: 0.1,
          max_tokens: maxTokens
        }),
        signal: controller.signal
      });
      telemetry = readNebulaTelemetry(response, requestedModel, startedAt, logicalAttempt);
      const responseText = await readBoundedText(response, 2_000_000);
      if (!response.ok) {
        throw new NebulaError(
          `nebula_http_${response.status}`,
          response.status,
          telemetry,
          isTransientGatewayStatus(response.status)
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(responseText) as unknown;
      } catch {
        throw new NebulaError("nebula_response_not_json", response.status, telemetry);
      }
      const parsed = schema.safeParse(parseStructuredAiResult(body));
      if (!parsed.success) throw new NebulaError(`nebula_schema_invalid:${parsed.error.issues[0]?.message ?? "unknown"}`, response.status, telemetry);

      const responseObject = isJsonObject(body) ? body : {};
      const usage = isJsonObject(responseObject.usage) ? responseObject.usage : {};
      const responseModel = getString(responseObject.model);
      if (logicalAttempt > 1) await safeIncrementCounter(env.DB, "nebula_logical_retry_successes");
      return {
        data: parsed.data,
        usage: {
          ...telemetry,
          model: responseModel ?? telemetry.routedModel ?? requestedModel,
          promptTokens: getNumber(usage.prompt_tokens),
          completionTokens: getNumber(usage.completion_tokens)
        }
      };
    } catch (error) {
      await safeIncrementCounter(env.DB, "intelligence_ai_failures");
      const normalized = error instanceof NebulaError
        ? error
        : new NebulaError(
          error instanceof Error ? error.message : "nebula_request_failed",
          null,
          { ...telemetry, latencyMs: Date.now() - startedAt },
          isTransientTransportError(error)
        );
      if (logicalAttempt < maxLogicalAttempts && normalized.retryable) {
        await safeIncrementCounter(env.DB, "nebula_logical_retries");
        await waitForLogicalRetry();
        continue;
      }
      if (logicalAttempt > 1) await safeIncrementCounter(env.DB, "nebula_logical_retry_failures");
      if (normalized.telemetry) {
        console.warn(JSON.stringify({
          event: "nebula_request_failed",
          stage,
          error: normalized.message.slice(0, 240),
          ...normalized.telemetry
        }));
      }
      throw normalized;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  throw new NebulaError("nebula_logical_retry_exhausted");
}

function readNebulaTelemetry(response: Response, requestedModel: string, startedAt: number, logicalAttempt: number): NebulaTelemetry {
  const routedVia = response.headers.get("x-routed-via");
  const route = parseRoutedVia(routedVia);
  return {
    requestedModel,
    provider: route.provider,
    routedModel: route.model,
    fallbackAttempts: parseNonNegativeInteger(response.headers.get("x-fallback-attempts")),
    requestId: response.headers.get("x-request-id"),
    status: response.status,
    latencyMs: Date.now() - startedAt,
    logicalAttempt,
    logicalRetry: logicalAttempt > 1
  };
}

function isTransientGatewayStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isTransientTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  return error.name !== "AbortError" && error.name !== "TimeoutError";
}

async function waitForLogicalRetry(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
}

export function parseRoutedVia(value: string | null): { provider: string | null; model: string | null } {
  const route = value?.trim();
  if (!route) return { provider: null, model: null };
  const slash = route.indexOf("/");
  if (slash < 0) return { provider: route, model: null };
  return {
    provider: route.slice(0, slash) || null,
    model: route.slice(slash + 1) || null
  };
}

function parseNonNegativeInteger(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function generateStructuredText(env: Env, prompt: string, stage: "stage1" | "stage2"): Promise<JsonObject | null> {
  const systemPrompt = "You are a strict Persian-language news editor. Return exactly one valid JSON object. Keep all facts inside the supplied evidence, write title and description in Persian script, and never invent confirmation counts or identifiers.";
  try {
    const result = await generateNebulaJson(env, stage, systemPrompt, prompt.slice(0, 12_000), nebulaJsonSchema, 900);
    return result?.data ?? null;
  } catch (error) {
    console.error(JSON.stringify({ event: "nebula_structured_text_failed", stage, error: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

export async function generateImage(env: Env, prompt: string): Promise<GeneratedImage | null> {
  const config = runtimeConfig(env);
  const allowed = await reserveWorkersAiCall(env.DB, "cover", config.maxCoversPerDay, 500, config.aiDailyNeuronBudget);
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
  if (isJsonObject(value.result)) {
    if (isJsonObject(value.result.response)) return value.result.response;
    return value.result;
  }

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const firstChoice = choices[0];
  if (isJsonObject(firstChoice) && isJsonObject(firstChoice.message)) {
    const content = firstChoice.message.content;
    if (isJsonObject(content)) return content;
    if (typeof content === "string") return parseJsonText(content);
    if (Array.isArray(content)) {
      const text = content
        .filter(isJsonObject)
        .map((part) => typeof part.text === "string" ? part.text : "")
        .join("");
      if (text) return parseJsonText(text);
    }
  }

  const text = extractText(value);
  return text ? parseJsonText(text) : null;
}

function extractText(value: JsonObject): string | null {
  if (typeof value.response === "string") return value.response;
  if (typeof value.result === "string") return value.result;
  if (isJsonObject(value.result) && typeof value.result.response === "string") return value.result.response;
  return null;
}

function parseJsonText(value: string): JsonObject | null {
  const cleaned = value.replace(/^\s*```(?:json)?\s*/iu, "").replace(/\s*```\s*$/u, "").trim();
  try {
    const direct: unknown = JSON.parse(cleaned);
    if (isJsonObject(direct)) return direct;
  } catch {
    // Fall through to the bounded object extraction for accidental prose.
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const extracted: unknown = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    return isJsonObject(extracted) ? extracted : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof value === "object" && value !== null && "getReader" in value && typeof value.getReader === "function";
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function safeIncrementCounter(db: D1Database, metric: string): Promise<void> {
  try {
    await incrementCounter(db, metric);
  } catch (error) {
    console.warn(JSON.stringify({ event: "counter_increment_skipped", metric, error: error instanceof Error ? error.message : "unknown" }));
  }
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
