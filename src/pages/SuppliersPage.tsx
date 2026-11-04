import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useOrgTable } from "../lib/use-org-table";
import { canManage, canOperate, permissionNote } from "../lib/roles";
import { friendlyError, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDateTime } from "../lib/org-settings";
import { validateSupplier } from "../lib/validation";
import { ConfirmDialog, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, primaryButtonClass } from "../components/ui";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
};

const BASE_SELECT = "id,name,email,phone,address,notes,created_at";

export function SuppliersPage() {
  const { activeOrganization } = useAuth();
  const table = useOrgTable<Supplier>("suppliers", BASE_SELECT, null, "created_at");
  const [search, setSearch] = useState("");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Supplier } | null>(null);
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);
  const [actionError, setActionError] = useState("");

  const role = activeOrganization?.role;
  const writer = canOperate(role);
  const deleter = canManage(role);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return table.rows;
    return table.rows.filter((row) => [row.name, row.email ?? "", row.phone ?? ""].some((value) => value.toLowerCase().includes(query)));
  }, [search, table.rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("suppliers", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Supplier could not be deleted."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Suppliers" subtitle="Vendor relationships for purchasing and restocking. Records are scoped to the active organization.">
        {!table.tableMissing && (
          <button disabled={!writer} title={writer ? undefined : permissionNote(role, "Supplier changes") ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!writer)}>
            Add supplier
          </button>
        )}
      </PageHeader>
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading suppliers…" />
      ) : table.tableMissing ? (
        <MigrationNotice message="The suppliers table needs the pending business-completion migration (20261104004000_apex_business_completion.sql). The migration is prepared in the repository and awaits approval; this page becomes operational as soon as it is applied." />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          <div className="mb-4"><SearchInput value={search} onChange={setSearch} placeholder="Search suppliers by name, email, or phone…" /></div>
          {rows.length === 0 ? (
            <EmptyBlock title="No suppliers found" message={search ? "No suppliers match this search." : "Add your first supplier to track vendor relationships."}>
              {writer && !search && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>Add supplier</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Supplier", "Email", "Phone", "Created", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-5 py-4 font-medium text-ink"><button className="text-left hover:text-accent" onClick={() => setDetail(row)}>{row.name}</button></td>
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
            </div>
          )}
        </>
      )}
      {formState && <SupplierForm initial={formState.mode === "edit" ? formState.row : null} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {detail && (
        <Modal title={detail.name} subtitle={`Supplier profile · created ${formatDateTime(detail.created_at)}`} onClose={() => setDetail(null)}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</dt><dd className="mt-1 font-medium">{detail.email ?? "—"}</dd></div>
            <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</dt><dd className="mt-1 font-medium">{detail.phone ?? "—"}</dd></div>
          </dl>
          <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Address</p><p className="mt-1 text-sm font-medium">{detail.address || "—"}</p></div>
          {detail.notes && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{detail.notes}</p>}
          <div className="mt-5 flex justify-end">
            <button onClick={() => setDetail(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Close</button>
          </div>
        </Modal>
      )}
      {pendingDelete && <ConfirmDialog title="Delete supplier?" message={`"${pendingDelete.name}" will be permanently deleted.`} confirmLabel="Delete supplier" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function SupplierForm({ initial, onClose, onSaved }: { initial: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateSupplier({ name, email: email || null, phone: phone || null, address: address || null, notes: notes || null });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values = { name: checked.value.name, email: email.trim() || null, phone: phone.trim() || null, address: address.trim() || null, notes: notes.trim() || null };
      if (initial) await orgUpdate("suppliers", activeOrganization.id, initial.id, values);
      else await orgInsert("suppliers", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      setErrors([friendlyError(error, "Supplier could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit supplier" : "Add supplier"} subtitle="Saved to the active organization with role enforcement." onClose={onClose}>
      <Field label="Supplier name"><input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email"><input className="field" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Phone"><input className="field" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={40} /></Field>
      </div>
      <Field label="Address"><textarea className="field min-h-16" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={1000} /></Field>
      <Field label="Notes"><textarea className="field min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></Field>
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Add supplier"}</button>
      </div>
    </Modal>
  );
}
