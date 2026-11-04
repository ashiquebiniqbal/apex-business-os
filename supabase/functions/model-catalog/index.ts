import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { discoverMetaModels, catalogForDisplay, loadRoutingSettings, VERIFIED_MODEL_REGISTRY } from "../_shared/model-router.ts";
import { getAdminClient } from "../_shared/usage.ts";

const ALLOWED_ORIGINS = [...new Set([Deno.env.get("APP_ORIGIN"), "http://127.0.0.1:5173", "http://localhost:5173"].filter(Boolean))] as string[];
// Set per request at the top of the handler; json() reads it for the response.
let corsHeaders: Record<string, string> = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS[0] };
function corsHeadersFor(req: Request) {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!["GET", "POST"].includes(req.method)) return json({ error: "GET or POST is required", request_id: requestId }, 405, requestId);
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required", request_id: requestId }, 401, requestId);
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !publishableKey) throw new Error("Supabase function configuration is incomplete");
    const db = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } } });
    const admin = getAdminClient();
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData.user) return json({ error: "Unauthorized", request_id: requestId }, 401, requestId);
    const userId = userData.user.id;
    const { data: profile } = await db.from("profiles").select("active_org_id").eq("id", userId).maybeSingle();
    let orgId = profile?.active_org_id as string | null | undefined;
    if (!orgId) {
      // Match the client fallback (AuthProvider): first membership when no active org is stored.
      const { data: firstMembership } = await db.from("org_members").select("org_id").eq("user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
      orgId = firstMembership?.org_id as string | null | undefined;
    }
    if (!orgId) return json({ error: "Select an organization first", request_id: requestId }, 400, requestId);
    const { data: membership, error: membershipError } = await db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).single();
    if (membershipError || !membership) return json({ error: "Organization membership is required", request_id: requestId }, 403, requestId);

    const payload = req.method === "POST" ? await req.json().catch(() => ({})) as { action?: unknown; mode?: unknown; manual_model?: unknown } : {};
    if (req.method === "POST" && payload.action === "test_connection") {
      return json(await testConnection(), 200, requestId);
    }
    if (req.method === "POST" && payload.action !== "get") {
      if (membership.role !== "owner") return json({ error: "Only the organization owner can change model routing", request_id: requestId }, 403, requestId);
      const mode = payload.mode === "manual" ? "manual" : payload.mode === "auto" ? "auto" : null;
      if (!mode) return json({ error: "Routing mode must be auto or manual", request_id: requestId }, 400, requestId);
      const manualModel = typeof payload.manual_model === "string" ? payload.manual_model : null;
      if (mode === "manual") {
        if (!manualModel || !VERIFIED_MODEL_REGISTRY.some((model) => model.id === manualModel)) return json({ error: "The selected model is not in the verified backend registry", request_id: requestId }, 400, requestId);
        await validateManualModel(admin, manualModel);
      }
      if (mode === "auto" && manualModel !== null) return json({ error: "Automatic mode cannot include a manual model", request_id: requestId }, 400, requestId);
      const { error: saveError } = await admin.from("ai_model_routing_settings").upsert({ org_id: orgId, mode, manual_model: mode === "manual" ? manualModel : null, updated_by: userId, updated_at: new Date().toISOString() });
      if (saveError) {
        if (["42P01", "PGRST205"].includes(saveError.code ?? "")) return json({ error: "Model routing migration is not applied yet", migration_required: "20261104003000_apex_model_routing.sql", request_id: requestId }, 409, requestId);
        throw saveError;
      }
    }

    return json(await buildCatalogResponse(admin, orgId), 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(JSON.stringify({ request_id: requestId, error: message }));
    if (message.startsWith("The selected Meta model")) return json({ error: "Manual model selection was rejected", detail: message, request_id: requestId }, 409, requestId);
    return json({ error: "Model catalog could not be loaded", detail: "Check the server-side Meta configuration and try again.", request_id: requestId }, 500, requestId);
  }
});

/**
 * Safe connection probe: makes a real backend request to the Meta model
 * catalog (no charged inference call) and reports configured vs reachable
 * vs tested. Never returns the API key or any secret material.
 */
async function testConnection() {
  const startedAt = Date.now();
  const meta = publicMetaConfiguration();
  try {
    // A connection test must make a real request, never serve the 15-minute cache as "live".
    const catalog = await discoverMetaModels({ forceRefresh: true });
    return {
      status: catalog.status,
      api_key_configured: meta.api_key_configured,
      // Only a live discovery counts as reachable; "stale" means Meta did not just answer.
      reachable: catalog.status === "live",
      tested_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      model_count: catalog.modelIds.length,
      endpoint: "https://api.meta.ai/v1/models",
      error: catalog.status === "stale" ? "Live discovery failed; served the cached catalog instead." : null,
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      api_key_configured: meta.api_key_configured,
      reachable: false,
      tested_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      model_count: null,
      endpoint: "https://api.meta.ai/v1/models",
      error: error instanceof Error ? error.message : "Meta model discovery is unavailable",
    };
  }
}

