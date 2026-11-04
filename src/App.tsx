import { useState } from "react";
import { BarChart3, Bell, Bot, Building2, ChevronDown, CircleDollarSign, ClipboardList, ContactRound, History, LayoutDashboard, Menu, Package, Settings, TrendingUp, Truck, X } from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthScreen, ConfigurationScreen, OrganizationSetup } from "./auth/AuthScreens";
import { AskApexPanel } from "./components/AskApexPanel";
import { LiveDashboard } from "./components/LiveDashboard";
import { MvpSettingsPage } from "./components/MvpSettingsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { ProductsPage } from "./pages/ProductsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { InquiriesPage } from "./pages/InquiriesPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { OpportunitiesPage } from "./pages/OpportunitiesPage";
import { TasksPage } from "./pages/TasksPage";
import { AssistantPage } from "./pages/AssistantPage";
import { AIActivityPage } from "./pages/AIActivityPage";
import { ReportsPage } from "./pages/ReportsPage";

const nav = [
  ["/", "Dashboard", LayoutDashboard],
  ["/customers", "Customers", ContactRound],
  ["/products", "Products & Services", Package],
  ["/suppliers", "Suppliers", Truck],
  ["/inquiries", "Inquiries", ClipboardList],
  ["/quotations", "Quotations", CircleDollarSign],
  ["/opportunities", "Sales & Opportunities", TrendingUp],
  ["/tasks", "Tasks & Follow-ups", Bell],
  ["/assistant", "AI Assistant", Bot],
  ["/ai-activity", "Agent Activity", History],
  ["/reports", "Reports", BarChart3],
  ["/settings", "Settings", Settings],
] as const;

export default function App() { return <AuthProvider><AuthGate /></AuthProvider>; }

function AuthGate() {
  const { configured, loading, session, organizations } = useAuth();
  if (!configured) return <ConfigurationScreen />;
  if (loading) return <div className="grid min-h-screen place-items-center bg-mist text-sm text-slate-500">Restoring Supabase session…</div>;
  if (!session) return <AuthScreen />;
  if (!organizations.length) return <OrganizationSetup />;
  return <AuthenticatedLayout />;
}

function AuthenticatedLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { organizations, activeOrganization, selectOrganization, signOut, user } = useAuth();
  return <div className="min-h-screen bg-mist text-ink">
    <aside className={`fixed inset-y-0 left-0 z-30 w-72 overflow-y-auto border-r border-slate-200 bg-white p-5 transition-transform lg:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between"><Brand /><button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20} /></button></div>
      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace</p><div className="mt-2 flex items-center gap-2"><Building2 size={16} className="shrink-0 text-accent" /><select value={activeOrganization?.id ?? ""} onChange={(event) => void selectOrganization(event.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none">{organizations.map((org) => <option value={org.id} key={org.id}>{org.name}</option>)}</select><ChevronDown size={15} /></div></div>
      <p className="mt-2.5 truncate px-1 text-[11px] leading-4 text-slate-400" title={activeOrganization?.name ?? "Workspace"}>{activeOrganization?.name ?? "Workspace"} · Role: {activeOrganization?.role ?? "unknown"} · Records are organization-scoped.</p>
      <nav className="mt-6 space-y-1 pb-2">{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === "/"} onClick={() => setMobileOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? "bg-ink font-medium text-white" : "text-slate-600 hover:bg-slate-100"}`}><Icon size={17} />{label}</NavLink>)}</nav>
    </aside>
    {mobileOpen && <button className="fixed inset-0 z-20 bg-slate-900/20 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <div className="lg:pl-72"><header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-5 backdrop-blur sm:px-8"><button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={22} /></button><div className="hidden text-sm text-slate-500 sm:block">Apex Business OS</div><div className="ml-auto flex items-center gap-3"><span className="hidden max-w-[220px] truncate text-xs text-slate-500 sm:block">{user?.email}</span><button onClick={() => void signOut()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">Sign out</button><div className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold text-white">A</div></div></header><main className="mx-auto max-w-7xl p-5 sm:p-8"><Routes><Route path="/" element={<LiveDashboard />} /><Route path="/customers" element={<CustomersPage />} /><Route path="/products" element={<ProductsPage />} /><Route path="/suppliers" element={<SuppliersPage />} /><Route path="/inquiries" element={<InquiriesPage />} /><Route path="/quotations" element={<QuotationsPage />} /><Route path="/opportunities" element={<OpportunitiesPage />} /><Route path="/tasks" element={<TasksPage />} /><Route path="/assistant" element={<AssistantPage />} /><Route path="/ai-activity" element={<AIActivityPage />} /><Route path="/reports" element={<ReportsPage />} /><Route path="/settings" element={<MvpSettingsPage />} /><Route path="*" element={<NotFound />} /></Routes></main></div>
    <AskApexPanel />
  </div>;
}

function Brand() { return <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-lg font-bold text-white">A</div><div><p className="text-sm font-semibold tracking-wide">APEX</p><p className="text-xs text-slate-500">Business OS</p></div></div>; }

function NotFound() {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><h1 className="text-2xl font-semibold">Page not found</h1><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">This address does not match any module. Use the navigation to reach a working page.</p><NavLink to="/" className="mt-5 inline-flex rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white">Back to dashboard</NavLink></div>;
}
