import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { AGENT_REGISTRY } from "../lib/agents";
import { loadInstructions, loadInstructionsRemote, saveInstructions, syncInstructionsToDb, type OrgInstructions } from "../lib/agent-store";
import { testMetaConnection, type MetaConnectionTest } from "../lib/model-routing";
import { loadIntegrations, loadProviderRegistrations, removeIntegrationFromDb, removeProviderFromDb, saveIntegrations, saveProviderRegistrations, syncIntegrationToDb, syncProviderToDb, validateIntegration, validateProviderRegistration, PROVIDER_ADAPTERS, type IntegrationRegistration, type ProviderRegistration } from "../lib/providers";
import { newId } from "../lib/agent-store";

export function AgentSettingsSections() {
  return <><AgentsSection /><InstructionsSection /><ProvidersSection /><IntegrationsSection /></>;
}

function AgentsSection() {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Agent registry</h2>
      <p className="mt-1 text-sm text-slate-500">Selectable in Ask Apex. Agents share one orchestrator and tool engine; permissions and restricted tools differ per agent. User instructions never override authentication, RLS, or approval rules.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{AGENT_REGISTRY.map((agent) => (
        <article key={agent.id} className="rounded-xl bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-2"><h3 className="font-medium">{agent.name}</h3><span className="text-xs text-emerald-700">{agent.status}</span></div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{agent.description} Permission: {agent.requiredPermission}. Model: {agent.providerPreference}.</p>
          <p className="mt-2 text-xs"><span className="font-medium">Allowed:</span> {agent.allowedTools.join(", ")}</p>
          <p className="mt-1 text-xs text-red-700"><span className="font-medium">Restricted:</span> {agent.restrictedTools.join(", ")}</p>
        </article>))}
      </div>
    </section>
  );
}

function InstructionsSection() {
  const { activeOrganization } = useAuth();
  const [form, setForm] = useState<OrgInstructions | null>(null);
  const [saved, setSaved] = useState("");
  useEffect(() => { if (activeOrganization) { setForm(loadInstructions(activeOrganization.id)); void loadInstructionsRemote(activeOrganization.id).then((remote) => { if (remote) setForm(remote); }); } }, [activeOrganization?.id]);
  if (!activeOrganization || !form) return null;
  const field = (key: keyof OrgInstructions, label: string) => (
    <label className="mt-4 block text-xs font-medium text-slate-500">{label}<textarea className="field min-h-14" value={String(form[key] ?? "")} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>
  );
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Organization agent instructions</h2>
      <p className="mt-1 text-sm text-slate-500">Persisted per organization in Supabase (owner/admin write, member read). They guide tone and defaults only and cannot override role, RLS, financial, or approval controls.</p>
      {field("tone", "Business tone")}{field("approvalPreference", "Approval preferences")}{field("quotationTerms", "Default quotation terms")}{field("operationalPolicies", "Operational policies")}{field("salesFollowUpRules", "Sales follow-up rules")}
      <button onClick={() => { saveInstructions(activeOrganization.id, form); void syncInstructionsToDb(activeOrganization.id, form).then(setSaved); }} className="mt-4 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">Save instructions</button>
      {saved && <p className="mt-3 text-sm text-emerald-700">{saved}</p>}
    </section>
  );
}

