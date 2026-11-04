import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { useOrgOptions, useOrgTable } from "../lib/use-org-table";
import { canManage, permissionNote } from "../lib/roles";
import { friendlyError, isMissingColumn, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatDate, formatDateTime, formatMoney, useOrganizationSettings } from "../lib/org-settings";
import { calculateQuote } from "../lib/quote";
import { QUOTATION_STATUSES, validateQuotationLine, validateQuotationStatusTransition } from "../lib/validation";
import { ConfirmDialog, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, StatusPill, primaryButtonClass, secondaryButtonClass } from "../components/ui";

type Quotation = { id: string; status: string; currency: string; subtotal: number; tax_total: number; total: number; created_at: string; customer_id: string | null; inquiry_id: string | null };
type QuotationLine = { id: string; quotation_id: string; product_id: string; quantity: number; unit_price: number; tax_rate: number; line_total: number; discount_rate?: number | null };
type CustomerOption = { id: string; name: string };
type ProductOption = { id: string; sku: string; name: string; unit_price: number; tax_rate: number; stock_qty: number };
type InquiryOption = { id: string; content: string };

const BASE_SELECT = "id,status,currency,subtotal,tax_total,total,created_at,customer_id,inquiry_id";

export function QuotationsPage() {
  const { activeOrganization } = useAuth();
  const { currency: orgCurrency } = useOrganizationSettings(activeOrganization?.id ?? null);
  const table = useOrgTable<Quotation>("quotations", BASE_SELECT, null, "created_at");
  const customers = useOrgOptions<CustomerOption>("customers", "id,name", "name");
  const customerNames = useMemo(() => new Map(customers.map((customer) => [customer.id, customer.name])), [customers]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Quotation | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchParams] = useSearchParams();

  const role = activeOrganization?.role;
  const manager = canManage(role);

  useEffect(() => {
    if (searchParams.get("new") === "1" && canManage(activeOrganization?.role)) setCreating(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return table.rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (!query) return true;
      return row.id.toLowerCase().includes(query) || (row.customer_id && (customerNames.get(row.customer_id) ?? "").toLowerCase().includes(query));
    });
  }, [customerNames, search, statusFilter, table.rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("quotations", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      setSelectedId((current) => (current === pendingDelete.id ? null : current));
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Quotation could not be deleted."));
    }
  };

  if (selectedId) {
    const selected = table.rows.find((row) => row.id === selectedId) ?? null;
    return <QuotationDetail quotationId={selectedId} cached={selected} customerName={selected?.customer_id ? customerNames.get(selected.customer_id) ?? null : null} onBack={() => { setSelectedId(null); table.reload(); }} onDeleted={() => { setSelectedId(null); table.reload(); }} />;
  }

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Quotations" subtitle="Draft commercial proposals from real catalog prices. Totals are always calculated by the database — never by the AI model.">
        <button disabled={!manager} title={manager ? undefined : permissionNote(role, "Quotation changes") ?? undefined} onClick={() => setCreating(true)} className={primaryButtonClass(!manager)}>
          New quotation
        </button>
      </PageHeader>
      {!manager && <p className="mb-4 text-xs text-slate-500">{permissionNote(role, "Quotation changes")}</p>}
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading quotations…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by reference or customer…" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <option value="all">All statuses</option>
              {QUOTATION_STATUSES.map((status) => <option value={status} key={status}>{status.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          {rows.length === 0 ? (
            <EmptyBlock title="No quotations found" message={search || statusFilter !== "all" ? "No quotations match these filters." : "Create your first quotation manually, approve an inquiry workflow, or load the demo workspace from Settings."}>
              {manager && !search && statusFilter === "all" && <button onClick={() => setCreating(true)} className={primaryButtonClass()}>New quotation</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Reference", "Customer", "Status", "Amount", "Created", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-5 py-4 font-mono text-xs text-slate-600"><button className="hover:text-accent" onClick={() => setSelectedId(row.id)}>{row.id.slice(0, 8)}</button></td>
                        <td className="px-5 py-4 font-medium text-ink">{row.customer_id ? customerNames.get(row.customer_id) ?? "Linked customer" : "—"}</td>
                        <td className="px-5 py-4"><StatusPill status={row.status} /></td>
                        <td className="px-5 py-4 text-slate-600">{formatMoney(Number(row.total), row.currency || orgCurrency)}</td>
                        <td className="px-5 py-4 text-slate-600">{formatDateTime(row.created_at)}</td>
                        <td className="px-5 py-4">
                          <div className="flex gap-2">
                            <button onClick={() => setSelectedId(row.id)} className="text-xs font-medium text-accent">Open</button>
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
      {creating && <QuotationCreate customers={customers} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); table.reload(); setSelectedId(id); }} />}
      {pendingDelete && <ConfirmDialog title="Delete quotation?" message={`Quotation ${pendingDelete.id.slice(0, 8)} and its lines will be permanently deleted.`} confirmLabel="Delete quotation" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
    </>
  );
}

function QuotationCreate({ customers, onClose, onCreated }: { customers: CustomerOption[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { activeOrganization } = useAuth();
  const { currency } = useOrganizationSettings(activeOrganization?.id ?? null);
  const inquiries = useOrgOptions<InquiryOption>("inquiries", "id,content", "created_at");
  const [customerId, setCustomerId] = useState("");
  const [inquiryId, setInquiryId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    setBusy(true);
    setErrors([]);
    try {
      const created = await orgInsert<{ id: string }>("quotations", activeOrganization.id, { customer_id: customerId || null, inquiry_id: inquiryId || null, status: "draft", currency });
      onCreated(created.id);
    } catch (error) {
      setErrors([friendlyError(error, "Quotation could not be created.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New quotation" subtitle={`A draft in ${currency}. You will add products and services after creating it.`} onClose={onClose}>
      <Field label="Customer">
        <select className="field" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
          <option value="">No customer selected</option>
          {customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name}</option>)}
        </select>
      </Field>
      <Field label="Linked inquiry (optional)">
        <select className="field" value={inquiryId} onChange={(event) => setInquiryId(event.target.value)}>
          <option value="">No inquiry linked</option>
          {inquiries.map((inquiry) => <option value={inquiry.id} key={inquiry.id}>{inquiry.content.slice(0, 80)}</option>)}
        </select>
      </Field>
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Creating…" : "Create draft"}</button>
      </div>
    </Modal>
  );
}

function QuotationDetail({ quotationId, cached, customerName, onBack, onDeleted }: { quotationId: string; cached: Quotation | null; customerName: string | null; onBack: () => void; onDeleted: () => void }) {
  const { activeOrganization } = useAuth();
  const { settings } = useOrganizationSettings(activeOrganization?.id ?? null);
  const [quotation, setQuotation] = useState<Quotation | null>(cached);
  const [lines, setLines] = useState<QuotationLine[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [supportsDiscount, setSupportsDiscount] = useState(true);
  const [addingLine, setAddingLine] = useState(false);
  const [editingLine, setEditingLine] = useState<QuotationLine | null>(null);
  const [pendingLineDelete, setPendingLineDelete] = useState<QuotationLine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const role = activeOrganization?.role;
  const manager = canManage(role);
  const locked = quotation !== null && ["approved", "sent", "accepted"].includes(quotation.status);
  const editable = manager && !locked;

  const reload = async () => {
    if (!supabase || !activeOrganization) return;
    setLoading(true);
    setError("");
    try {
      const [quoteResult, lineResult, productResult] = await Promise.all([
        supabase.from("quotations").select(BASE_SELECT).eq("id", quotationId).eq("org_id", activeOrganization.id).single(),
        supabase.from("quotation_lines").select("id,quotation_id,product_id,quantity,unit_price,tax_rate,line_total,discount_rate").eq("quotation_id", quotationId).eq("org_id", activeOrganization.id),
        supabase.from("products").select("id,sku,name,unit_price,tax_rate,stock_qty").eq("org_id", activeOrganization.id).eq("active", true).order("name").limit(200),
      ]);
      if (quoteResult.error) throw quoteResult.error;
      if (lineResult.error && isMissingColumn(lineResult.error)) {
        setSupportsDiscount(false);
        const retry = await supabase.from("quotation_lines").select("id,quotation_id,product_id,quantity,unit_price,tax_rate,line_total").eq("quotation_id", quotationId).eq("org_id", activeOrganization.id);
        if (retry.error) throw retry.error;
        setLines((retry.data ?? []) as unknown as QuotationLine[]);
      } else {
        if (lineResult.error) throw lineResult.error;
        setLines((lineResult.data ?? []) as unknown as QuotationLine[]);
      }
      if (productResult.error) throw productResult.error;
      setQuotation(quoteResult.data as unknown as Quotation);
      setProducts((productResult.data ?? []) as unknown as ProductOption[]);
    } catch (loadError) {
      setError(friendlyError(loadError, "Quotation could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotationId, activeOrganization?.id]);

  const changeStatus = async (next: string) => {
    if (!quotation || !activeOrganization) return;
    const blocked = validateQuotationStatusTransition(quotation.status, next);
    if (blocked) {
      setActionError(blocked);
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await orgUpdate("quotations", activeOrganization.id, quotation.id, { status: next });
      await reload();
    } catch (statusError) {
      setActionError(friendlyError(statusError, "Status could not be changed. Approval requires at least one quotation line."));
    } finally {
      setBusy(false);
    }
  };

  const deleteLine = async () => {
    if (!pendingLineDelete || !activeOrganization) return;
    setBusy(true);
    setActionError("");
    try {
      await orgDelete("quotation_lines", activeOrganization.id, pendingLineDelete.id);
      setPendingLineDelete(null);
      await reload();
    } catch (lineError) {
      setActionError(friendlyError(lineError, "Line could not be deleted."));
    } finally {
      setBusy(false);
    }
  };

  const deleteQuotation = async () => {
    if (!activeOrganization) return;
    setBusy(true);
    try {
      await orgDelete("quotations", activeOrganization.id, quotationId);
      onDeleted();
    } catch (deleteError) {
      setActionError(friendlyError(deleteError, "Quotation could not be deleted."));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  const productNames = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const validityDays = settings?.quotation_validity_days ?? 30;
  const validUntil = quotation ? new Date(new Date(quotation.created_at).getTime() + validityDays * 86400000) : null;

  if (loading) return <><button onClick={onBack} className="mb-4 text-sm text-accent">← Back to quotations</button><LoadingBlock message="Loading quotation…" /></>;
  if (error || !quotation) return <><button onClick={onBack} className="mb-4 text-sm text-accent">← Back to quotations</button><ErrorBlock message={error || "Quotation not found."} /></>;

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="text-sm text-accent">← Back to quotations</button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className={secondaryButtonClass()}>Print / export PDF</button>
          {manager && <button onClick={() => setConfirmDelete(true)} className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600">Delete</button>}
        </div>
      </div>
      <PageHeader eyebrow="Quotation" title={`Quotation ${quotation.id.slice(0, 8)}`} subtitle={`${customerName ?? "No customer selected"} · created ${formatDateTime(quotation.created_at)}${validUntil ? ` · valid until ${formatDate(validUntil.toISOString())}` : ""}`}>
        <StatusPill status={quotation.status} />
      </PageHeader>
      {!supportsDiscount && <div className="no-print"><MigrationNotice message="Per-line discounts need the pending business-completion migration. Quantities, prices, and taxes work now." /></div>}
      {actionError && <div className="no-print mb-4"><ErrorBlock message={actionError} /></div>}
      {locked && <p className="no-print mb-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">This quotation is {quotation.status} and its lines are locked by database policy. Historical prices are immutable.</p>}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Quotation lines</h2>
          <button disabled={!editable} title={editable ? undefined : locked ? "Approved quotations are locked." : permissionNote(role, "Quotation changes") ?? undefined} onClick={() => setAddingLine(true)} className="rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white disabled:opacity-40">Add line</button>
        </div>
        {lines.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No lines yet. Add at least one product or service before approval.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <tr>{["Product", "Qty", "Unit price", "Discount", "Tax", "Line total", ""].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr className="border-b border-slate-100 last:border-0" key={line.id}>
                    <td className="px-5 py-4 font-medium">{productNames.get(line.product_id)?.name ?? line.product_id.slice(0, 8)}</td>
                    <td className="px-5 py-4">{Number(line.quantity).toLocaleString()}</td>
                    <td className="px-5 py-4">{formatMoney(Number(line.unit_price), quotation.currency)}</td>
                    <td className="px-5 py-4">{supportsDiscount ? `${Number(line.discount_rate ?? 0)}%` : "—"}</td>
                    <td className="px-5 py-4">{Number(line.tax_rate)}%</td>
                    <td className="px-5 py-4 font-medium">{formatMoney(Number(line.line_total), quotation.currency)}</td>
                    <td className="no-print px-5 py-4">
                      <div className="flex gap-2">
                        <button disabled={!editable} onClick={() => setEditingLine(line)} className="text-xs font-medium text-accent disabled:opacity-40">Edit</button>
                        <button disabled={!editable} onClick={() => setPendingLineDelete(line)} className="text-xs font-medium text-red-600 disabled:opacity-40">Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-4">
          <dl className="ml-auto grid max-w-xs gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="font-medium">{formatMoney(Number(quotation.subtotal), quotation.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tax total</dt><dd className="font-medium">{formatMoney(Number(quotation.tax_total), quotation.currency)}</dd></div>
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base"><dt className="font-semibold">Total</dt><dd className="font-semibold">{formatMoney(Number(quotation.total), quotation.currency)}</dd></div>
          </dl>
          <p className="mt-3 text-xs text-slate-400">Totals are calculated by database triggers from quotation lines. {settings?.default_payment_terms ? `Payment terms: ${settings.default_payment_terms}.` : ""}</p>
        </div>
      </section>

      <section className="no-print mt-4 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Change status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUOTATION_STATUSES.filter((status) => status !== quotation.status).map((status) => (
            <button key={status} disabled={!manager || busy} onClick={() => void changeStatus(status)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-40">
              Mark {status.replace(/_/g, " ")}
            </button>
          ))}
        </div>
        {!manager && <p className="mt-3 text-xs text-slate-500">{permissionNote(role, "Status changes")}</p>}
      </section>

      {addingLine && <QuotationLineForm products={products} supportsDiscount={supportsDiscount} currency={quotation.currency} onClose={() => setAddingLine(false)} onSaved={() => { setAddingLine(false); void reload(); }} quotationId={quotationId} />}
      {editingLine && <QuotationLineForm products={products} supportsDiscount={supportsDiscount} currency={quotation.currency} initial={editingLine} onClose={() => setEditingLine(null)} onSaved={() => { setEditingLine(null); void reload(); }} quotationId={quotationId} />}
      {pendingLineDelete && <ConfirmDialog title="Remove line?" message="This quotation line will be removed and totals recalculated by the database." confirmLabel="Remove line" busy={busy} onConfirm={() => void deleteLine()} onCancel={() => setPendingLineDelete(null)} />}
      {confirmDelete && <ConfirmDialog title="Delete quotation?" message={`Quotation ${quotation.id.slice(0, 8)} and its lines will be permanently deleted.`} confirmLabel="Delete quotation" busy={busy} onConfirm={() => void deleteQuotation()} onCancel={() => setConfirmDelete(false)} />}
    </>
  );
}

function QuotationLineForm({ products, supportsDiscount, currency, initial, quotationId, onClose, onSaved }: { products: ProductOption[]; supportsDiscount: boolean; currency: string; initial?: QuotationLine; quotationId: string; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const [productId, setProductId] = useState(initial?.product_id ?? "");
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [discount, setDiscount] = useState(String(initial?.discount_rate ?? 0));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const selected = products.find((product) => product.id === productId) ?? null;

  let estimate: string | null = null;
  if (selected && Number.isFinite(Number(quantity)) && Number(quantity) > 0) {
    try {
      const math = calculateQuote(Number(selected.unit_price), Number(selected.tax_rate), Number(quantity));
      estimate = `Estimate ${formatMoney(math.total, currency)} (server recalculates on save)`;
    } catch {
      estimate = null;
    }
  }

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateQuotationLine({ product_id: productId, quantity: Number(quantity), discount_rate: supportsDiscount ? Number(discount) : 0 });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      if (initial) {
        const values: Record<string, unknown> = { quantity: checked.value.quantity };
        if (supportsDiscount) values.discount_rate = checked.value.discount_rate;
        await orgUpdate("quotation_lines", activeOrganization.id, initial.id, values);
      } else {
        const values: Record<string, unknown> = { quotation_id: quotationId, product_id: productId, quantity: checked.value.quantity, unit_price: 0, tax_rate: 0, line_total: 0 };
        if (supportsDiscount) values.discount_rate = checked.value.discount_rate;
        await orgInsert("quotation_lines", activeOrganization.id, values);
      }
      onSaved();
    } catch (error) {
      setErrors([(error as { code?: string })?.code === "23505" ? "This product is already on the quotation. Edit the existing line instead." : friendlyError(error, "Quotation line could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit quotation line" : "Add quotation line"} subtitle="Prices and taxes snapshot from the catalog. The database computes the line total." onClose={onClose}>
      <Field label="Product or service">
        <select className="field" value={productId} disabled={Boolean(initial)} onChange={(event) => setProductId(event.target.value)}>
          <option value="">Select a product…</option>
          {products.map((product) => <option value={product.id} key={product.id}>{product.name} · {formatMoney(Number(product.unit_price), currency)} · stock {Number(product.stock_qty)}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity"><input className="field" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
        {supportsDiscount && <Field label="Discount %"><input className="field" type="number" min="0" max="100" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field>}
      </div>
      {estimate && <p className="mt-3 text-xs text-slate-500">{estimate}</p>}
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className={secondaryButtonClass()}>Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save line" : "Add line"}</button>
      </div>
    </Modal>
  );
}
