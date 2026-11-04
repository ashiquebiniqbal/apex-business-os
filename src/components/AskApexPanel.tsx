import { useEffect, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AGENT_REGISTRY } from "../lib/agents";
import { loadChat, loadRuns, loadRunsRemote, saveChat, saveRun, type AgentRun, type ChatMessage } from "../lib/agent-store";
import { approveProposal, runAgentRequest } from "../lib/orchestrator";
import { formatMoney, useOrganizationSettings } from "../lib/org-settings";

export function AskApexPanel() {
  const { activeOrganization, user } = useAuth();
  const location = useLocation();
  const { currency } = useOrganizationSettings(activeOrganization?.id ?? null);
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("auto");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const orgId = activeOrganization?.id ?? "";

  useEffect(() => { if (orgId) { setMessages(loadChat(orgId)); setRuns(loadRuns(orgId)); void loadRunsRemote(orgId).then((remote) => { if (remote.length) setRuns((local) => [...remote, ...local.filter((item) => !remote.some((r) => r.id === item.id))].slice(0, 50)); }); } }, [orgId]);
  useEffect(() => {
    const refresh = () => { if (orgId) setRuns(loadRuns(orgId)); };
    window.addEventListener("apex-agent-runs", refresh);
    return () => window.removeEventListener("apex-agent-runs", refresh);
  }, [orgId]);

  if (!activeOrganization) return null;
  const ctx = { orgId, role: activeOrganization.role, currency, userEmail: user?.email ?? "unknown", userId: user?.id };
  const activeRun = runs[0];

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true); setError(""); setPrompt("");
    const next = [...messages, { role: "user" as const, text, at: new Date().toISOString() }];
    setMessages(next); saveChat(orgId, next);
    try {
      const run = await runAgentRequest(ctx, text, agent);
      setRuns(loadRuns(orgId));
      const withReply = [...next, { role: "assistant" as const, text: run.result, at: new Date().toISOString() }];
      setMessages(withReply); saveChat(orgId, withReply);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Ask Apex failed.");
    } finally { setBusy(false); }
  };

  const decide = async (run: AgentRun, proposalId: string, decision: "approved" | "rejected", quantity?: number) => {
    const proposal = run.approvals.find((item) => item.id === proposalId);
    if (!proposal) return;
    setBusy(true);
    try {
      if (decision === "rejected") { proposal.status = "rejected"; proposal.result = "Rejected by you. Nothing was saved."; saveRun(run); }
      else { if (quantity && quantity > 0) proposal.args = { ...proposal.args, quantity }; await approveProposal(ctx, run, proposal); }
      setRuns(loadRuns(orgId));
    } finally { setBusy(false); }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-medium text-white shadow-lg" aria-label="Open Ask Apex"><Bot size={17} /> Ask Apex</button>
      {open && (
        <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl" aria-label="Ask Apex panel">
          <div className="flex items-start justify-between border-b border-slate-100 p-4">
            <div><h2 className="font-semibold">Ask Apex</h2><p className="mt-0.5 text-xs text-slate-500">{activeOrganization.name} · {activeOrganization.role} · Page: {location.pathname} · Currency: {currency}</p></div>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 p-1.5" aria-label="Close Ask Apex"><X size={16} /></button>
          </div>
          <div className="border-b border-slate-100 p-4">
            <label className="text-xs font-medium text-slate-500">Agent<select value={agent} onChange={(event) => setAgent(event.target.value)} className="field mt-1"><option value="auto">Auto / Orchestrator</option>{AGENT_REGISTRY.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            <p className="mt-2 text-xs leading-5 text-slate-500">Ask Apex runs deterministic, organization-scoped business tools under your role. It does not call Meta and is not AI analysis. Drafts are never sent automatically.</p>
            <NavLink to="/assistant" onClick={() => setOpen(false)} className="mt-2 block rounded-lg bg-blue-50 p-2.5 text-xs font-medium leading-5 text-blue-900">For Meta AI inquiry analysis, use AI Assistant → “Analyze with Meta AI”. Prices and approvals stay database-controlled there.</NavLink>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Try: “Review pending inquiries, identify relevant products, prepare quotations, check the calculations and show me the proposals for approval.”</p>}
            {messages.map((message, index) => <div key={`${message.at}-${index}`} className={`rounded-xl p-3 text-sm leading-6 ${message.role === "user" ? "ml-8 bg-ink text-white" : "mr-4 bg-slate-50 text-slate-700"}`}>{message.text}</div>)}
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {activeRun && (
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Execution · {activeRun.status.replace(/_/g, " ")}</p>
                <ol className="mt-2 space-y-1.5 text-xs text-slate-600">{activeRun.steps.map((step, index) => <li key={`${step.at}-${index}`}><span className="font-medium capitalize">{step.agent}</span>{step.tool ? ` · ${step.tool}` : ""} — {step.detail}</li>)}</ol>
                {activeRun.tasks && activeRun.tasks.length > 1 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plan tasks</p>
                    <ol className="mt-1.5 space-y-1 text-xs text-slate-600">{activeRun.tasks.map((task) => <li key={task.id} className="flex items-start justify-between gap-2"><span><span className="font-medium capitalize">{task.agent}</span> — {task.title}{task.detail ? <span className="block text-slate-500">{task.detail}</span> : null}</span><span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${task.status === "completed" ? "bg-emerald-50 text-emerald-700" : task.status === "failed" ? "bg-red-50 text-red-700" : task.status === "blocked" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{task.status}</span></li>)}</ol>
                  </div>
                )}
                {activeRun.review && (
                  <div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                    <div>
                      <p className="font-semibold uppercase tracking-wide text-slate-400">Inquiry review · {activeRun.review.totalPending} pending</p>
                      {activeRun.review.inquiries.map((item) => (
                        <div key={item.inquiryId} className="mt-1.5 rounded-lg bg-slate-50 p-2">
                          <p><span className="font-medium text-slate-800">{item.customerName ?? "Customer not linked"}</span> — {item.summary}</p>
                          <p>Match: {item.match.status === "matched" ? `${item.match.product?.name} (${item.match.product?.sku}) · evidence: ${item.match.evidence.join(", ") || "name match"} · quantity ${item.match.quantity}${item.match.quantityStated ? "" : " (not stated)"}` : item.match.status === "ambiguous" ? `ambiguous — ${item.match.candidates.map((c) => c.name).join("; ")}` : "no product match"}</p>
                          {item.missingInformation.length > 0 && <p className="text-amber-700">Missing: {item.missingInformation.join(" ")}</p>}
                        </div>
                      ))}
                    </div>
                    {activeRun.review.previews.length > 0 && (
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-slate-400">Quotation proposals</p>
                        {activeRun.review.previews.map((preview) => (
                          <div key={preview.inquiryId} className="mt-1.5 rounded-lg bg-slate-50 p-2">
                            <p className="font-medium text-slate-800">{preview.productName} ({preview.sku}) x{preview.quantity}</p>
                            <p>Unit price {formatMoney(preview.unitPrice, preview.currency)} · Tax {preview.taxRate}% · Subtotal {formatMoney(preview.subtotal, preview.currency)} · Tax amount {formatMoney(preview.taxTotal, preview.currency)} · Total {formatMoney(preview.total, preview.currency)} · Recorded stock {preview.stockQty}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeRun.review.quality.length > 0 && (
                      <div>
                        <p className="font-semibold uppercase tracking-wide text-slate-400">Quality review</p>
                        {activeRun.review.quality.map((entry) => (
                          <div key={entry.inquiryId} className="mt-1.5 rounded-lg bg-slate-50 p-2">
                            <p><span className={`font-semibold ${entry.check.verdict === "PASS" ? "text-emerald-700" : entry.check.verdict === "WARNING" ? "text-amber-700" : "text-red-700"}`}>{entry.check.verdict}</span> — {entry.check.reasons.join(" ")}</p>
                            {entry.check.actions.length > 0 && <p>Corrective action: {entry.check.actions.join(" ")}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="rounded-lg bg-blue-50 p-2 text-blue-900">Final status: {activeRun.review.readyCount} ready for review · {activeRun.review.clarificationCount} requiring clarification · {activeRun.review.blockedCount} blocked. No quotation has been approved or sent.</p>
                  </div>
                )}
                {activeRun.approvals.map((proposal) => (
                  <ApprovalCard key={proposal.id} run={activeRun} proposalId={proposal.id} busy={busy} onDecide={(decision, quantity) => void decide(activeRun, proposal.id, decision, quantity)} />
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 border-t border-slate-100 p-4">
            <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="Ask an agent…" className="field mt-0 flex-1" aria-label="Ask Apex message" />
            <button disabled={busy || !prompt.trim()} onClick={() => void send()} className="rounded-xl bg-ink px-3 text-white disabled:opacity-50" aria-label="Send"><Send size={16} /></button>
          </div>
        </aside>
      )}
    </>
  );
}

function ApprovalCard({ run, proposalId, busy, onDecide }: { run: AgentRun; proposalId: string; busy: boolean; onDecide: (decision: "approved" | "rejected", quantity?: number) => void }) {
  const proposal = run.approvals.find((item) => item.id === proposalId);
  const [quantity, setQuantity] = useState(1);
  if (!proposal) return null;
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium">{proposal.title}</p>
      <p className="mt-1 text-xs leading-5">{proposal.affected}</p>
      {proposal.financialImpact && <p className="mt-1 text-xs font-medium">{proposal.financialImpact}</p>}
      {proposal.status === "pending" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-xs">Qty <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="w-16 rounded-lg border border-amber-200 bg-white px-2 py-1.5" /></label>
          <button disabled={busy} onClick={() => onDecide("approved", quantity)} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">Approve &amp; save draft</button>
          <button disabled={busy} onClick={() => onDecide("rejected")} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium">Reject</button>
        </div>
      ) : <p className="mt-2 text-xs font-medium">{proposal.status === "approved" ? "Approved" : "Rejected"}{proposal.result ? ` — ${proposal.result}` : ""}</p>}
    </div>
  );
}
