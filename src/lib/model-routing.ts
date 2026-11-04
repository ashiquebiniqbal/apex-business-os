import { supabase } from "./supabase";

export type ModelCapability = "text_generation" | "reasoning" | "structured_extraction" | "document_analysis" | "vision" | "image_generation" | "audio_processing";
export type RouterMode = "auto" | "manual";
export type DisplayModel = {
  id: string;
  displayName: string;
  capabilities: ModelCapability[];
  endpoints: Record<string, string>;
  qualityRank: number;
  latencyRank: number;
  pricingModel: string | null;
  pricingVerified: boolean;
  verifiedSource: string;
  available: boolean;
  catalogStatus: string;
};
export type ModelCatalogResponse = {
  discovery: { supported: boolean; endpoint: string; status: string; last_discovery_at: string | null; refresh_seconds: number; error: string | null };
  meta: { api_key_configured: boolean; api_endpoint: string; default_model: string };
  configured_model: string;
  settings: { available: boolean; mode: RouterMode; manualModel: string | null; updatedAt: string | null; updatedBy: string | null; owner_controlled: boolean };
  models: DisplayModel[];
  usage: { by_model: Record<string, { requests: number; completed: number; cost_usd: number }>; request_count: number; committed_cost_usd: number };
  budget: { allocation_usd: number; warning_threshold_usd: number; hard_limit_usd: number; currency: "USD" } | null;
};

const standardCapabilities: ModelCapability[] = ["text_generation", "reasoning", "structured_extraction", "document_analysis", "vision", "audio_processing"];
const source = "https://dev.meta.ai/docs/models";

export const VERIFIED_MODEL_DISPLAY: DisplayModel[] = [
  { id: "muse-wonder-1.0", displayName: "Muse Wonder 1.0", capabilities: standardCapabilities, endpoints: { responses: "Responses" }, qualityRank: 5, latencyRank: 3, pricingModel: null, pricingVerified: false, verifiedSource: source, available: false, catalogStatus: "not_checked" },
  ...["1.3", "1.2", "1.1"].map((version, index) => ({ id: `muse-spark-${version}`, displayName: `Muse Spark ${version}`, capabilities: standardCapabilities, endpoints: { responses: "Responses" }, qualityRank: 4 - index, latencyRank: 2, pricingModel: `muse-spark-${version}`, pricingVerified: true, verifiedSource: source, available: false, catalogStatus: "not_checked" })),
  { id: "muse-spark-1.3-contributor", displayName: "Muse Spark 1.3 Contributor", capabilities: standardCapabilities, endpoints: { responses: "Responses" }, qualityRank: 4, latencyRank: 2, pricingModel: "muse-spark-1.3-contributor", pricingVerified: true, verifiedSource: source, available: false, catalogStatus: "not_checked" },
  { id: "muse-spark-1.2-contributor", displayName: "Muse Spark 1.2 Contributor", capabilities: standardCapabilities, endpoints: { responses: "Responses" }, qualityRank: 3, latencyRank: 2, pricingModel: "muse-spark-1.2-contributor", pricingVerified: true, verifiedSource: source, available: false, catalogStatus: "not_checked" },
  { id: "muse-image-1.0", displayName: "Muse Image 1.0", capabilities: ["image_generation"], endpoints: { images: "Image generation", responses: "Responses" }, qualityRank: 4, latencyRank: 3, pricingModel: null, pricingVerified: false, verifiedSource: source, available: false, catalogStatus: "not_checked" },
  { id: "muse-voice-transcribe-1.0", displayName: "Muse Voice Transcribe 1.0", capabilities: ["audio_processing"], endpoints: { transcribe: "Transcribe" }, qualityRank: 4, latencyRank: 2, pricingModel: null, pricingVerified: false, verifiedSource: source, available: false, catalogStatus: "not_checked" },
  { id: "sam-3.1", displayName: "Segment Anything 3.1", capabilities: ["vision"], endpoints: { media_segmentation: "Media segmentation" }, qualityRank: 4, latencyRank: 3, pricingModel: null, pricingVerified: false, verifiedSource: source, available: false, catalogStatus: "not_checked" },
];

/** Invokes model-catalog and surfaces the function's own error/detail instead of the generic invoke error. */
async function invokeCatalog(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Connect Supabase before loading model routing settings.");
  const { data, error } = await supabase.functions.invoke("model-catalog", { body });
  if (!error) return data;
  const response = typeof error === "object" && error !== null && "context" in error ? (error as { context?: Response }).context : undefined;
  if (response && typeof response.json === "function") {
    try {
      const parsed = await response.clone().json() as { error?: unknown; detail?: unknown; request_id?: unknown };
      const message = [parsed.error, parsed.detail].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
      if (message) throw new Error(typeof parsed.request_id === "string" ? `${message} (request ${parsed.request_id})` : message);
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message && !(parseError instanceof SyntaxError)) throw parseError;
    }
  }
  throw error;
}

export async function fetchModelCatalog() {
  const data = await invokeCatalog({ action: "get" });
  const catalog = data as ModelCatalogResponse | null;
  if (!catalog || typeof catalog.usage?.committed_cost_usd !== "number" || !Array.isArray(catalog.models)) {
    throw new Error("Model catalog returned an unexpected response. Check the model-catalog Edge Function logs.");
  }
  return catalog;
}

export type MetaConnectionTest = {
  status: "live" | "stale" | "unavailable";
  api_key_configured: boolean;
  reachable: boolean;
  tested_at: string;
  latency_ms: number | null;
  model_count: number | null;
  endpoint: string;
  error: string | null;
  request_id?: string;
};

export async function testMetaConnection(): Promise<MetaConnectionTest> {
  const data = await invokeCatalog({ action: "test_connection" });
  return data as MetaConnectionTest;
}

export async function saveModelRouting(mode: RouterMode, manualModel: string | null) {
  const data = await invokeCatalog({ mode, manual_model: manualModel });
  return data as ModelCatalogResponse;
}

export function fallbackModelCatalog(configuredModel: string): ModelCatalogResponse {
  return { discovery: { supported: true, endpoint: "https://api.meta.ai/v1/models", status: "not_checked", last_discovery_at: null, refresh_seconds: 900, error: "Model catalog function is not deployed or has not been called." }, meta: { api_key_configured: false, api_endpoint: "https://api.meta.ai/v1/responses", default_model: configuredModel }, configured_model: configuredModel, settings: { available: false, mode: "auto", manualModel: null, updatedAt: null, updatedBy: null, owner_controlled: true }, models: VERIFIED_MODEL_DISPLAY, usage: { by_model: {}, request_count: 0, committed_cost_usd: 0 }, budget: null };
}
