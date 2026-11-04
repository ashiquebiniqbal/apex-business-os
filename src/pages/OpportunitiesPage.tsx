import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useOrgOptions, useOrgTable } from "../lib/use-org-table";
import { canManage, permissionNote } from "../lib/roles";
import { friendlyError, isDemoText, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDate, formatDateTime, formatMoney, useOrganizationSettings } from "../lib/org-settings";
import { OPPORTUNITY_STATUSES, validateOpportunity } from "../lib/validation";
import { ConfirmDialog, DemoBadge, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, StatusPill, primaryButtonClass } from "../components/ui";

type Opportunity = { id: string; title: string; status: string; estimated_value: number; created_at: string; customer_id: string | null; inquiry_id: string | null; expected_close_date?: string | null; notes?: string | null };
type CustomerOption = { id: string; name: string };
type InquiryOption = { id: string; content: string };

const BASE_SELECT = "id,title,status,estimated_value,created_at,customer_id,inquiry_id";
const EXTENDED_SELECT = "expected_close_date,notes";

export function OpportunitiesPage() {
  const { activeOrganization } = useAuth();
  const { currency } = useOrganizationSettings(activeOrganization?.id ?? null);
  const table = useOrgTable<Opportunity>("opportunities", BASE_SELECT, EXTENDED_SELECT, "created_at");
  const customers = useOrgOptions<CustomerOption>("customers", "id,name", "name");
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Opportunity } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Opportunity | null>(null);
  const [actionError, setActionError] = useState("");

  const role = activeOrganization?.role;
  const manager = canManage(role);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return table.rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.title.toLowerCase().includes(query) || (row.customer_id && (customerNames.get(row.customer_id) ?? "").toLowerCase().includes(query));
    });
  }, [customerNames, search, statusFilter, table.rows]);

  const pipelineValue = useMemo(() => rows.filter((row) => row.status === "proposed" || row.status === "open").reduce((sum, row) => sum + Number(row.estimated_value), 0), [rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("opportunities", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Opportunity could not be deleted."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="CRM" title="Sales & Opportunities" subtitle={`Deal pipeline with stages, values, and expected close dates. Open pipeline: ${formatMoney(pipelineValue, currency)}.`}>
        <button disabled={!manager} title={manager ? undefined : permissionNote(role, "Opportunity changes") ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!manager)}>
          New opportunity
        </button>
      </PageHeader>
      {!manager && <p className="mb-4 text-xs text-slate-500">{permissionNote(role, "Opportunity changes")}</p>}
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading opportunities…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          {table.legacyMode && <MigrationNotice message="Expected close date and notes need the pending business-completion migration. Title, stage, value, and links work now." />}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search opportunities…" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All stages</option>
              {OPPORTUNITY_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <EmptyBlock title="No opportunities found" message={search || statusFilter !== "all" ? "No opportunities match these filters." : "Create your first opportunity, approve an inquiry workflow, or load the demo workspace from Settings."}>
              {manager && !search && statusFilter === "all" && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>New opportunity</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Opportunity", "Customer", "Stage", "Deal value", "Expected close", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-5 py-4 font-medium text-ink">{row.title}{isDemoText(row.title) && <DemoBadge />}</td>
                        <td className="px-5 py-4 text-slate-600">{row.customer_id ? customerNames.get(row.customer_id) ?? "Linked" : "—"}</td>
                        <td className="px-5 py-4"><StatusPill status={row.status} /></td>
                        <td className="px-5 py-4 text-slate-600">{formatMoney(Number(row.estimated_value), currency)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDate(row.expected_close_date ?? null)}</td>
                        <td className="px-5 py-4">
                          <div className="flex gap-2">
                            <button disabled={!manager} onClick={() => setFormState({ mode: "edit", row })} className="text-xs font-medium text-accent disabled:opacity-40">Edit</button>
                            <button disabled={!manager} onClick={() => setPendingDelete(row)} className="text-xs font-medium text-red-600 disabled:opacity-40">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {formState && <OpportunityForm initial={formState.mode === "edit" ? formState.row : null} legacyMode={table.legacyMode} customers={customers} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {pendingDelete && <ConfirmDialog title="Delete opportunity?" message={`"${pendingDelete.title}" will be permanently deleted.`} confirmLabel="Delete opportunity" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function OpportunityForm({ initial, legacyMode, customers, onClose, onSaved }: { initial: Opportunity | null; legacyMode: boolean; customers: CustomerOption[]; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const inquiries = useOrgOptions<InquiryOption>("inquiries", "id,content", "created_at");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState(initial?.status ?? "open");
  const [estimatedValue, setEstimatedValue] = useState(String(initial?.estimated_value ?? 0));
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [inquiryId, setInquiryId] = useState(initial?.inquiry_id ?? "");
  const [expectedClose, setExpectedClose] = useState(initial?.expected_close_date ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateOpportunity({ title, status, estimated_value: Number(estimatedValue), customer_id: customerId || null, inquiry_id: inquiryId || null, expected_close_date: legacyMode ? null : expectedClose || null, notes: legacyMode ? null : notes || null });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values: Record<string, unknown> = { title: checked.value.title, status, estimated_value: Number(estimatedValue), customer_id: customerId || null, inquiry_id: inquiryId || null };
      if (!legacyMode) {
        values.expected_close_date = expectedClose || null;
        values.notes = notes.trim() || null;
      }
      if (initial) await orgUpdate("opportunities", activeOrganization.id, initial.id, values);
      else await orgInsert("opportunities", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      setErrors([friendlyError(error, "Opportunity could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit opportunity" : "New opportunity"} subtitle="Deal value is an estimate. Quotation totals remain the commercial truth." onClose={onClose}>
      <Field label="Title"><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Sales stage">
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value)}>
            {OPPORTUNITY_STATUSES.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Deal value"><input className="field" type="number" min="0" step="0.01" value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer">
          <select className="field" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">No customer linked</option>
            {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}
          </select>
        </Field>
        <Field label="Linked inquiry">
          <select className="field" value={inquiryId} onChange={(event) => setInquiryId(event.target.value)}>
            <option value="">No inquiry linked</option>
            {inquiries.map((inquiry) => <option value={inquiry.id} key={inquiry.id}>{inquiry.content.slice(0, 60)}</option>)}
          </select>
        </Field>
      </div>
      {!legacyMode && (
        <>
          <Field label="Expected close date"><input className="field" type="date" value={expectedClose} onChange={(event) => setExpectedClose(event.target.value)} /></Field>
          <Field label="Notes"><textarea className="field min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></Field>
        </>
      )}
      <p className="mt-3 text-xs text-slate-400">Created {initial ? formatDateTime(initial.created_at) : "on save"}.</p>
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Create opportunity"}</button>
      </div>
    </Modal>
  );
}
