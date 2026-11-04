import { supabase } from "./supabase";

export type ProviderKind = "meta" | "openai-compatible" | "anthropic" | "gemini" | "openrouter" | "ollama";
export type ProviderAdapter = { id: ProviderKind; name: string; configuredVia: string; discovery: string; status: string };

export const PROVIDER_ADAPTERS: ProviderAdapter[] = [
  { id: "meta", name: "Meta Model API", configuredVia: "Edge Function secrets META_API_KEY / META_API_URL / META_MODEL", discovery: "GET /models (live, 10s timeout, cached fallback)", status: "Implemented and deployed (model-catalog v5). Configured is proven by the Settings catalog; reachable/tested only after Test connection succeeds live." },
  { id: "openai-compatible", name: "OpenAI-compatible", configuredVia: "Edge Function secrets OPENAI_COMPATIBLE_API_KEY / OPENAI_COMPATIBLE_BASE_URL / OPENAI_COMPATIBLE_MODEL", discovery: "GET {base}/models where the endpoint supports it", status: "Adapter contract defined. No key is stored in the browser; a real test requires the server secrets and a redeployed catalog function." },
  { id: "anthropic", name: "Anthropic", configuredVia: "Edge Function secret ANTHROPIC_API_KEY", discovery: "Model list API where supported", status: "Planned on the same adapter interface. Not tested." },
  { id: "gemini", name: "Google Gemini", configuredVia: "Edge Function secret GEMINI_API_KEY", discovery: "Model list API where supported", status: "Planned on the same adapter interface. Not tested." },
  { id: "openrouter", name: "OpenRouter", configuredVia: "Edge Function secret OPENROUTER_API_KEY", discovery: "GET /models", status: "Planned via the OpenAI-compatible contract. Not tested." },
  { id: "ollama", name: "Ollama (local)", configuredVia: "OLLAMA_BASE_URL reachable from the Edge Function host", discovery: "GET /api/tags on the local endpoint", status: "Local option. Supabase-hosted Edge Functions cannot reach your laptop's localhost; use a self-hosted function or tunnel. Not tested." },
];

export type ProviderRegistration = { id: string; name: string; kind: ProviderKind; baseUrl: string; model: string; credentialRef: string; enabled: boolean };

export function validateProviderRegistration(input: ProviderRegistration): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Provider name is required.");
  if (!/^[A-Z][A-Z0-9_]{2,}$/.test(input.credentialRef.trim())) errors.push("Credential reference must be a server secret name such as OPENAI_COMPATIBLE_API_KEY. Never paste the key itself.");
  try {
    const url = new URL(input.baseUrl);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) errors.push("Endpoint must use https (http only for localhost/Ollama).");
  } catch { errors.push("Endpoint URL is invalid."); }
  return errors;
}

export type IntegrationRegistration = { id: string; name: string; kind: "custom-http" | "mcp-http" | "native"; endpoint: string; authType: string; credentialRef: string; description: string; operations: string; enabled: boolean; approvedTools: string };

export function validateIntegration(input: IntegrationRegistration): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("Integration name is required.");
  if (input.credentialRef && !/^[A-Z][A-Z0-9_]{2,}$/.test(input.credentialRef.trim())) errors.push("Credential reference must be a server secret name, never the credential itself.");
  try { const url = new URL(input.endpoint); if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) errors.push("Endpoint must use https (http only for localhost)."); }
  catch { errors.push("Endpoint URL is invalid."); }
  return errors;
}

export async function syncProviderToDb(orgId: string, item: ProviderRegistration): Promise<void> {
  if (!supabase || !orgId) return;
  const { error } = await supabase.from("provider_registrations").upsert({ id: item.id, org_id: orgId, name: item.name, kind: item.kind, base_url: item.baseUrl, default_model: item.model || null, credential_ref: item.credentialRef, enabled: item.enabled }, { onConflict: "id" });
  if (error) console.warn("Provider registration sync failed:", error.message);
}
export async function removeProviderFromDb(item: ProviderRegistration): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("provider_registrations").delete().eq("id", item.id);
  if (error) console.warn("Provider removal sync failed:", error.message);
}
export async function syncIntegrationToDb(orgId: string, item: IntegrationRegistration): Promise<void> {
  if (!supabase || !orgId) return;
  const list = (value: string) => value.split(",").map((part) => part.trim()).filter(Boolean);
  const { error } = await supabase.from("integration_registrations").upsert({ id: item.id, org_id: orgId, name: item.name, kind: item.kind, endpoint: item.endpoint, auth_type: item.authType, credential_ref: item.credentialRef || null, description: item.description || null, operations: list(item.operations), approved_tools: list(item.approvedTools), enabled: item.enabled }, { onConflict: "id" });
  if (error) console.warn("Integration sync failed:", error.message);
}
export async function removeIntegrationFromDb(item: IntegrationRegistration): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("integration_registrations").delete().eq("id", item.id);
  if (error) console.warn("Integration removal sync failed:", error.message);
}

const KEY = "apex.integrations";
export function loadIntegrations(): IntegrationRegistration[] { try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as IntegrationRegistration[]; } catch { return []; } }
export function saveIntegrations(value: IntegrationRegistration[]) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* ignore */ } }
const PKEY = "apex.providers";
export function loadProviderRegistrations(): ProviderRegistration[] { try { return JSON.parse(localStorage.getItem(PKEY) ?? "[]") as ProviderRegistration[]; } catch { return []; } }
export function saveProviderRegistrations(value: ProviderRegistration[]) { try { localStorage.setItem(PKEY, JSON.stringify(value)); } catch { /* ignore */ } }
