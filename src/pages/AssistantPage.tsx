import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { useOrgOptions } from "../lib/use-org-table";
import { canManage, canOperate, permissionNote } from "../lib/roles";
import { friendlyError } from "../lib/records";
import { approveInquiryWorkflow, proposeInquiryWorkflow, type WorkflowProposal } from "../lib/workflow";
import { Field, FormErrors, PageHeader, primaryButtonClass } from "../components/ui";

type InquiryOption = { id: string; content: string; status: string; customer_id: string | null };

const EMPTY_FORM = { inquiry: "", customerName: "", customerEmail: "", productQuery: "", quantity: 1, additionalRequirements: "" };

export function AssistantPage() {
  const { activeOrganization } = useAuth();
  const inquiries = useOrgOptions<InquiryOption>("inquiries", "id,content,status,customer_id", "created_at");
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState(EMPTY_FORM);
  const [linkedInquiryId, setLinkedInquiryId] = useState("");
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmingApprove, setConfirmingApprove] = useState(false);

  const role = activeOrganization?.role;
  const proposer = canOperate(role);
  const approver = canManage(role);

  useEffect(() => {
    const preselected = searchParams.get("inquiry");
    if (preselected && inquiries.length && !linkedInquiryId) {
      const found = inquiries.find((inquiry) => inquiry.id === preselected);
      if (found) {
        setLinkedInquiryId(found.id);
        setForm((current) => ({ ...current, inquiry: found.content }));
      }
    }
  }, [inquiries, linkedInquiryId, searchParams]);

  const linkInquiry = (id: string) => {
    setLinkedInquiryId(id);
    const found = inquiries.find((inquiry) => inquiry.id === id);
    if (found) setForm((current) => ({ ...current, inquiry: current.inquiry.trim() ? current.inquiry : found.content }));
  };

  const run = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    setProposal(null);
    setConfirmingApprove(false);
    try {
      const result = await proposeInquiryWorkflow({ ...form, quantity: Number(form.quantity) });
      setProposal(result);
      if (result.status === "needs_clarification") {
        setNotice("The server needs clarification before a proposal can be created. See the missing information below.");
      } else if (linkedInquiryId && supabase && activeOrganization) {
        await supabase.from("inquiries").update({ status: "processing" }).eq("id", linkedInquiryId).eq("org_id", activeOrganization.id);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Workflow failed");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!proposal?.workflow_run_id) return;
    setBusy(true);
    setError("");
    try {
      const result = await approveInquiryWorkflow(proposal.workflow_run_id);
      setProposal(result);
      setConfirmingApprove(false);
      setNotice("Approved and executed. Quotation, opportunity, follow-up, and audit records were written by the server.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!proposal?.workflow_run_id || !supabase || !activeOrganization) return;
    setBusy(true);
    setError("");
    try {
      const { data: run, error: runError } = await supabase.from("workflow_runs").select("id,inquiry_id,output").eq("id", proposal.workflow_run_id).eq("org_id", activeOrganization.id).single();
      if (runError || !run) throw new Error("Workflow run could not be found for rejection.");
      if (run.inquiry_id) {
        const { error: inquiryError } = await supabase.from("inquiries").update({ status: "rejected" }).eq("id", run.inquiry_id).eq("org_id", activeOrganization.id);
        if (inquiryError) throw inquiryError;
      }
      await supabase.from("workflow_runs").update({ output: { ...(typeof run.output === "object" && run.output ? run.output : {}), rejected: true, rejected_at: new Date().toISOString() } }).eq("id", run.id).eq("org_id", activeOrganization.id);
      setProposal({ ...proposal, status: "rejected" });
      setNotice("Proposal rejected. The inquiry was marked rejected; nothing was executed.");
    } catch (value) {
      setError(friendlyError(value, "Proposal could not be rejected."));
    } finally {
      setBusy(false);
    }
  };

  const update = (key: keyof typeof form, value: string | number) => setForm((current) => ({ ...current, [key]: value }));
  const valid = form.inquiry.trim().length >= 3 && form.customerName.trim().length >= 1 && form.productQuery.trim().length >= 1 && Number(form.quantity) > 0;

  return (
    <>
      <PageHeader eyebrow="Meta AI workflow" title="Inquiry to quotation" subtitle="This is the Meta AI analysis path: the deployed inquiry-workflow calls the configured Meta provider and a verified routed model. Supabase and the database control business truth, and human approval is always required before execution." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
            <p className="font-semibold">Primary action: Analyze with Meta AI.</p>
            <p className="mt-1 text-xs leading-5 text-blue-700">“Analyze with Meta AI” invokes the deployed <span className="font-mono">inquiry-workflow</span> Edge Function. If Meta fails, the actual server error is shown here — there is no silent deterministic substitute. Human approval is always required: no quotation, opportunity, task, or authoritative audit event is executed during analysis. Prices and totals come from database records.</p>
          </div>
          <Field label="Start from an existing inquiry (optional)">
            <select className="field" value={linkedInquiryId} onChange={(event) => linkInquiry(event.target.value)}>
              <option value="">Write a new inquiry below</option>
              {inquiries.map((inquiry) => <option value={inquiry.id} key={inquiry.id}>[{inquiry.status}] {inquiry.content.slice(0, 70)}</option>)}
            </select>
          </Field>
          <Field label="Customer name"><input className="field" value={form.customerName} onChange={(event) => update("customerName", event.target.value)} /></Field>
          <Field label="Customer email"><input className="field" type="email" value={form.customerEmail} onChange={(event) => update("customerEmail", event.target.value)} /></Field>
          <Field label="Inquiry description"><textarea className="field min-h-28" value={form.inquiry} onChange={(event) => update("inquiry", event.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product lookup"><input className="field" value={form.productQuery} onChange={(event) => update("productQuery", event.target.value)} /></Field>
            <Field label="Quantity"><input className="field" type="number" min="1" value={form.quantity} onChange={(event) => update("quantity", Number(event.target.value))} /></Field>
          </div>
          <Field label="Additional requirements"><textarea className="field min-h-20" value={form.additionalRequirements} onChange={(event) => update("additionalRequirements", event.target.value)} /></Field>
          {!proposer && <p className="mt-3 text-xs text-slate-500">{permissionNote(role, "Workflow proposals")}</p>}
          <button disabled={busy || !proposer || !valid} onClick={() => void run()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            <Sparkles size={16} />{busy ? "Analyzing with Meta AI…" : "Analyze with Meta AI — prepare review proposal"}
          </button>
          {!valid && <p className="mt-2 text-xs text-slate-500">Inquiry, customer name, product, and a positive quantity are required.</p>}
          {notice && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{notice}</p>}
          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </section>
        <ReviewPanel proposal={proposal} busy={busy} approver={approver} confirmingApprove={confirmingApprove} onApprove={() => void approve()} onAskApprove={() => setConfirmingApprove(true)} onCancelApprove={() => setConfirmingApprove(false)} onReject={() => void reject()} onEdit={() => setProposal(null)} />
      </div>
    </>
  );
}

function ReviewPanel({ proposal, busy, approver, confirmingApprove, onApprove, onAskApprove, onCancelApprove, onReject, onEdit }: { proposal: WorkflowProposal | null; busy: boolean; approver: boolean; confirmingApprove: boolean; onApprove: () => void; onAskApprove: () => void; onCancelApprove: () => void; onReject: () => void; onEdit: () => void }) {
  if (!proposal) {
    return (
      <section className="rounded-2xl bg-slate-900 p-6 text-slate-100">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Review panel</p>
        <div className="mt-8 space-y-5 text-sm text-slate-300">
          <p>1. Meta extracts intent and requirements.</p>
          <p>2. Apex looks up the real customer and product context.</p>
          <p>3. Database rules calculate the quotation.</p>
          <p>4. A manager, admin, or owner approves execution.</p>
          <p>5. The server writes CRM, follow-up, and audit records.</p>
        </div>
      </section>
    );
  }
  const review = proposal.proposal;
  const analysis = proposal.analysis ?? review?.ai_analysis;
  const missing = [...(proposal.missing_information ?? []), ...(review?.missing_information ?? [])];
  const routing = proposal.model_routing;
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{proposal.status === "executed" ? "Execution result" : proposal.status === "rejected" ? "Rejected proposal" : proposal.status === "needs_clarification" ? "Needs clarification" : "Human review"}</p>
            <h2 className="mt-1 text-xl font-semibold">{review?.customer?.name ?? "Workflow proposal"}</h2>
            {proposal.request_id && <p className="mt-1 font-mono text-[11px] text-slate-400">Request {proposal.request_id}</p>}
          </div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{proposal.status}</span>
        </div>
        {routing && (
          <p className="mt-3 text-xs text-slate-500">
            Model {routing.actual_model ?? routing.selected_model ?? "unknown"} · {routing.routing_mode ?? "auto"} routing{routing.fallback_from ? ` · fallback from ${routing.fallback_from}` : ""}{routing.latency_ms != null ? ` · ${routing.latency_ms} ms` : ""}
          </p>
        )}
        {review?.product && (
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Product" value={review.product.name} />
            <Metric label="Quantity" value={String(review.quantity)} />
            <Metric label="Recorded stock" value={String(review.product.recorded_stock)} />
          </div>
        )}
        {review?.quotation_preview && (
          <div className="mt-5 rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deterministic quotation preview</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Metric label="Subtotal" value={`${review.currency} ${review.quotation_preview.subtotal.toLocaleString()}`} />
              <Metric label="Tax" value={`${review.currency} ${review.quotation_preview.tax_total.toLocaleString()}`} />
              <Metric label="Total" value={`${review.currency} ${review.quotation_preview.total.toLocaleString()}`} />
            </div>
            <p className="mt-3 text-xs text-slate-500">{review.quotation_preview.authoritative}</p>
            {review.product && <p className="mt-2 text-xs text-slate-500">Pricing basis: recorded unit price {review.currency} {review.product.unit_price.toLocaleString()} · tax {review.product.tax_rate}% (recorded product tax rate, applied after subtotal) · quantity {review.quantity}.</p>}
          </div>
        )}
        {proposal.status === "executed" && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Quotation, opportunity, follow-up, and audit execution completed. Replaying this workflow is idempotent.</p>}
        {proposal.status === "rejected" && <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-700">This proposal was rejected. No business records were executed.</p>}
        {proposal.workflow_run_id && proposal.status !== "executed" && proposal.status !== "rejected" && (
          <div className="mt-5 flex flex-wrap gap-2">
            {confirmingApprove ? (
              <>
                <button disabled={busy || !approver} onClick={onApprove} className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "Executing…" : "Confirm approval"}</button>
                <button disabled={busy} onClick={onCancelApprove} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Back</button>
              </>
            ) : (
              <>
                <button disabled={busy || !approver} title={approver ? undefined : "Only a manager, admin, or owner can approve proposals."} onClick={onAskApprove} className={primaryButtonClass(busy || !approver)}>Approve & execute</button>
                <button disabled={busy} onClick={onEdit} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Edit & re-propose</button>
                <button disabled={busy} onClick={onReject} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600">Reject</button>
              </>
            )}
          </div>
        )}
        {!approver && proposal.status !== "executed" && <p className="mt-3 text-xs text-slate-500">Approval requires a manager, admin, or owner role.</p>}
      </div>
      {analysis && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{proposal.analysis_source === "meta" ? `Meta AI analysis · model ${routing?.actual_model ?? routing?.selected_model ?? "verified routed model"}` : "Analysis"}</p>
          {proposal.analysis_source !== "meta" && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900"><span className="font-semibold">Not a Meta AI response.</span> The server reported <span className="font-mono">{proposal.analysis_source ?? "unknown source"}</span>, so this content is a deterministic fallback built from your input and database lookup only. It must not be presented as Meta analysis.</p>
          )}
          <p className="mt-3 text-sm leading-6 text-slate-700">{analysis.summary}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Metric label="Intent" value={analysis.customer_intent} />
            <Metric label="Category" value={analysis.business_category} />
            <Metric label="Next action" value={analysis.suggested_next_action} />
            <Metric label="Budget status" value={proposal.usage?.budget_guarded ? "Guarded" : "Not charged / not verified"} />
          </div>
          {analysis.product_requirements?.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Identified requirements &amp; recommendation basis</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {analysis.product_requirements.map((requirement, index) => (
                  <li key={`${requirement.product_query}-${index}`}>{requirement.product_query} — quantity {requirement.quantity} {requirement.unit}{requirement.constraints.length ? `. Constraints: ${requirement.constraints.join("; ")}` : ""}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.important_constraints?.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Important constraints &amp; reasoning</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {analysis.important_constraints.map((constraint, index) => <li key={`${constraint}-${index}`}>{constraint}</li>)}
              </ul>
            </div>
          )}
          {missing.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Warnings and missing information</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{missing.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <FormErrors errors={[]} />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm font-medium text-slate-800">{value}</p></div>;
}