async function buildCatalogResponse(admin: ReturnType<typeof getAdminClient>, orgId: string) {
  const pricing = await loadPricing(admin);
  let discovery: Awaited<ReturnType<typeof discoverMetaModels>> | null = null;
  let discoveryError: string | null = null;
  try { discovery = await discoverMetaModels(); } catch (error) { discoveryError = error instanceof Error ? error.message : "Model discovery unavailable"; }
  const models = discovery ? catalogForDisplay({ catalog: discovery, pricing }) : VERIFIED_MODEL_REGISTRY.map((model) => ({ ...model, available: false, pricingVerified: Boolean(model.pricingModel && pricing[model.pricingModel]), catalogStatus: "unavailable" as const }));
  const settings = await loadRoutingSettings(admin, orgId);
  const usage = await loadUsage(admin, orgId);
  const budget = await loadBudget(admin);
  const meta = publicMetaConfiguration();
  return {
    discovery: { supported: true, endpoint: "https://api.meta.ai/v1/models", status: discovery?.status ?? "unavailable", last_discovery_at: discovery?.fetchedAt ? new Date(discovery.fetchedAt).toISOString() : null, refresh_seconds: Number(Deno.env.get("META_MODEL_DISCOVERY_REFRESH_SECONDS") ?? 900), error: discoveryError },
    meta,
    configured_model: meta.default_model,
    settings: { ...settings, owner_controlled: true },
    models,
    usage,
    budget,
  };
}

async function loadPricing(admin: ReturnType<typeof getAdminClient>) {
  const { data, error } = await admin.from("ai_model_rates").select("model,input_usd_per_million,cached_input_usd_per_million,output_usd_per_million").eq("active", true);
  if (error) { console.error(JSON.stringify({ catalog_section: "pricing", error: error.message })); return {}; }
  return Object.fromEntries((data ?? []).map((row) => [row.model, { input_usd_per_million: Number(row.input_usd_per_million), cached_input_usd_per_million: Number(row.cached_input_usd_per_million), output_usd_per_million: Number(row.output_usd_per_million) }]));
}

async function validateManualModel(admin: ReturnType<typeof getAdminClient>, modelId: string) {
  const model = VERIFIED_MODEL_REGISTRY.find((candidate) => candidate.id === modelId);
  const pricing = await loadPricing(admin);
  const catalog = await discoverMetaModels();
  if (!catalog.modelIds.includes(modelId)) throw new Error("The selected Meta model is not currently available");
  if (!model?.pricingModel || !pricing[model.pricingModel]) throw new Error("The selected Meta model has no verified price in the application ledger");
}

async function loadUsage(admin: ReturnType<typeof getAdminClient>, orgId: string) {
  const { data, error } = await admin.from("ai_usage_ledger").select("model,status,actual_cost_usd,estimated_cost_usd,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(500);
  if (error) { console.error(JSON.stringify({ catalog_section: "usage", error: error.message })); return { by_model: {}, request_count: 0, committed_cost_usd: 0 }; }
  const byModel: Record<string, { requests: number; completed: number; cost_usd: number }> = {};
  for (const row of data ?? []) {
    const item = byModel[row.model] ?? { requests: 0, completed: 0, cost_usd: 0 };
    item.requests += 1;
    if (row.status === "completed") item.completed += 1;
    item.cost_usd += Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0);
    byModel[row.model] = item;
  }
  return { by_model: byModel, request_count: data?.length ?? 0, committed_cost_usd: Object.values(byModel).reduce((sum, item) => sum + item.cost_usd, 0) };
}

async function loadBudget(admin: ReturnType<typeof getAdminClient>) {
  const { data, error } = await admin.from("ai_budget_settings").select("allocation_usd,warning_threshold_usd,hard_limit_usd,currency").eq("id", "global").maybeSingle();
  if (error) { console.error(JSON.stringify({ catalog_section: "budget", error: error.message })); return null; }
  if (!data || data.currency !== "USD") return null;
  return { allocation_usd: Number(data.allocation_usd), warning_threshold_usd: Number(data.warning_threshold_usd), hard_limit_usd: Number(data.hard_limit_usd), currency: "USD" as const };
}

function publicMetaConfiguration() {
  const defaultModel = (Deno.env.get("META_MODEL") ?? "muse-spark-1.3").trim() || "muse-spark-1.3";
  const configuredEndpoint = (Deno.env.get("META_API_URL") ?? "https://api.meta.ai/v1/responses").trim();
  try {
    const endpoint = new URL(configuredEndpoint);
    if (endpoint.protocol !== "https:" || !endpoint.pathname.endsWith("/responses")) throw new Error("invalid endpoint");
    endpoint.username = "";
    endpoint.password = "";
    return { api_key_configured: Boolean(Deno.env.get("META_API_KEY")?.trim()), api_endpoint: endpoint.toString().replace(/\/$/, ""), default_model: defaultModel };
  } catch {
    return { api_key_configured: Boolean(Deno.env.get("META_API_KEY")?.trim()), api_endpoint: "Invalid server endpoint configuration", default_model: defaultModel };
  }
}

function json(body: unknown, status = 200, requestId?: string) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...(requestId ? { "x-request-id": requestId } : {}), "Content-Type": "application/json" } });
}
