import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { getMetaConfig } from "./meta.ts";

export type MetaCapability = "text_generation" | "reasoning" | "structured_extraction" | "document_analysis" | "vision" | "image_generation" | "audio_processing";
export type RoutingMode = "auto" | "manual";
export type QualityRequirement = "standard" | "high";
export type LatencyRequirement = "normal" | "low";

export type VerifiedMetaModel = {
  id: string;
  displayName: string;
  capabilities: MetaCapability[];
  endpoints: Partial<Record<MetaCapability, "responses" | "images" | "transcribe" | "media_segmentation">>;
  qualityRank: number;
  latencyRank: number;
  pricingModel: string | null;
  verifiedSource: string;
};

export type ModelPricing = {
  input_usd_per_million: number;
  cached_input_usd_per_million: number;
  output_usd_per_million: number;
};

export const VERIFIED_MODEL_REGISTRY: VerifiedMetaModel[] = [
  { id: "muse-wonder-1.0", displayName: "Muse Wonder 1.0", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 5, latencyRank: 3, pricingModel: null, verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-spark-1.3", displayName: "Muse Spark 1.3", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 4, latencyRank: 2, pricingModel: "muse-spark-1.3", verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-spark-1.2", displayName: "Muse Spark 1.2", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 3, latencyRank: 2, pricingModel: "muse-spark-1.2", verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-spark-1.1", displayName: "Muse Spark 1.1", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 2, latencyRank: 2, pricingModel: "muse-spark-1.1", verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-spark-1.3-contributor", displayName: "Muse Spark 1.3 Contributor", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 4, latencyRank: 2, pricingModel: "muse-spark-1.3-contributor", verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-spark-1.2-contributor", displayName: "Muse Spark 1.2 Contributor", capabilities: ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"], endpoints: { text_generation: "responses", reasoning: "responses", structured_extraction: "responses", document_analysis: "responses", vision: "responses", audio_processing: "responses" }, qualityRank: 3, latencyRank: 2, pricingModel: "muse-spark-1.2-contributor", verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-image-1.0", displayName: "Muse Image 1.0", capabilities: ["image_generation"], endpoints: { image_generation: "images" }, qualityRank: 4, latencyRank: 3, pricingModel: null, verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "muse-voice-transcribe-1.0", displayName: "Muse Voice Transcribe 1.0", capabilities: ["audio_processing"], endpoints: { audio_processing: "transcribe" }, qualityRank: 4, latencyRank: 2, pricingModel: null, verifiedSource: "https://dev.meta.ai/docs/models" },
  { id: "sam-3.1", displayName: "Segment Anything 3.1", capabilities: ["vision"], endpoints: { vision: "media_segmentation" }, qualityRank: 4, latencyRank: 3, pricingModel: null, verifiedSource: "https://dev.meta.ai/docs/models" },
];

type CatalogCache = { fetchedAt: number; modelIds: string[]; rawModels: Array<Record<string, unknown>> };
let catalogCache: CatalogCache | null = null;

export async function discoverMetaModels(opts?: { forceRefresh?: boolean }): Promise<{ status: "live" | "stale"; fetchedAt: number; modelIds: string[]; rawModels: Array<Record<string, unknown>>; error?: string }> {
  const refreshSeconds = Math.max(30, Number(Deno.env.get("META_MODEL_DISCOVERY_REFRESH_SECONDS") ?? 900));
  if (!opts?.forceRefresh && catalogCache && Date.now() - catalogCache.fetchedAt < refreshSeconds * 1000) return { status: "live", ...catalogCache };
  const config = getMetaConfig();
  const modelsUrl = config.apiUrl.replace(/\/responses\/?$/, "/models");
  try {
    const response = await fetch(modelsUrl, { headers: { Authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body?.data)) {
      // Surface only the HTTP status and provider error code/type — never the key or full body.
      const providerCode = typeof body?.error?.code === "string" ? body.error.code : typeof body?.error?.type === "string" ? body.error.type : "unexpected_response_shape";
      throw new Error(`Meta model catalog request failed (HTTP ${response.status}, ${providerCode})`);
    }
    const rawModels = body.data.filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    const modelIds = rawModels.map((item) => item.id).filter((id): id is string => typeof id === "string");
    catalogCache = { fetchedAt: Date.now(), modelIds, rawModels };
    return { status: "live", ...catalogCache };
  } catch (error) {
    if (catalogCache) return { status: "stale", ...catalogCache, error: error instanceof Error ? error.message : "Model discovery failed" };
    if (error instanceof Error && error.message.startsWith("Meta model catalog request failed")) throw error;
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) throw new Error("Meta model discovery is unavailable (request timed out after 10s)");
    throw new Error("Meta model discovery is unavailable (network request failed)");
  }
}

