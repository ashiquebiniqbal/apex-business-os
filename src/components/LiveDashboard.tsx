import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { fallbackModelCatalog, fetchModelCatalog } from "../lib/model-routing";
import { friendlyError } from "../lib/records";
import { supabase } from "../lib/supabase";

type DashboardState = {
  customers: number;
  products: number;
  inquiries: number;
  quotations: number;
  opportunities: number;
  followUps: number;
  usageUsd: number;
  budgetLimitUsd: number | null;
  companyConfigured: boolean;
  aiUsed: boolean;
  recentInquiries: Array<{ content: string; status: string; created_at: string }>;
  recentActivity: Array<{ action: string; entity_type: string; created_at: string }>;
};

const empty: DashboardState = { customers: 0, products: 0, inquiries: 0, quotations: 0, opportunities: 0, followUps: 0, usageUsd: 0, budgetLimitUsd: null, companyConfigured: false, aiUsed: false, recentInquiries: [], recentActivity: [] };

const SHORTCUTS: Array<{ label: string; to: string }> = [
  { label: "Add customer", to: "/customers?new=1" },
  { label: "Add product", to: "/products?new=1" },
  { label: "Create quotation", to: "/quotations?new=1" },
  { label: "Create inquiry", to: "/inquiries?new=1" },
  { label: "Create task", to: "/tasks?new=1" },
];

