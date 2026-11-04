import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useOrgOptions, useOrgTable } from "../lib/use-org-table";
import { canManage, canOperate, permissionNote } from "../lib/roles";
import { friendlyError, isDemoText, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDateTime } from "../lib/org-settings";
import { INQUIRY_STATUSES, validateInquiry } from "../lib/validation";
import { ConfirmDialog, DemoBadge, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, StatusPill, primaryButtonClass } from "../components/ui";

type Inquiry = { id: string; content: string; status: string; customer_id: string | null; created_at: string; assigned_to?: string | null };
type CustomerOption = { id: string; name: string };
type MemberOption = { user_id: string; role: string };

const BASE_SELECT = "id,content,status,customer_id,created_at";
const EXTENDED_SELECT = "assigned_to";

export function InquiriesPage() {
  const { activeOrganization } = useAuth();
  const table = useOrgTable<Inquiry>("inquiries", BASE_SELECT, EXTENDED_SELECT, "created_at");
  const customers = useOrgOptions<CustomerOption>("customers", "id,name", "name");
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Inquiry } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Inquiry | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchParams] = useSearchParams();

  const role = activeOrganization?.role;
  const writer = canOperate(role);

  useEffect(() => {
    if (searchParams.get("new") === "1" && canOperate(activeOrganization?.role)) setFormState({ mode: "create" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const deleter = canManage(role);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return table.rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.content.toLowerCase().includes(query) || (row.customer_id && (customerNames.get(row.customer_id) ?? "").toLowerCase().includes(query));
    });
  }, [customerNames, search, statusFilter, table.rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("inquiries", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Inquiry could not be deleted."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="CRM" title="Inquiry inbox" subtitle="Capture demand manually, link it to customers, and route it to the AI assistant for a reviewed proposal.">
        <button disabled={!writer} title={writer ? undefined : permissionNote(role, "Inquiry changes") ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!writer)}>
          New inquiry
        </button>
      </PageHeader>
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading inquiries…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          {table.legacyMode && <MigrationNotice message="Inquiry assignment needs the pending business-completion migration. Content, status, and customer links work now." />}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search inquiries…" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All statuses</option>
              {INQUIRY_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <EmptyBlock title="No inquiries found" message={search || statusFilter !== "all" ? "No inquiries match these filters." : "Record your first inquiry manually, or load the labelled demo workspace from Settings."}>
              {writer && !search && statusFilter === "all" && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>New inquiry</button>}
            </EmptyBlock>
          ) : (
            <div className="grid gap-4">
              {rows.map((row) => (
                <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" key={row.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold">
                        {row.customer_id ? customerNames.get(row.customer_id) ?? "Linked customer" : "Unlinked inquiry"}
                        {isDemoText(row.content) && <DemoBadge />}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{row.content}</p>
                    </div>
                    <StatusPill status={row.status} />
                  </div>
                  <p className="mt-4 text-xs text-slate-400">Received {formatDateTime(row.created_at)}{row.assigned_to ? ` · Assigned to ${shortId(row.assigned_to)}` : ""}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <NavLink to={`/assistant?inquiry=${row.id}`} className="rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white">Process with AI</NavLink>
                    <button disabled={!writer} onClick={() => setFormState({ mode: "edit", row })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 disabled:opacity-40">Edit</button>
                    <button disabled={!deleter} onClick={() => setPendingDelete(row)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-red-600 disabled:opacity-40">Delete</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {formState && <InquiryForm initial={formState.mode === "edit" ? formState.row : null} legacyMode={table.legacyMode} customers={customers} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {pendingDelete && <ConfirmDialog title="Delete inquiry?" message="This inquiry will be permanently deleted. Linked quotations, opportunities, and tasks keep their records but lose the inquiry link." confirmLabel="Delete inquiry" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function shortId(value: string): string {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

function InquiryForm({ initial, legacyMode, customers, onClose, onSaved }: { initial: Inquiry | null; legacyMode: boolean; customers: CustomerOption[]; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const members = useOrgOptions<MemberOption>("org_members", "user_id,role", "role");
  const [content, setContent] = useState(initial?.content ?? "");
  const [status, setStatus] = useState(initial?.status ?? "new");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateInquiry({ content, status, customer_id: customerId || null, assigned_to: legacyMode ? null : assignedTo || null });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values: Record<string, unknown> = { content: checked.value.content, status, customer_id: customerId || null };
      if (!legacyMode) values.assigned_to = assignedTo || null;
      if (initial) await orgUpdate("inquiries", activeOrganization.id, initial.id, values);
      else await orgInsert("inquiries", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      setErrors([friendlyError(error, "Inquiry could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit inquiry" : "New inquiry"} subtitle="Saved to the active organization. Link a customer before AI processing for best results." onClose={onClose}>
      <Field label="Inquiry description"><textarea className="field min-h-28" value={content} onChange={(event) => setContent(event.target.value)} maxLength={10000} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status">
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value)}>
            {INQUIRY_STATUSES.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Linked customer">
          <select className="field" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">No customer linked</option>
            {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}
          </select>
        </Field>
      </div>
      {!legacyMode && (
        <Field label="Assigned to">
          <select className="field" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => <option value={member.user_id} key={member.user_id}>{member.role} · {shortId(member.user_id)}</option>)}
          </select>
        </Field>
      )}
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Create inquiry"}</button>
      </div>
    </Modal>
  );
}
