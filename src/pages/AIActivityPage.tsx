import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/records";
import { formatDateTime } from "../lib/org-settings";
import { PageHeader, SearchInput, StatusPill } from "../components/ui";
import { loadRuns, loadRunsRemote, type AgentRun } from "../lib/agent-store";

type LedgerRow = { request_id: string; module: string; model: string; status: string; actual_cost_usd: number | null; estimated_cost_usd: number | null; input_tokens: number; output_tokens: number; created_at: string };

function AgentRunsSection() {
  const { activeOrganization } = useAuth();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selected, setSelected] = useState<string>("");
  useEffect(() => {
    const refresh = () => { if (activeOrganization) setRuns(loadRuns(activeOrganization.id)); };
    refresh();
    if (activeOrganization) void loadRunsRemote(activeOrganization.id).then((remote) => { if (remote.length) setRuns((local) => [...remote, ...local.filter((item) => !remote.some((r) => r.id === item.id))].slice(0, 50)); });
    window.addEventListener("apex-agent-runs", refresh);
    return () => window.removeEventListener("apex-agent-runs", refresh);
  }, [activeOrganization?.id]);
  const run = runs.find((item) => item.id === selected) ?? runs[0];
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Agent executions</h2>
      <p className="mt-1 text-sm text-slate-500">Agent runs are persisted per organization in Supabase (with a browser cache). Business records changed by approved actions are persisted in their modules. Server-side audit inserts for agent actions remain available through the existing Edge workflows.</p>
      {runs.length === 0 ? <p className="mt-4 text-sm text-slate-500">No agent runs yet. Open Ask Apex and run a request.</p> : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-2">{runs.map((item) => <button key={item.id} onClick={() => setSelected(item.id)} className={`block w-full rounded-xl border p-3 text-left text-sm ${run?.id === item.id ? "border-accent bg-blue-50" : "border-slate-200 bg-slate-50"}`}><span className="font-medium">{item.prompt.slice(0, 70)}</span><span className="mt-1 block text-xs text-slate-500">{item.agents.join(", ")} · {item.status.replace(/_/g, " ")} · {new Date(item.createdAt).toLocaleString()} · {item.userEmail}</span></button>)}</div>
          {run && <div className="rounded-xl bg-slate-50 p-4 text-sm"><p><span className="font-medium">Status:</span> {run.status.replace(/_/g, " ")}</p><p className="mt-1"><span className="font-medium">Provider/model:</span> {run.provider}</p><p className="mt-1"><span className="font-medium">Result:</span> {run.result || "—"}</p>{run.error && <p className="mt-1 text-red-700">Error: {run.error}</p>}
            <ol className="mt-3 space-y-1.5 text-xs text-slate-600">{run.steps.map((step, index) => <li key={`${step.at}-${index}`}><span className="font-medium capitalize">{step.agent}</span>{step.tool ? ` · ${step.tool}` : ""} · {step.status} — {step.detail}</li>)}</ol>
            {run.approvals.map((approval) => <p key={approval.id} className="mt-2 rounded-lg bg-white p-2 text-xs">{approval.agent} · {approval.tool} · {approval.status}{approval.result ? ` — ${approval.result}` : ""}</p>)}
          </div>}
        </div>
      )}
    </section>
  );
}

export function AIActivityPage() {
  const { activeOrganization } = useAuth();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase
      .from("ai_usage_ledger")
      .select("request_id,module,model,status,actual_cost_usd,estimated_cost_usd,input_tokens,output_tokens,created_at")
      .eq("org_id", activeOrganization.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError(friendlyError(queryError, "AI activity could not be loaded."));
        setRows((data ?? []) as LedgerRow[]);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeOrganization]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.request_id.toLowerCase().includes(query) || row.model.toLowerCase().includes(query) || row.module.toLowerCase().includes(query);
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => {
    const completed = filtered.filter((row) => row.status === "completed");
    return { requests: filtered.length, tokens: filtered.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0), cost: completed.reduce((sum, row) => sum + Number(row.actual_cost_usd ?? 0), 0) };
  }, [filtered]);

  return (
    <>
      <PageHeader eyebrow="Governance" title="Agent activity" subtitle={`Agent runs, approvals, tool calls, and model usage. Showing ${totals.requests} model requests · ${totals.tokens.toLocaleString()} tokens · $${totals.cost.toFixed(4)} completed cost.`} />
      <AgentRunsSection />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by request ID, model, or module…" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="reserved">Reserved</option>
          <option value="unpriced">Unpriced</option>
        </select>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading AI activity…</p>
        ) : error ? (
          <p className="p-6 text-sm text-amber-700">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <History className="mx-auto text-slate-300" size={28} />
            <p className="mt-4 font-semibold">No AI activity yet</p>
            <p className="mt-2 text-sm text-slate-500">Run the inquiry workflow after the usage migration is available.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <tr>{["Request", "Module", "Model", "Status", "Tokens", "Cost", "Created"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr className="border-b border-slate-100 last:border-0" key={row.request_id} title={`Request ID: ${row.request_id}`}>
                    <td className="px-5 py-4 font-mono text-xs">{row.request_id.slice(0, 8)}…</td>
                    <td className="px-5 py-4">{row.module}</td>
                    <td className="px-5 py-4">{row.model}</td>
                    <td className="px-5 py-4"><StatusPill status={row.status} /></td>
                    <td className="px-5 py-4">{(row.input_tokens + row.output_tokens).toLocaleString()}</td>
                    <td className="px-5 py-4">{row.actual_cost_usd == null ? "Unpriced" : `$${Number(row.actual_cost_usd).toFixed(4)}`}</td>
                    <td className="px-5 py-4 text-slate-500">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