function ProvidersSection() {
  const { activeOrganization } = useAuth();
  const [test, setTest] = useState<MetaConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [registrations, setRegistrations] = useState<ProviderRegistration[]>(() => loadProviderRegistrations());
  const [form, setForm] = useState<ProviderRegistration>({ id: "", name: "", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "", credentialRef: "OPENAI_COMPATIBLE_API_KEY", enabled: true });
  const runTest = async () => { setTesting(true); setError(""); try { setTest(await testMetaConnection()); } catch (e) { setError(e instanceof Error ? e.message : "Connection test failed."); } finally { setTesting(false); } };
  const add = () => { const errors = validateProviderRegistration(form); if (errors.length) { setError(errors.join(" ")); return; } const item = { ...form, id: newId() }; const next = [...registrations, item]; setRegistrations(next); saveProviderRegistrations(next); if (activeOrganization) void syncProviderToDb(activeOrganization.id, item); setError(""); };
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Model providers (BYOM)</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">Keys stay in Edge Function secrets and are never entered or stored here. Registration records only a secret name. External providers may receive text included in requests; Ollama is the local option when reachable from the function host.</p>
      <div className="mt-4 space-y-3">{PROVIDER_ADAPTERS.map((provider) => <div key={provider.id} className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-medium">{provider.name}</p><p className="mt-1 text-xs leading-5 text-slate-500">{provider.status}</p><p className="mt-1 font-mono text-[11px] text-slate-500">{provider.configuredVia}</p></div>)}</div>
      <button disabled={testing} onClick={() => void runTest()} className="mt-4 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{testing ? "Testing Meta…" : "Test Meta connection (real request)"}</button>
      {test && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">Meta test: status {test.status} · configured {test.api_key_configured ? "yes" : "no"} · reachable {test.reachable ? "yes (live)" : "no"} · {test.latency_ms ?? "—"} ms · {test.model_count ?? "—"} models{test.error ? ` · ${test.error}` : ""}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <h3 className="mt-6 font-medium">Register OpenAI-compatible provider</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500">Name<input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Base URL<input className="field" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Default model<input className="field" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Server secret name (not the key)<input className="field" value={form.credentialRef} onChange={(e) => setForm({ ...form, credentialRef: e.target.value })} /></label>
      </div>
      <button onClick={add} className="mt-3 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium">Register provider</button>
      {registrations.map((item) => <div key={item.id} className="mt-3 flex justify-between rounded-xl bg-slate-50 p-3 text-sm"><span>{item.name} · {item.model || "no model"} · secret {item.credentialRef} · {item.enabled ? "enabled" : "disabled"}</span><span className="flex gap-2"><button onClick={() => { const updated = { ...item, enabled: !item.enabled }; const next = registrations.map((r) => r.id === item.id ? updated : r); setRegistrations(next); saveProviderRegistrations(next); if (activeOrganization) void syncProviderToDb(activeOrganization.id, updated); }} className="text-xs font-medium text-accent">{item.enabled ? "Disable" : "Enable"}</button><button onClick={() => { const next = registrations.filter((r) => r.id !== item.id); setRegistrations(next); saveProviderRegistrations(next); void removeProviderFromDb(item); }} className="text-xs font-medium text-red-600">Remove</button></span></div>)}
    </section>
  );
}

function IntegrationsSection() {
  const { activeOrganization } = useAuth();
  const [items, setItems] = useState<IntegrationRegistration[]>(() => loadIntegrations());
  const [error, setError] = useState("");
  const [form, setForm] = useState<IntegrationRegistration>({ id: "", name: "", kind: "custom-http", endpoint: "https://", authType: "bearer-credential-ref", credentialRef: "", description: "", operations: "", enabled: true, approvedTools: "" });
  const add = () => { const errors = validateIntegration(form); if (errors.length) { setError(errors.join(" ")); return; } const item = { ...form, id: newId() }; const next = [...items, item]; setItems(next); saveIntegrations(next); if (activeOrganization) void syncIntegrationToDb(activeOrganization.id, item); setError(""); };
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Integrations</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500">Native: only integrations implemented in Apex are listed — Supabase (database/auth) and Meta Model API (server-side) are active. No email, calendar, storage, or CRM connector is claimed. Custom HTTP and HTTP-MCP servers can be registered here; credentials are referenced by server secret name only. Supabase-hosted Edge Functions cannot reach arbitrary local stdio MCP servers, and browser-direct calls are not used, so discovery and execution run server-side after the agent function is deployed.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-500">Name<input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Type<select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as IntegrationRegistration["kind"] })}><option value="custom-http">Custom HTTP API</option><option value="mcp-http">MCP server (HTTP)</option></select></label>
        <label className="text-xs font-medium text-slate-500">Endpoint<input className="field" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Server secret name (optional)<input className="field" value={form.credentialRef} onChange={(e) => setForm({ ...form, credentialRef: e.target.value })} placeholder="EXAMPLE_API_KEY" /></label>
        <label className="text-xs font-medium text-slate-500">Available operations (comma separated)<input className="field" value={form.operations} onChange={(e) => setForm({ ...form, operations: e.target.value })} /></label>
        <label className="text-xs font-medium text-slate-500">Approved MCP tools (comma separated)<input className="field" value={form.approvedTools} onChange={(e) => setForm({ ...form, approvedTools: e.target.value })} /></label>
      </div>
      <label className="mt-3 block text-xs font-medium text-slate-500">Description<textarea className="field min-h-14" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button onClick={add} className="mt-3 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">Register integration</button>
      {items.map((item) => <div key={item.id} className="mt-3 flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-sm"><span>{item.name} · {item.kind} · {item.enabled ? "enabled" : "disabled"} · stored server-side; external calls run only through the authorized tool layer</span><span className="flex gap-2"><button onClick={() => { const updated = { ...item, enabled: !item.enabled }; const next = items.map((r) => r.id === item.id ? updated : r); setItems(next); saveIntegrations(next); if (activeOrganization) void syncIntegrationToDb(activeOrganization.id, updated); }} className="text-xs font-medium text-accent">{item.enabled ? "Disable" : "Enable"}</button><button onClick={() => { const next = items.filter((r) => r.id !== item.id); setItems(next); saveIntegrations(next); void removeIntegrationFromDb(item); }} className="text-xs font-medium text-red-600">Remove</button></span></div>)}
    </section>
  );
}
