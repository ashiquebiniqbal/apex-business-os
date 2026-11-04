import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import type { MetaResult } from "./meta.ts";

export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for trusted workflow operations");
  return createClient(url, key);
}

export async function reserveUsage(admin: SupabaseClient, args: { requestId: string; orgId: string; actorId: string; module: string; model: string; inputTokens: number | null; maxOutputTokens: number; metadata?: Record<string, unknown> }) {
  const { data: rate } = await admin.from("ai_model_rates").select("input_usd_per_million,cached_input_usd_per_million,output_usd_per_million").eq("model", args.model).maybeSingle();
  const estimatedCost = rate && args.inputTokens !== null
    ? (args.inputTokens * Number(rate.input_usd_per_million) + args.maxOutputTokens * Number(rate.output_usd_per_million)) / 1_000_000
    : null;
  const { data, error } = await admin.rpc("reserve_ai_usage", {
    p_request_id: args.requestId,
    p_org_id: args.orgId,
    p_actor_id: args.actorId,
    p_module: args.module,
    p_model: args.model,
    p_estimated_cost_usd: estimatedCost,
    p_metadata: { ...(args.metadata ?? {}), input_token_estimate: args.inputTokens, budget_pricing_known: Boolean(rate) },
  });
  if (error) throw error;
  if (!data?.allowed) throw new Error("The Meta application budget limit has been reached.");
  return { ...data, estimatedCostUsd: estimatedCost, budgetPricingKnown: Boolean(rate) };
}

export async function reconcileUsage(admin: SupabaseClient, requestId: string, result: MetaResult<unknown>, routingMetadata: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc("reconcile_ai_usage", {
    p_request_id: requestId,
    p_model: result.model,
    p_input_tokens: result.usage.input_tokens,
    p_cached_input_tokens: result.usage.cached_input_tokens,
    p_output_tokens: result.usage.output_tokens,
    p_total_tokens: result.usage.total_tokens,
    p_provider_response_id: result.responseId,
    p_metadata: { provider_usage: result.usage, latency_ms: result.latencyMs, ...routingMetadata },
  });
  if (error) throw error;
  return data;
}

export async function failUsage(admin: SupabaseClient, requestId: string, reason: string) {
  await admin.rpc("fail_ai_usage", { p_request_id: requestId, p_metadata: { reason } });
}
