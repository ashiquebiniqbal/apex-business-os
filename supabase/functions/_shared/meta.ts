import { describeResponseShape, extractRefusalText, extractResponseText, incompleteReason, parseRetryAfterMs, stripJsonFences, truncate } from "./meta-response.ts";

export { describeResponseShape, extractRefusalText, extractResponseText, incompleteReason, parseRetryAfterMs, stripJsonFences, truncate };

export type MetaUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number;
  reasoning_tokens: number | null;
};

export type MetaResult<T> = {
  requestId: string;
  responseId: string | null;
  model: string;
  value: T;
  usage: MetaUsage;
  latencyMs: number;
};

export type MetaConfig = {
  apiKey: string;
  apiUrl: string;
  model: string;
};

export class MetaApiError extends Error {
  status: number | null;
  code: string | null;
  retryable: boolean;
  requestId: string;
  /** Milliseconds to wait before a retry, derived from Retry-After when the provider sends one. */
  retryAfterMs: number | null;
  /** Provider-supplied detail that is safe to show to the caller (refusal text, degraded status). */
  safeDetail: string | null;

  constructor(message: string, details: { status?: number | null; code?: string | null; retryable?: boolean; requestId: string; retryAfterMs?: number | null; safeDetail?: string | null }) {
    super(message);
    this.name = "MetaApiError";
    this.status = details.status ?? null;
    this.code = details.code ?? null;
    this.retryable = details.retryable ?? false;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs ?? null;
    this.safeDetail = details.safeDetail ?? null;
  }
}

export function getMetaConfig(): MetaConfig {
  const apiKey = Deno.env.get("META_API_KEY")?.trim();
  const apiUrl = (Deno.env.get("META_API_URL") ?? "https://api.meta.ai/v1/responses").trim().replace(/\/$/, "");
  const model = (Deno.env.get("META_MODEL") ?? "muse-spark-1.3").trim();
  if (!apiKey) throw new Error("META_API_KEY is not configured on the server");
  if (!model) throw new Error("META_MODEL is not configured on the server");
  const parsed = new URL(apiUrl);
  if (parsed.protocol !== "https:") throw new Error("META_API_URL must use HTTPS");
  if (!parsed.pathname.endsWith("/responses")) throw new Error("META_API_URL must point to the Meta Responses endpoint");
  return { apiKey, apiUrl, model };
}

export async function callMetaStructured<T>(args: {
  input: string;
  instructions: string;
  schemaName: string;
  schema: Record<string, unknown>;
  requestId: string;
  maxOutputTokens?: number;
  model?: string;
}): Promise<MetaResult<T>> {
  const config = getMetaConfig();
  const model = args.model ?? config.model;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: args.instructions,
        input: args.input,
        max_output_tokens: args.maxOutputTokens ?? 700,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: args.schemaName,
            strict: true,
            schema: args.schema,
          },
        },
      }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = body?.error ?? {};
      const retryable = response.status === 429 || response.status >= 500;
      throw new MetaApiError("Meta API request failed", {
        status: response.status,
        code: typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : null,
        retryable,
        retryAfterMs: retryable ? parseRetryAfterMs(response.headers.get("retry-after")) : null,
        safeDetail: typeof error.message === "string" ? truncate(error.message, 300) : null,
        requestId: args.requestId,
      });
    }
    if (body?.status === "failed" || body?.error) {
      throw new MetaApiError("Meta API response failed", { code: body?.error?.code ?? null, retryable: true, requestId: args.requestId });
    }
    const incomplete = incompleteReason(body);
    if (incomplete !== null) {
      // Never attempt to extract or parse partial JSON from an incomplete response.
      throw new MetaApiError(`Meta API returned an incomplete response (reason=${incomplete})`, {
        code: "meta_incomplete",
        safeDetail: `The model stopped before producing structured output (reason: ${incomplete}). This usually means the output limit was reached; narrow the inquiry or retry.`,
        requestId: args.requestId,
      });
    }
    const refusal = extractRefusalText(body);
    if (refusal) {
      throw new MetaApiError("Meta API refused the structured request", {
        code: "meta_refusal",
        safeDetail: `The model refused to answer: ${truncate(refusal, 500)}`,
        requestId: args.requestId,
      });
    }
    const text = extractResponseText(body);
    if (!text) {
      throw new MetaApiError(`Meta API returned no structured output (${describeResponseShape(body)})`, {
        code: "missing_structured_output",
        requestId: args.requestId,
      });
    }
    let value: T;
    try {
      value = JSON.parse(stripJsonFences(text)) as T;
    } catch {
      throw new MetaApiError("Meta API returned invalid JSON", { requestId: args.requestId });
    }
    return {
      requestId: args.requestId,
      responseId: typeof body.id === "string" ? body.id : null,
      model: typeof body.model === "string" ? body.model : model,
      value,
      usage: normalizeUsage(body.usage),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof MetaApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new MetaApiError("Meta API request timed out", { retryable: true, requestId: args.requestId });
    throw new MetaApiError("Meta API network request failed", { retryable: true, requestId: args.requestId });
  } finally {
    clearTimeout(timeout);
  }
}

export async function countMetaInputTokens(input: string, instructions: string, requestId: string, modelOverride?: string): Promise<number> {
  const config = getMetaConfig();
  const model = modelOverride ?? config.model;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(config.apiUrl.replace(/\/responses$/, "/responses/input_tokens"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: `${instructions}\n\n${input}` }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || typeof body?.input_tokens !== "number") throw new MetaApiError("Meta input token count failed", { status: response.status, retryable: response.status >= 500, requestId });
    return body.input_tokens;
  } catch (error) {
    if (error instanceof MetaApiError) throw error;
    throw new MetaApiError("Meta input token count failed", { retryable: true, requestId });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUsage(usage: any): MetaUsage {
  const input = numberOrZero(usage?.input_tokens);
  const output = numberOrZero(usage?.output_tokens);
  const total = numberOrZero(usage?.total_tokens) || input + output;
  return { input_tokens: input, output_tokens: output, total_tokens: total, cached_input_tokens: numberOrZero(usage?.input_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? usage?.cached_input_tokens), reasoning_tokens: numberOrNull(usage?.output_tokens_details?.reasoning_tokens) };
}

function numberOrZero(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
