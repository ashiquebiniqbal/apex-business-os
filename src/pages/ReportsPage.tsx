import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { friendlyError } from "../lib/records";
import { formatDate, formatMoney, useOrganizationSettings } from "../lib/org-settings";
import { ErrorBlock, LoadingBlock, PageHeader } from "../components/ui";

type ReportData = {
  inquiriesByStatus: Record<string, number>;
  quotationsByStatus: Array<{ status: string; count: number; total: number }>;
  opportunitiesByStatus: Array<{ status: string; count: number; total: number }>;
  tasksOpen: number;
  tasksOverdue: number;
  lowStock: Array<{ sku: string; name: string; stock_qty: number; min_stock_level: number | null }>;
  recentQuotations: Array<{ id: string; status: string; total: number; currency: string; created_at: string }>;
};

export function ReportsPage() {
  const { activeOrganization } = useAuth();
  const { currency } = useOrganizationSettings(activeOrganization?.id ?? null);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const orgId = activeOrganization.id;
    void Promise.all([
      supabase.from("inquiries").select("status").eq("org_id", orgId).limit(1000),
      supabase.from("quotations").select("status,total,currency").eq("org_id", orgId).limit(1000),
      supabase.from("opportunities").select("status,estimated_value").eq("org_id", orgId).limit(1000),
      supabase.from("tasks").select("status,due_at").eq("org_id", orgId).limit(1000),
      supabase.from("products").select("sku,name,stock_qty,min_stock_level,kind,active").eq("org_id", orgId).eq("active", true).limit(500),
      supabase.from("quotations").select("id,status,total,currency,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(8),
    ]).then(async ([inquiries, quotations, opportunities, tasks, products, recent]) => {
      if (!active) return;
      const failure = [inquiries, quotations, opportunities, tasks, recent].find((result) => result.error)?.error;
      if (failure) {
        setError(friendlyError(failure, "Reports could not be loaded."));
        setLoading(false);
        return;
      }
      let productRows = (products.data ?? []) as Array<{ sku: string; name: string; stock_qty: number; min_stock_level: number | null; kind?: string | null }>;
      if (products.error && /column .* does not exist|42703/.test(`${products.error.code ?? ""} ${products.error.message}`)) {
        const retry = await supabase!.from("products").select("sku,name,stock_qty").eq("org_id", orgId).eq("active", true).limit(500);
        if (!active) return;
        productRows = ((retry.data ?? []) as Array<{ sku: string; name: string; stock_qty: number }>).map((row) => ({ ...row, min_stock_level: null }));
      }
      const inquiriesByStatus: Record<string, number> = {};
      for (const row of (inquiries.data ?? []) as Array<{ status: string }>) inquiriesByStatus[row.status] = (inquiriesByStatus[row.status] ?? 0) + 1;
      const quotationsByStatus = summarize((quotations.data ?? []) as Array<{ status: string; total: number }>, (row) => Number(row.total));
      const opportunitiesByStatus = summarize((opportunities.data ?? []) as Array<{ status: string; estimated_value: number }>, (row) => Number(row.estimated_value));
      const now = Date.now();
      const taskRows = (tasks.data ?? []) as Array<{ status: string; due_at: string | null }>;
      const lowStock = productRows
        .filter((row) => row.kind !== "service" && row.min_stock_level != null && Number(row.min_stock_level) > 0 && Number(row.stock_qty) <= Number(row.min_stock_level))
        .slice(0, 20);
      setData({
        inquiriesByStatus,
        quotationsByStatus,
        opportunitiesByStatus,
        tasksOpen: taskRows.filter((row) => row.status === "open").length,
        tasksOverdue: taskRows.filter((row) => row.status === "open" && row.due_at !== null && new Date(row.due_at).getTime() < now).length,
        lowStock,
        recentQuotations: (recent.data ?? []) as ReportData["recentQuotations"],
      });
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeOrganization]);

  const funnel = useMemo(() => {
    if (!data) return [];
    const order = ["new", "processing", "proposal", "approved", "rejected", "closed"];
    return order.map((status) => ({ status, count: data.inquiriesByStatus[status] ?? 0 }));
  }, [data]);
  const maxFunnel = Math.max(1, ...funnel.map((item) => item.count));

  return (
    <>
      <PageHeader eyebrow="Insights" title="Reports" subtitle="Live organization-scoped summaries. Every figure comes from current records — nothing is fabricated." />
      {loading ? (
        <LoadingBlock message="Loading reports…" />
      ) : error ? (
        <ErrorBlock message={error} />
      ) : !data ? (
        <LoadingBlock message="No report data available." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Inquiry funnel</h2><Link to="/inquiries" className="text-sm text-accent">Open inbox</Link></div>
            <div className="mt-4 space-y-2">
              {funnel.map((item) => (
                <div key={item.status} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 text-slate-500">{item.status}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(item.count / maxFunnel) * 100}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Quotations by status</h2><Link to="/quotations" className="text-sm text-accent">Open quotations</Link></div>
            <StatusMoneyTable rows={data.quotationsByStatus} currency={currency} empty="No quotations yet." />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Pipeline by stage</h2><Link to="/opportunities" className="text-sm text-accent">Open pipeline</Link></div>
            <StatusMoneyTable rows={data.opportunitiesByStatus} currency={currency} empty="No opportunities yet." />
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Follow-up health</h2><Link to="/tasks" className="text-sm text-accent">Open tasks</Link></div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-2xl font-semibold">{data.tasksOpen}</p><p className="mt-1 text-xs text-slate-500">Open tasks</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-2xl font-semibold">{data.tasksOverdue}</p><p className="mt-1 text-xs text-slate-500">Overdue</p></div>
            </div>
            <h3 className="mt-5 font-semibold">Low stock alerts</h3>
            {data.lowStock.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No products below their minimum stock level. Minimum levels need the pending migration.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {data.lowStock.map((item) => (
                  <li key={item.sku} className="flex justify-between gap-2 rounded-lg bg-red-50 px-3 py-2">
                    <span className="font-medium">{item.name} <span className="font-mono text-xs text-slate-500">{item.sku}</span></span>
                    <span className="text-red-700">{Number(item.stock_qty)} / min {Number(item.min_stock_level)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="font-semibold">Recent quotations</h2>
            {data.recentQuotations.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No quotations yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                    <tr>{["Reference", "Status", "Amount", "Created"].map((column) => <th className="px-3 py-2 font-medium" key={column}>{column}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.recentQuotations.map((row) => (
                      <tr className="border-b border-slate-100 last:border-0" key={row.id}>
                        <td className="px-3 py-2.5 font-mono text-xs">{row.id.slice(0, 8)}</td>
                        <td className="px-3 py-2.5">{row.status.replace(/_/g, " ")}</td>
                        <td className="px-3 py-2.5">{formatMoney(Number(row.total), row.currency || currency)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{formatDate(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function summarize<T extends { status: string }>(rows: T[], amount: (row: T) => number): Array<{ status: string; count: number; total: number }> {
  const grouped = new Map<string, { count: number; total: number }>();
  for (const row of rows) {
    const current = grouped.get(row.status) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += amount(row);
    grouped.set(row.status, current);
  }
  return [...grouped.entries()].map(([status, value]) => ({ status, ...value }));
}

function StatusMoneyTable({ rows, currency, empty }: { rows: Array<{ status: string; count: number; total: number }>; currency: string; empty: string }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-slate-500">{empty}</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
          <tr>{["Status", "Count", "Value"].map((column) => <th className="px-3 py-2 font-medium" key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-b border-slate-100 last:border-0" key={row.status}>
              <td className="px-3 py-2.5">{row.status.replace(/_/g, " ")}</td>
              <td className="px-3 py-2.5">{row.count}</td>
              <td className="px-3 py-2.5 font-medium">{formatMoney(row.total, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