export async function loadRoutingSettings(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin.from("ai_model_routing_settings").select("mode,manual_model,updated_at,updated_by").eq("org_id", orgId).maybeSingle();
  if (error && !["42P01", "PGRST205"].includes(error.code ?? "")) throw error;
  return { available: !error, mode: (data?.mode === "manual" ? "manual" : "auto") as RoutingMode, manualModel: typeof data?.manual_model === "string" ? data.manual_model : null, updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null };
}

export function routeMetaTask(args: { capability: MetaCapability; mode: RoutingMode; manualModel?: string | null; availableModelIds?: string[]; pricing: Record<string, ModelPricing>; quality?: QualityRequirement; latency?: LatencyRequirement; budgetRequired?: boolean; configuredModel?: string; standardModeOnly?: boolean }) {
  const available = args.availableModelIds ? new Set(args.availableModelIds) : null;
  const compatible = VERIFIED_MODEL_REGISTRY.filter((model) => model.capabilities.includes(args.capability));
  const candidates = compatible.filter((model) => (!args.standardModeOnly || !model.id.endsWith("-contributor")) && (!available || available.has(model.id)) && (!args.budgetRequired || Boolean(model.pricingModel && args.pricing[model.pricingModel])));
  if (args.mode === "manual") {
    const selected = compatible.find((model) => model.id === args.manualModel && (!args.standardModeOnly || !model.id.endsWith("-contributor")));
    if (!selected) throw new Error("The selected Meta model is not verified for this capability");
    if (available && !available.has(selected.id)) throw new Error("The selected Meta model is not currently available");
    if (args.budgetRequired && (!selected.pricingModel || !args.pricing[selected.pricingModel])) throw new Error("The selected Meta model has no verified price in the application ledger");
    return makeRoute(selected, compatible.filter((model) => model.id !== selected.id), args.capability, "manual");
  }
  if (!candidates.length) throw new Error(`No verified Meta model is available for ${args.capability}`);
  const sorted = [...candidates].sort((left, right) => {
    if (args.quality === "high" && right.qualityRank !== left.qualityRank) return right.qualityRank - left.qualityRank;
    if (args.latency === "low" && left.latencyRank !== right.latencyRank) return left.latencyRank - right.latencyRank;
    const leftCost = left.pricingModel ? args.pricing[left.pricingModel]?.output_usd_per_million ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    const rightCost = right.pricingModel ? args.pricing[right.pricingModel]?.output_usd_per_million ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;
    if (leftCost !== rightCost) return leftCost - rightCost;
    if (args.configuredModel && left.id === args.configuredModel) return -1;
    if (args.configuredModel && right.id === args.configuredModel) return 1;
    return right.qualityRank - left.qualityRank;
  });
  return makeRoute(sorted[0], sorted.slice(1), args.capability, "auto");
}

function makeRoute(selected: VerifiedMetaModel, fallbacks: VerifiedMetaModel[], capability: MetaCapability, mode: RoutingMode) {
  return { mode, capability, selectedModel: selected.id, selectedEndpoint: selected.endpoints[capability] ?? null, fallbackModels: fallbacks.map((model) => ({ id: model.id, endpoint: model.endpoints[capability] ?? null })) };
}

export function catalogForDisplay(args: { catalog: Awaited<ReturnType<typeof discoverMetaModels>>; pricing: Record<string, ModelPricing> }) {
  const available = new Set(args.catalog.modelIds);
  return VERIFIED_MODEL_REGISTRY.map((model) => ({ ...model, available: available.has(model.id), pricingVerified: Boolean(model.pricingModel && args.pricing[model.pricingModel]), catalogStatus: args.catalog.status }));
}
