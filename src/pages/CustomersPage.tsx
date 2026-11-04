import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { useOrgTable } from "../lib/use-org-table";
import { canManage, canOperate, permissionNote } from "../lib/roles";
import { friendlyError, isDemoCustomer, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDateTime } from "../lib/org-settings";
import { validateCustomer } from "../lib/validation";
import { ConfirmDialog, DemoBadge, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, StatusPill, primaryButtonClass } from "../components/ui";

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  customer_type?: string | null;
  address?: string | null;
  notes?: string | null;
};

type History = { inquiries: Array<{ id: string; status: string; created_at: string }>; quotations: Array<{ id: string; status: string; total: number }>; opportunities: Array<{ id: string; title: string; status: string }>; tasks: Array<{ id: string; title: string; status: string }> };

const BASE_SELECT = "id,name,email,phone,created_at";
const EXTENDED_SELECT = "customer_type,address,notes";

export function CustomersPage() {
  const { activeOrganization } = useAuth();
  const table = useOrgTable<Customer>("customers", BASE_SELECT, EXTENDED_SELECT, "created_at");
  const [search, setSearch] = useState("");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Customer } | null>(null);
  const [detail, setDetail] = useState<Customer | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Customer | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchParams] = useSearchParams();

  const role = activeOrganization?.role;
  const writer = canOperate(role);

  useEffect(() => {
    if (searchParams.get("new") === "1" && canOperate(activeOrganization?.role)) setFormState({ mode: "create" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const deleter = canManage(role);
  const note = permissionNote(role, "Customer changes");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return table.rows;
    return table.rows.filter((row) => [row.name, row.email ?? "", row.phone ?? ""].some((value) => value.toLowerCase().includes(query)));
  }, [search, table.rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("customers", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Customer could not be deleted."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Customers" subtitle="Customer relationships and account history. Records are scoped to the active organization.">
        <button disabled={!writer} title={writer ? undefined : note ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!writer)}>
          Add customer
        </button>
      </PageHeader>
      {note && writer && <p className="mb-4 text-xs text-slate-500">{note}</p>}
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading customers…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          {table.legacyMode && <MigrationNotice message="Customer type, address, and notes need the pending business-completion migration. Name, email, and phone work now." />}
          <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder="Search customers by name, email, or phone…" /></div>
          {rows.length === 0 ? (
            <EmptyBlock title="No customers found" message={search ? "No customers match this search." : "Add your first customer, or load the labelled demo workspace from Settings."}>
              {writer && !search && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>Add customer</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Customer", "Type", "Email", "Phone", "Created", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-5 py-4 font-medium text-ink">
                          <button className="text-left hover:text-accent" onClick={() => setDetail(row)}>{row.name}</button>
                          {isDemoCustomer(row) && <DemoBadge />}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{row.customer_type ?? "—"}</td>
                        <td className="px-5 py-4 text-slate-600">{row.email ?? "—"}</td>
                        <td className="px-5 py-4 text-slate-600">{row.phone ?? "—"}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDateTime(row.created_at)}</td>
                        <td className="px-5 py-4">
                          <div className="flex gap-2">
                            <button disabled={!writer} onClick={() => setFormState({ mode: "edit", row })} className="text-xs font-medium text-accent disabled:opacity-40">Edit</button>
                            <button disabled={!deleter} onClick={() => setPendingDelete(row)} className="text-xs font-medium text-red-600 disabled:opacity-40">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">Rows are scoped to the active organization by Supabase RLS.</p>
            </div>
          )}
        </>
      )}
      {formState && <CustomerForm initial={formState.mode === "edit" ? formState.row : null} legacyMode={table.legacyMode} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {detail && <CustomerDetail row={detail} onClose={() => setDetail(null)} onEdit={() => { setFormState({ mode: "edit", row: detail }); setDetail(null); }} canEdit={writer} />}
      {pendingDelete && <ConfirmDialog title="Delete customer?" message={`"${pendingDelete.name}" will be permanently deleted. Linked inquiries, quotations, opportunities, and tasks keep their records but lose the customer link.`} confirmLabel="Delete customer" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function CustomerForm({ initial, legacyMode, onClose, onSaved }: { initial: Customer | null; legacyMode: boolean; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [customerType, setCustomerType] = useState(initial?.customer_type ?? "company");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateCustomer({ name, email: email || null, phone: phone || null, customer_type: legacyMode ? null : customerType, address: legacyMode ? null : address || null, notes: legacyMode ? null : notes || null });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values: Record<string, unknown> = { name: checked.value.name, email: email.trim() || null, phone: phone.trim() || null };
      if (!legacyMode) {
        values.customer_type = customerType;
        values.address = address.trim() || null;
        values.notes = notes.trim() || null;
      }
      if (initial) await orgUpdate("customers", activeOrganization.id, initial.id, values);
      else await orgInsert("customers", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      setErrors([friendlyError(error, "Customer could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit customer" : "Add customer"} subtitle="Saved to the active organization with role enforcement." onClose={onClose}>
      <Field label="Name / company name"><input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email"><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Phone"><input className="field" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} /></Field>
      </div>
      {!legacyMode && (
        <>
          <Field label="Customer type">
            <select className="field" value={customerType} onChange={(event) => setCustomerType(event.target.value)}>
              <option value="company">Company</option>
              <option value="individual">Individual</option>
            </select>
          </Field>
          <Field label="Address"><textarea className="field min-h-16" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={1000} /></Field>
          <Field label="Notes"><textarea className="field min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></Field>
        </>
      )}
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Add customer"}</button>
      </div>
    </Modal>
  );
}

function CustomerDetail({ row, onClose, onEdit, canEdit }: { row: Customer; onClose: () => void; onEdit: () => void; canEdit: boolean }) {
  const { activeOrganization } = useAuth();
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    void Promise.all([
      supabase.from("inquiries").select("id,status,created_at").eq("org_id", activeOrganization.id).eq("customer_id", row.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("quotations").select("id,status,total").eq("org_id", activeOrganization.id).eq("customer_id", row.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("opportunities").select("id,title,status").eq("org_id", activeOrganization.id).eq("customer_id", row.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("tasks").select("id,title,status").eq("org_id", activeOrganization.id).eq("customer_id", row.id).order("created_at", { ascending: false }).limit(10),
    ]).then(([inquiries, quotations, opportunities, tasks]) => {
      if (!active) return;
      setHistory({ inquiries: (inquiries.data ?? []) as History["inquiries"], quotations: (quotations.data ?? []) as History["quotations"], opportunities: (opportunities.data ?? []) as History["opportunities"], tasks: (tasks.data ?? []) as History["tasks"] });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeOrganization, row.id]);

  return (
    <Modal title={row.name} subtitle={`Customer profile · created ${formatDateTime(row.created_at)}`} onClose={onClose}>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</dt><dd className="mt-1 font-medium">{row.email ?? "—"}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</dt><dd className="mt-1 font-medium">{row.phone ?? "—"}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Type</dt><dd className="mt-1 font-medium">{row.customer_type ?? "—"}</dd></div>
        <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Address</dt><dd className="mt-1 font-medium">{row.address || "—"}</dd></div>
      </dl>
      {row.notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{row.notes}</p>}
      <h3 className="mt-5 font-semibold">Customer history</h3>
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading history…</p>
      ) : history ? (
        <div className="mt-3 space-y-3 text-sm">
          <HistoryGroup label="Inquiries" to="/inquiries" items={history.inquiries.map((item) => ({ id: item.id, label: `Inquiry ${item.id.slice(0, 8)}`, status: item.status }))} />
          <HistoryGroup label="Quotations" to="/quotations" items={history.quotations.map((item) => ({ id: item.id, label: `Quotation ${item.id.slice(0, 8)}`, status: item.status }))} />
          <HistoryGroup label="Opportunities" to="/opportunities" items={history.opportunities.map((item) => ({ id: item.id, label: item.title, status: item.status }))} />
          <HistoryGroup label="Tasks" to="/tasks" items={history.tasks.map((item) => ({ id: item.id, label: item.title, status: item.status }))} />
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Close</button>
        {canEdit && <button onClick={onEdit} className={primaryButtonClass()}>Edit customer</button>}
      </div>
    </Modal>
  );
}

function HistoryGroup({ label, to, items }: { label: string; to: string; items: Array<{ id: string; label: string; status: string }> }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label} · {items.length}</p>
        <Link to={to} className="text-xs text-accent">Open</Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-1 text-slate-500">None yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="truncate font-medium">{item.label}</span>
              <StatusPill status={item.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
