import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useOrgTable } from "../lib/use-org-table";
import { canManage, permissionNote } from "../lib/roles";
import { friendlyError, isDemoProduct, orgDelete, orgInsert, orgUpdate } from "../lib/records";
import { formatMoney, useOrganizationSettings } from "../lib/org-settings";
import { validateProduct } from "../lib/validation";
import { ConfirmDialog, DemoBadge, EmptyBlock, ErrorBlock, Field, FormErrors, LoadingBlock, MigrationNotice, Modal, PageHeader, SearchInput, primaryButtonClass } from "../components/ui";

type Product = {
  id: string;
  sku: string;
  name: string;
  unit_price: number;
  tax_rate: number;
  stock_qty: number;
  active: boolean;
  created_at: string;
  kind?: string | null;
  category?: string | null;
  unit?: string | null;
  cost_price?: number | null;
  min_stock_level?: number | null;
};

const BASE_SELECT = "id,sku,name,unit_price,tax_rate,stock_qty,active,created_at";
const EXTENDED_SELECT = "kind,category,unit,cost_price,min_stock_level";

export function ProductsPage() {
  const { activeOrganization } = useAuth();
  const { currency, defaultTaxRate } = useOrganizationSettings(activeOrganization?.id ?? null);
  const table = useOrgTable<Product>("products", BASE_SELECT, EXTENDED_SELECT, "name");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "product" | "service">("all");
  const [stockFilter, setStockFilter] = useState<"all" | "low" | "inactive">("all");
  const [formState, setFormState] = useState<{ mode: "create" } | { mode: "edit"; row: Product } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Product | null>(null);
  const [actionError, setActionError] = useState("");
  const [searchParams] = useSearchParams();

  const role = activeOrganization?.role;
  const manager = canManage(role);

  useEffect(() => {
    if (searchParams.get("new") === "1" && canManage(activeOrganization?.role)) setFormState({ mode: "create" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const note = permissionNote(role, "Catalog changes");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return table.rows.filter((row) => {
      if (kindFilter !== "all" && (row.kind ?? "product") !== kindFilter) return false;
      if (stockFilter === "low" && !isLowStock(row)) return false;
      if (stockFilter === "inactive" && row.active) return false;
      if (!query) return true;
      return [row.sku, row.name, row.category ?? ""].some((value) => value.toLowerCase().includes(query));
    });
  }, [kindFilter, search, stockFilter, table.rows]);

  const remove = async () => {
    if (!pendingDelete || !activeOrganization) return;
    setActionError("");
    try {
      await orgDelete("products", activeOrganization.id, pendingDelete.id);
      setPendingDelete(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Product could not be deleted. Products used on quotations are protected."));
    }
  };

  const toggleActive = async () => {
    if (!pendingToggle || !activeOrganization) return;
    setActionError("");
    try {
      await orgUpdate("products", activeOrganization.id, pendingToggle.id, { active: !pendingToggle.active });
      setPendingToggle(null);
      table.reload();
    } catch (error) {
      setActionError(friendlyError(error, "Product status could not be changed."));
    }
  };

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Products & Services" subtitle="Catalog, pricing, tax treatment, and recorded availability. The AI assistant quotes from these records — never from invented prices.">
        <button disabled={!manager} title={manager ? undefined : note ?? undefined} onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass(!manager)}>
          Add product
        </button>
      </PageHeader>
      {!manager && note && <p className="mb-4 text-xs text-slate-500">{note}</p>}
      {actionError && <div className="mb-4"><ErrorBlock message={actionError} /></div>}
      {table.loading ? (
        <LoadingBlock message="Loading products and services…" />
      ) : table.error ? (
        <ErrorBlock message={table.error} onRetry={table.reload} />
      ) : (
        <>
          {table.legacyMode && <MigrationNotice message="Product type, category, unit, cost price, and minimum stock need the pending business-completion migration. Price, tax, stock, and active status work now." />}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by SKU, name, or category…" />
            <div className="flex gap-2">
              <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="all">All types</option>
                <option value="product">Products</option>
                <option value="service">Services</option>
              </select>
              <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                <option value="all">All stock</option>
                <option value="low">Low stock</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyBlock title="No products found" message={search || kindFilter !== "all" || stockFilter !== "all" ? "No catalog records match these filters." : "Add your first product or service, or load the labelled demo workspace from Settings."}>
              {manager && !search && <button onClick={() => setFormState({ mode: "create" })} className={primaryButtonClass()}>Add product</button>}
            </EmptyBlock>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["SKU", "Product", "Type", "Price", "Tax", "Available", "Actions"].map((column) => <th className="px-5 py-3 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-5 py-4 font-mono text-xs text-slate-600">{row.sku}</td>
                        <td className="px-5 py-4 font-medium text-ink">
                          {row.name}
                          {isDemoProduct(row) && <DemoBadge />}
                          {!row.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">Inactive</span>}
                          {isLowStock(row) && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">Low stock</span>}
                          {row.category && <span className="block text-xs font-normal text-slate-400">{row.category}</span>}
                        </td>
                        <td className="px-5 py-4 text-slate-600">{row.kind ?? "product"}</td>
                        <td className="px-5 py-4 text-slate-600">{formatMoney(Number(row.unit_price), currency)}</td>
                        <td className="px-5 py-4 text-slate-600">{Number(row.tax_rate)}%</td>
                        <td className="px-5 py-4 text-slate-600">{row.kind === "service" ? "—" : Number(row.stock_qty).toLocaleString()}</td>
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button disabled={!manager} onClick={() => setFormState({ mode: "edit", row })} className="text-xs font-medium text-accent disabled:opacity-40">Edit</button>
                            <button disabled={!manager} onClick={() => setPendingToggle(row)} className="text-xs font-medium text-slate-600 disabled:opacity-40">{row.active ? "Deactivate" : "Activate"}</button>
                            <button disabled={!manager} onClick={() => setPendingDelete(row)} className="text-xs font-medium text-red-600 disabled:opacity-40">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">Prices shown in {currency}. Quotation lines snapshot these prices at approval time.</p>
            </div>
          )}
        </>
      )}
      {formState && <ProductForm initial={formState.mode === "edit" ? formState.row : null} legacyMode={table.legacyMode} defaultTaxRate={defaultTaxRate} onClose={() => setFormState(null)} onSaved={() => { setFormState(null); table.reload(); }} />}
      {pendingDelete && <ConfirmDialog title="Delete product?" message={`"${pendingDelete.name}" (${pendingDelete.sku}) will be permanently deleted. This is blocked when the product is used on a quotation.`} confirmLabel="Delete product" busy={false} onConfirm={() => void remove()} onCancel={() => setPendingDelete(null)} />}
      {pendingToggle && <ConfirmDialog title={pendingToggle.active ? "Deactivate product?" : "Activate product?"} message={pendingToggle.active ? `"${pendingToggle.name}" will be hidden from new quotations and AI proposals. Existing records keep their snapshots.` : `"${pendingToggle.name}" will become available for new quotations and AI proposals.`} confirmLabel={pendingToggle.active ? "Deactivate" : "Activate"} busy={false} onConfirm={() => void toggleActive()} onCancel={() => setPendingToggle(null)} />}
    </>
  );
}

function isLowStock(row: Product): boolean {
  if (row.kind === "service" || !row.active) return false;
  const minimum = Number(row.min_stock_level ?? 0);
  return minimum > 0 && Number(row.stock_qty) <= minimum;
}

function ProductForm({ initial, legacyMode, defaultTaxRate, onClose, onSaved }: { initial: Product | null; legacyMode: boolean; defaultTaxRate: number; onClose: () => void; onSaved: () => void }) {
  const { activeOrganization } = useAuth();
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [unitPrice, setUnitPrice] = useState(String(initial?.unit_price ?? ""));
  const [taxRate, setTaxRate] = useState(String(initial?.tax_rate ?? defaultTaxRate));
  const [stockQty, setStockQty] = useState(String(initial?.stock_qty ?? 0));
  const [active, setActive] = useState(initial?.active ?? true);
  const [kind, setKind] = useState(initial?.kind ?? "product");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [costPrice, setCostPrice] = useState(initial?.cost_price == null ? "" : String(initial.cost_price));
  const [minStock, setMinStock] = useState(initial?.min_stock_level == null ? "" : String(initial.min_stock_level));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!activeOrganization) return;
    const checked = validateProduct({
      sku,
      name,
      unit_price: Number(unitPrice),
      tax_rate: Number(taxRate),
      stock_qty: Number(stockQty),
      active,
      kind: legacyMode ? null : kind,
      category: legacyMode ? null : category || null,
      unit: legacyMode ? null : unit || null,
      cost_price: costPrice === "" ? null : Number(costPrice),
      min_stock_level: minStock === "" ? null : Number(minStock),
    });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setBusy(true);
    try {
      const values: Record<string, unknown> = { sku: checked.value.sku, name: checked.value.name, unit_price: checked.value.unit_price, tax_rate: checked.value.tax_rate, stock_qty: checked.value.stock_qty, active };
      if (!legacyMode) {
        values.kind = kind;
        values.category = category.trim() || null;
        values.unit = unit.trim() || null;
        values.cost_price = costPrice === "" ? null : Number(costPrice);
        values.min_stock_level = minStock === "" ? null : Number(minStock);
      }
      if (initial) await orgUpdate("products", activeOrganization.id, initial.id, values);
      else await orgInsert("products", activeOrganization.id, values);
      onSaved();
    } catch (error) {
      const message = friendlyError(error, "Product could not be saved.");
      setErrors([(error as { code?: string })?.code === "23505" ? "This SKU already exists in the organization. SKUs must be unique." : message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? "Edit product" : "Add product"} subtitle="Catalog records feed quotations and AI proposals with real prices." onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU / product code"><input className="field" value={sku} onChange={(event) => setSku(event.target.value)} maxLength={60} /></Field>
        <Field label="Name"><input className="field" value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Selling price"><input className="field" type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} /></Field>
        <Field label="Tax rate %"><input className="field" type="number" min="0" max="100" step="0.001" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} /></Field>
        <Field label="Stock quantity"><input className="field" type="number" min="0" step="0.001" value={stockQty} onChange={(event) => setStockQty(event.target.value)} /></Field>
      </div>
      {!legacyMode && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Product type">
              <select className="field" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="product">Product</option>
                <option value="service">Service</option>
              </select>
            </Field>
            <Field label="Category"><input className="field" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={120} /></Field>
            <Field label="Unit"><input className="field" value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="piece, hour, license" maxLength={40} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cost price (optional)"><input className="field" type="number" min="0" step="0.01" value={costPrice} onChange={(event) => setCostPrice(event.target.value)} /></Field>
            <Field label="Minimum stock level (optional)"><input className="field" type="number" min="0" step="0.001" value={minStock} onChange={(event) => setMinStock(event.target.value)} /></Field>
          </div>
        </>
      )}
      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Active and quotable
      </label>
      <FormErrors errors={errors} />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700">Cancel</button>
        <button onClick={() => void save()} disabled={busy} className={primaryButtonClass(busy)}>{busy ? "Saving…" : initial ? "Save changes" : "Add product"}</button>
      </div>
    </Modal>
  );
}
