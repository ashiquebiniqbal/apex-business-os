// Pure Responses-API parsing helpers shared by the Meta client and the test suite.
// This module intentionally references no Deno or Node globals so the Vite and
// vitest toolchains can import it directly.

/**
 * Extracts model-produced text from a Responses API body.
 * Supports the documented top-level `output_text` field, nested
 * `output[].content[]` items of type `output_text` (under any item type,
 * including `message` and `reasoning` wrappers), and plain string output.
 * Reasoning-only items without text content yield null so the caller can
 * report a precise missing-output error instead of fabricating content.
 */
export function extractResponseText(body: any): string | null {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text;
  if (typeof body?.output === "string" && body.output.trim()) return body.output;
  const parts: string[] = [];
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    if (typeof item?.text === "string" && item.text.trim()) parts.push(item.text);
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) parts.push(content.text);
    }
  }
  return parts.join("\n").trim() || null;
}

/** Extracts refusal text so refusals get their own actionable error instead of collapsing into missing-output. */
export function extractRefusalText(body: any): string | null {
  const parts: string[] = [];
  if (typeof body?.refusal === "string" && body.refusal.trim()) parts.push(body.refusal);
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "refusal" && typeof content.refusal === "string" && content.refusal.trim()) parts.push(content.refusal);
    }
  }
  return parts.join("\n").trim() || null;
}

/** Strips markdown code fences some models wrap around JSON payloads. The content itself is never altered. */
export function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (match ? match[1] : trimmed).trim();
}

/**
 * Bounded output allowance for inquiry analysis. The Responses API counts
 * reasoning tokens inside the output budget, so the previous 700-token cap
 * was consumed by reasoning before the strict JSON object could complete.
 * 3000 covers reasoning plus the compact structured schema while keeping the
 * per-request worst-case reservation small and budget-guarded.
 */
export const INQUIRY_MAX_OUTPUT_TOKENS = 3000;

/** Returns the incomplete reason when a Responses body stopped early, else null. */
export function incompleteReason(body: any): string | null {
  if (body?.status !== "incomplete") return null;
  return typeof body?.incomplete_details?.reason === "string" ? body.incomplete_details.reason : "unknown";
}

/** Reduced-output instruction for the single incomplete-response retry. */
export function conciseRetryInstructions(instructions: string): string {
  return `${instructions} Be concise: keep the summary under 40 words, return at most 3 product requirements, at most 3 items in each list, and do not repeat the inquiry text.`;
}

/** Parses Retry-After (delay seconds or HTTP date) into bounded milliseconds, or null when absent/unusable. */
export function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 30_000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, Math.min(dateMs - Date.now(), 30_000));
  return null;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function describeResponseShape(body: any): string {
  const status = typeof body?.status === "string" ? body.status : "unknown_status";
  const items = Array.isArray(body?.output) ? body.output : [];
  const itemTypes = items.map((item: any) => typeof item?.type === "string" ? item.type : "unknown").join(",") || "none";
  const contentTypes = items.flatMap((item: any) => Array.isArray(item?.content) ? item.content : []).map((content: any) => typeof content?.type === "string" ? content.type : "unknown").join(",") || "none";
  return `status=${status}; items=${itemTypes}; content=${contentTypes}`;
}
