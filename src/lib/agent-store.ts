import { supabase } from "./supabase";
import type { PlanTask, QuotationReview } from "./orchestration";

export type AgentRunStatus = "pending" | "planning" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
export type AgentStep = { agent: string; tool?: string; status: string; detail: string; at: string };
export type ApprovalProposal = {
  id: string; agent: string; tool: string; title: string; affected: string;
  args: Record<string, unknown>; financialImpact?: string; status: "pending" | "approved" | "rejected";
  result?: string;
};
export type AgentRun = {
  id: string; orgId: string; userEmail: string; userId?: string; prompt: string; agents: string[];
  provider: string; status: AgentRunStatus; steps: AgentStep[]; approvals: ApprovalProposal[];
  result: string; error?: string; createdAt: string;
  tasks?: PlanTask[];
  review?: QuotationReview;
};

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function write(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }

const runsKey = (orgId: string) => `apex.agentRuns.${orgId}`;
export function loadRuns(orgId: string): AgentRun[] { return read<AgentRun[]>(runsKey(orgId), []); }
export function saveRun(run: AgentRun) {
  const runs = loadRuns(run.orgId);
  const next = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 50);
  write(runsKey(run.orgId), next);
  window.dispatchEvent(new CustomEvent("apex-agent-runs"));
  void syncRunToDb(run);
}

export type OrgInstructions = { tone: string; approvalPreference: string; quotationTerms: string; operationalPolicies: string; salesFollowUpRules: string; perAgent: Record<string, string> };
export const DEFAULT_INSTRUCTIONS: OrgInstructions = { tone: "Professional and concise", approvalPreference: "Approve all quotation drafts manually", quotationTerms: "", operationalPolicies: "", salesFollowUpRules: "", perAgent: {} };
const instructionsKey = (orgId: string) => `apex.instructions.${orgId}`;
export function loadInstructions(orgId: string): OrgInstructions { return { ...DEFAULT_INSTRUCTIONS, ...read<Partial<OrgInstructions>>(instructionsKey(orgId), {}) }; }
export function saveInstructions(orgId: string, value: OrgInstructions) { write(instructionsKey(orgId), value); }

export type ChatMessage = { role: "user" | "assistant" | "system"; text: string; at: string };
const chatKey = (orgId: string) => `apex.chat.${orgId}`;
export function loadChat(orgId: string): ChatMessage[] { return read<ChatMessage[]>(chatKey(orgId), []); }
export function saveChat(orgId: string, messages: ChatMessage[]) { write(chatKey(orgId), messages.slice(-40)); }

export function newId(): string { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

/* ---- Server persistence (migration 20261104005000, applied). Local storage stays as an offline cache. ---- */
export async function syncRunToDb(run: AgentRun): Promise<void> {
  if (!supabase || !run.userId) return;
  const row = { id: run.id, org_id: run.orgId, actor_id: run.userId, prompt: run.prompt, agents: run.agents, provider: run.provider, status: run.status, steps: run.steps, approvals: run.approvals, result: run.result || null, error: run.error ?? null };
  const { error } = await supabase.from("agent_runs").upsert(row, { onConflict: "id" });
  if (error) console.warn("Agent run could not be synced:", error.message);
}

export async function loadRunsRemote(orgId: string): Promise<AgentRun[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("agent_runs").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50);
  if (error) { console.warn("Agent runs could not be loaded:", error.message); return []; }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id), orgId: String(row.org_id), userId: String(row.actor_id), userEmail: "organization member",
    prompt: String(row.prompt ?? ""), agents: (row.agents as string[]) ?? [], provider: String(row.provider ?? ""),
    status: row.status as AgentRunStatus, steps: (row.steps as AgentStep[]) ?? [], approvals: (row.approvals as ApprovalProposal[]) ?? [],
    result: String(row.result ?? ""), error: row.error ? String(row.error) : undefined, createdAt: String(row.created_at ?? ""),
  }));
}

export async function syncInstructionsToDb(orgId: string, value: OrgInstructions): Promise<string> {
  if (!supabase) return "Supabase is not configured.";
  const { error } = await supabase.from("agent_instructions").upsert({ org_id: orgId, tone: value.tone, approval_preference: value.approvalPreference, quotation_terms: value.quotationTerms, operational_policies: value.operationalPolicies, sales_follow_up_rules: value.salesFollowUpRules, per_agent: value.perAgent }, { onConflict: "org_id" });
  return error ? `Server save failed: ${error.message}` : "Saved to the organization (server).";
}

export async function loadInstructionsRemote(orgId: string): Promise<OrgInstructions | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("agent_instructions").select("*").eq("org_id", orgId).maybeSingle();
  if (error || !data) return null;
  return { tone: data.tone ?? DEFAULT_INSTRUCTIONS.tone, approvalPreference: data.approval_preference ?? "", quotationTerms: data.quotation_terms ?? "", operationalPolicies: data.operational_policies ?? "", salesFollowUpRules: data.sales_follow_up_rules ?? "", perAgent: (data.per_agent as Record<string, string>) ?? {} };
}