export function LiveDashboard() {
  const navigate = useNavigate();
  const { activeOrganization } = useAuth();
  const [data, setData] = useState<DashboardState>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");

  useEffect(() => {
    let active = true;
    const client = supabase;
    if (!client || !activeOrganization) { setData(empty); setLoading(false); return; }
    setLoading(true); setError(""); setCatalogError("");
    const orgId = activeOrganization.id;
    const count = (table: string, filter: (query: any) => any = (query) => query) => filter(client.from(table).select("*", { count: "exact", head: true }).eq("org_id", orgId));
    // The model catalog settles separately: its failure must never blank business metrics.
    const catalogResult = fetchModelCatalog()
      .then((catalog) => ({ catalog, catalogFailure: "" }))
      .catch((catalogFailure: unknown) => ({ catalog: fallbackModelCatalog("muse-spark-1.3"), catalogFailure: friendlyError(catalogFailure, "Model catalog unavailable.") }));
    void Promise.all([
      count("customers"),
      count("products", (query) => query.eq("active", true)),
      count("inquiries", (query) => query.in("status", ["new", "processing", "proposal"])),
      count("quotations", (query) => query.in("status", ["draft", "pending_approval"])),
      count("opportunities", (query) => query.in("status", ["proposed", "open"])),
      count("tasks", (query) => query.eq("status", "open").gte("due_at", new Date().toISOString())),
      client.from("inquiries").select("content,status,created_at").eq("org_id", orgId).in("status", ["new", "processing", "proposal"]).order("created_at", { ascending: false }).limit(4),
      catalogResult,
      client.from("organization_settings").select("company_name").eq("org_id", orgId).maybeSingle(),
      client.from("ai_usage_ledger").select("*", { count: "exact", head: true }).eq("org_id", orgId),
      client.from("audit_logs").select("action,entity_type,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(8),
    ]).then(([customers, products, inquiries, quotations, opportunities, followUps, recent, catalogOutcome, settings, aiUsage, activity]) => {
      if (!active) return;
      const { catalog, catalogFailure } = catalogOutcome;
      if (catalogFailure) setCatalogError(`AI configuration unavailable: ${catalogFailure} Business metrics are unaffected. Configured, reachable, and tested are separate states; run Test connection in Settings to test Meta.`);
      const queryError = [customers, products, inquiries, quotations, opportunities, followUps, recent].find((result) => result.error)?.error;
      if (queryError) setError("Some dashboard metrics could not be loaded. Check the active organization and RLS policies.");
      setData({
        customers: customers.count ?? 0,
        products: products.count ?? 0,
        inquiries: inquiries.count ?? 0,
        quotations: quotations.count ?? 0,
        opportunities: opportunities.count ?? 0,
        followUps: followUps.count ?? 0,
        usageUsd: catalog.usage.committed_cost_usd,
        budgetLimitUsd: catalog.budget?.hard_limit_usd ?? null,
        companyConfigured: Boolean((settings.data as { company_name?: string | null } | null)?.company_name),
        aiUsed: (aiUsage.count ?? 0) > 0,
        recentInquiries: (recent.data ?? []) as DashboardState["recentInquiries"],
        recentActivity: (activity.data ?? []) as DashboardState["recentActivity"],
      });
    }).catch((loadError: unknown) => { if (active) setError(friendlyError(loadError, "Dashboard metrics could not be loaded.")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [activeOrganization?.id]);

  const metrics = [
    ["Total customers", String(data.customers), "Organization-scoped live data"],
    ["Active products", String(data.products), "Available catalog records"],
    ["Open inquiries", String(data.inquiries), "New, processing, or proposal"],
    ["Pending quotations", String(data.quotations), "Draft or awaiting approval"],
    ["Opportunities", String(data.opportunities), "Proposed or open"],
    ["Upcoming follow-ups", String(data.followUps), "Open tasks with a future due date"],
    ["AI usage", `$${data.usageUsd.toFixed(4)}`, data.budgetLimitUsd === null ? "Budget configuration unavailable" : `$${data.budgetLimitUsd.toFixed(2)} application hard limit`],
  ];
  const checklist = [
    { label: "Set your company profile", done: data.companyConfigured, to: "/settings" },
    { label: "Add your first customer", done: data.customers > 0, to: "/customers?new=1" },
    { label: "Add your first product or service", done: data.products > 0, to: "/products?new=1" },
    { label: "Create your first quotation", done: data.quotations > 0, to: "/quotations?new=1" },
    { label: "Run the AI assistant once", done: data.aiUsed, to: "/assistant" },
  ];
  const onboardingOpen = checklist.some((item) => !item.done);
  const noRecords = data.customers + data.products + data.inquiries + data.quotations + data.opportunities + data.followUps === 0;
  return <>
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Overview</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Apex workspace</h1><p className="mt-2 text-sm text-slate-500">Live organization-scoped records, governed AI usage, and controlled workflow execution.</p></div><button onClick={() => navigate("/assistant")} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">Create inquiry</button></div>
    {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading live workspace metrics…</div> : <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, detail]) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-3xl font-semibold">{value}</p><p className="mt-2 text-xs text-slate-400">{detail}</p></div>)}</div>
      {error && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {catalogError && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{catalogError}</p>}
      <div className="mt-4 flex flex-wrap gap-2">{SHORTCUTS.map((shortcut) => <NavLink key={shortcut.label} to={shortcut.to} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:border-accent hover:text-accent">{shortcut.label}</NavLink>)}</div>
      {onboardingOpen && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Getting started checklist</h2>
          <p className="mt-1 text-sm text-slate-500">Complete these once to make the workspace yours. Loading the demo workspace from Settings also ticks the record steps.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item.label}>
                <NavLink to={item.to} className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm hover:bg-slate-100">
                  {item.done ? <CheckCircle2 size={17} className="shrink-0 text-emerald-600" /> : <Circle size={17} className="shrink-0 text-slate-300" />}
                  <span className={item.done ? "text-slate-500 line-through" : "font-medium"}>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      {noRecords ? <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h2 className="text-xl font-semibold">This workspace has no records yet</h2><p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">Use the shortcuts above to add your own company data, or load the clearly labelled fictional demo workspace from Settings. No synthetic metrics are shown here.</p><NavLink to="/settings" className="mt-5 inline-flex rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">Open Settings</NavLink></section> : <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">Open inquiry queue</h2><NavLink to="/inquiries" className="text-sm text-accent">View inbox</NavLink></div><div className="mt-5 space-y-4">{data.recentInquiries.length ? data.recentInquiries.map((item) => <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0" key={`${item.created_at}-${item.content}`}><div><p className="line-clamp-2 text-sm font-medium">{item.content}</p><p className="mt-1 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{item.status}</span></div>) : <p className="text-sm text-slate-500">No open inquiries right now.</p>}</div></section><div className="space-y-6"><section className="rounded-2xl bg-ink p-5 text-white"><div className="flex items-center gap-2 text-blue-200"><Sparkles size={17} /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Governed workflow</span></div><h2 className="mt-5 text-xl font-semibold">Inquiry → analysis → approval.</h2><p className="mt-3 text-sm leading-6 text-slate-300">Meta extracts structured intent. Apex looks up organization data and the database calculates commercial values. A human approves execution.</p><NavLink to="/assistant" className="mt-6 inline-flex rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-ink">Run the workflow</NavLink></section><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-semibold">Recent activity</h2><div className="mt-4 space-y-3">{data.recentActivity.length ? data.recentActivity.map((item, index) => <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0" key={`${item.created_at}-${index}`}><div><p className="text-sm font-medium">{item.action.replace(/_/g, " ")}</p><p className="mt-0.5 text-xs text-slate-500">{item.entity_type}</p></div><span className="shrink-0 text-xs text-slate-400">{new Date(item.created_at).toLocaleDateString()}</span></div>) : <p className="text-sm text-slate-500">No audited activity yet. Approvals and demo loads appear here.</p>}</div></section></div></div>}</>}</>;
}
