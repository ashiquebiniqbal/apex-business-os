import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useOrgOptions, useOrgTable } from "../lib/use-org-table";
import { canManage, canOperate, permissionNote } from "../lib/roles";
import { friendlyError, isDemoText, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDateTime } from "../lib/org-settings";
import { TASK_PRIORITIES, TASK_STATUSES, validateTask } from "../lib/validation";
import { ConfirmDialog, DemoBadge, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, StatusPill, primaryButtonClass } from "../components/ui";

type Task = { id: string; title: string; status: string; due_at: string | null; created_at: string; customer_id: string | null; inquiry_id: string | null; assigned_to?: string | null; priority?: string | null; opportunity_id?: string | null; notes?: string | null };
type CustomerOption = { id: string; name: string };
type InquiryOption = { id: string; content: string };
type OpportunityOption = { id: string; title: string };
type MemberOption = { user_id: string; role: string };

const BASE_SELECT = "id,title,status,due_at,created_at,customer_id,inquiry_id";
const EXTENDED_SELECT = "assigned_to,priority,opportunity_id,notes";

export function TasksPage() {
  const { activeOrganization } = useAuth();
  const table = useOrgTable<Task>("tasks", BASE_SELECT, EXTENDED_SELECT, "created_at");
  const customers = useOrgOptions<CustomerOption>("customers", "id,name", "name");
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Task } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const outstanding = table.rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.title.toLowerCase().includes(query) || (row.customer_id && (customerNames.get(row.customer_id) ?? "").toLowerCase().includes(query));
    });
    return [...outstanding].sort((left, right) => {
      if (left.status === "open" && right.status !== "open") return -1;
      if (left.status !== "open" && right.status === "open") return 1;
      return (left.due_at ?? "9999").localeCompare(right.due_at ?? "9999");
    });
  }, [customerNames, search, statusFilter, table.rows]);

  const setStatus = async (row: Task, status: string) => {
    if (!activeOrganization) return;
    setBusyId(row.id);
    setActionError("");
    try {
      await orgUpdate("tasks", activeOrganization.id, row.id, { status });
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Task status could not be changed."));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("tasks", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Task could not be deleted."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Tasks & Follow-ups" subtitle="Follow-ups linked to customers, inquiries, and opportunities. Overdue open tasks sort first.">
        <button disabled={!writer} title={writer ? undefined : permissionNote(role, "Task changes") ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!writer)}>
          New task
        </button>
      </PageHeader>
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading tasks…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          {table.legacyMode && <MigrationNotice message="Assignee, priority, opportunity link, and notes need the pending business-completion migration. Title, status, due date, and links work now." />}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search tasks…" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All statuses</option>
              {TASK_STATUSES.map((status) => <option value={status} key={status}>{status}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <EmptyBlock title="No tasks found" message={search || statusFilter !== "all" ? "No tasks match these filters." : "Create your first follow-up, approve an inquiry workflow, or load the demo workspace from Settings."}>
              {writer && !search && statusFilter === "all" && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>New task</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Task", "Customer", "Priority", "Due", "Status", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const overdue = row.status === "open" && row.due_at !== null && new Date(row.due_at).getTime() < Date.now();
                      return (
                        <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                          <td className="px-5 py-4 font-medium text-ink">
                            {row.title}{isDemoText(row.title) && <DemoBadge />}
                            {overdue && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Overdue</span>}
                          </td>
                          <td className="px-5 py-4 text-slate-600">{row.customer_id ? customerNames.get(row.customer_id) ?? "Linked" : "—"}</td>
                          <td className="px-5 py-4 text-slate-600">{row.priority ?? "—"}</td>
                          <td className="px-5 py-4 text-slate-600">{row.due_at ? formatDateTime(row.due_at) : "Unscheduled"}</td>
                          <td className="px-5 py-4"><StatusPill status={row.status} /></td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              {row.status === "open" && <button disabled={!writer || busyId === row.id} onClick={() => void setStatus(row, "done")} className="text-xs font-medium text-emerald-700 disabled:opacity-40">Complete</button>}
                              {row.status !== "open" && <button disabled={!writer || busyId === row.id} onClick={() => void setStatus(row, "open")} className="text-xs font-medium text-accent disabled:opacity-40">Reopen</button>}
                              <button disabled={!writer} onClick={() => setFormState({ mode: "edit", row })} className="text-xs font-medium text-accent disabled:opacity-40">Edit</button>
                              <button disabled={!deleter} onClick={() => setPendingDelete(row)} className="text-xs font-medium text-red-600 disabled:opacity-40">Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
      {formState && <TaskForm initial={formState.mode === "edit" ? formState.row : null} legacyMode={table.legacyMode} customers={customers} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {pendingDelete && <ConfirmDialog title="Delete task?" message={`"${pendingDelete.title}" will be permanently deleted.`} confirmLabel="Delete task" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function TaskForm({ initial, legacyMode, customers, onClose, onSaved }: { initial: Task | null; legacyMode: boolean; customers: CustomerOption[]; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const inquiries = useOrgOptions<InquiryOption>("inquiries", "id,content", "created_at");
  const opportunities = useOrgOptions<OpportunityOption>("opportunities", "id,title", "created_at");
  const members = useOrgOptions<MemberOption>("org_members", "user_id,role", "role");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState(initial?.status ?? "open");
  const [dueAt, setDueAt] = useState(initial?.due_at ? initial.due_at.slice(0, 16) : "");
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? "");
  const [inquiryId, setInquiryId] = useState(initial?.inquiry_id ?? "");
  const [opportunityId, setOpportunityId] = useState(initial?.opportunity_id ?? "");
  const [assignedTo, setAssignedTo] = useState(initial?.assigned_to ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "medium");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateTask({ title, status, due_at: dueAt ? new Date(dueAt).toISOString() : null, customer_id: customerId || null, inquiry_id: inquiryId || null, opportunity_id: legacyMode ? null : opportunityId || null, assigned_to: legacyMode ? null : assignedTo || null, priority: legacyMode ? null : priority, notes: legacyMode ? null : notes || null });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values: Record<string, unknown> = { title: checked.value.title, status, due_at: dueAt ? new Date(dueAt).toISOString() : null, customer_id: customerId || null, inquiry_id: inquiryId || null };
      if (!legacyMode) {
        values.opportunity_id = opportunityId || null;
        values.assigned_to = assignedTo || null;
        values.priority = priority;
        values.notes = notes.trim() || null;
      }
      if (initial) await orgUpdate("tasks", activeOrganization.id, initial.id, values);
      else await orgInsert("tasks", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      setErrors([friendlyError(error, "Task could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit task" : "New task"} subtitle="Follow-ups stay linked to the customer record that needs them." onClose={onClose}>
      <Field label="Title"><input className="field" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status">
          <select className="field" value={status} onChange={(event) => setStatus(event.target.value)}>
            {TASK_STATUSES.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Due date"><input className="field" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></Field>
      </div>
      {!legacyMode && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority">
            <select className="field" value={priority} onChange={(event) => setPriority(event.target.value)}>
              {TASK_PRIORITIES.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Assigned to">
            <select className="field" value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Unassigned</option>
              {members.map((member) => <option value={member.user_id} key={member.user_id}>{member.role} · {member.user_id.slice(0, 8)}…</option>)}
            </select>
          </Field>
        </div>
      )}
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
          <Field label="Linked opportunity">
            <select className="field" value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}>
              <option value="">No opportunity linked</option>
              {opportunities.map((opportunity) => <option value={opportunity.id} key={opportunity.id}>{opportunity.title}</option>)}
            </select>
          </Field>
          <Field label="Notes"><textarea className="field min-h-16" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={5000} /></Field>
        </>
      )}
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Create task"}</button>
      </div>
    </Modal>
  );
}
