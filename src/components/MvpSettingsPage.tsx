import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { fallbackModelCatalog, fetchModelCatalog, saveModelRouting, testMetaConnection, type MetaConnectionTest, type ModelCatalogResponse } from "../lib/model-routing";
import { loadDemoWorkspace, WorkflowRequestError } from "../lib/workflow";
import { previewDemoRecords, resetDemoRecords, type DemoPreview } from "../lib/demo";
import { friendlyError, isMissingTable, orgUpdate } from "../lib/records";
import { CURRENCIES, validateOrganizationSettings, type OrganizationSettingsInput } from "../lib/validation";
import { ConfirmDialog, Detail, FormErrors, MigrationNotice, PageHeader } from "../components/ui";
import { AgentSettingsSections } from "./AgentSettingsSections";

type Member = { user_id: string; role: string; display_name?: string | null };

export function MvpSettingsPage() {
  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" subtitle="Workspace context, company profile, financial defaults, demo data, and server-side Meta configuration." />
      <WorkspaceSection />
      <CompanySettingsSection />
      <DemoSection />
      <MetaSection />
      <AgentSettingsSections />
    </>
  );
}

/* ---------------- Workspace ---------------- */

function WorkspaceSection() {
  const { activeOrganization, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
  const canAdminister = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";
  const isOwner = activeOrganization?.role === "owner";

  const load = async () => {
    if (!supabase || !activeOrganization) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error: queryError } = await supabase.from("org_members").select("user_id,role").eq("org_id", activeOrganization.id).order("role");
      if (queryError) throw queryError;
      const rows = (data ?? []) as Member[];
      const { data: profiles } = await supabase.from("profiles").select("id,display_name").in("id", rows.map((row) => row.user_id));
      const names = new Map(((profiles ?? []) as Array<{ id: string; display_name: string | null }>).map((profile) => [profile.id, profile.display_name]));
      setMembers(rows.map((row) => ({ ...row, display_name: names.get(row.user_id) ?? null })));
    } catch (loadError) {
      setError(friendlyError(loadError, "Workspace members could not be loaded."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setOrgName(activeOrganization?.name ?? "");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization?.id]);

  const saveName = async () => {
    if (!supabase || !activeOrganization || !orgName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await orgUpdate("organizations", activeOrganization.id, activeOrganization.id, { name: orgName.trim() });
      setEditingName(false);
      window.location.reload();
    } catch (saveError) {
      setError(friendlyError(saveError, "Workspace name could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: Member, role: string) => {
    if (!supabase || !activeOrganization) return;
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await supabase.from("org_members").update({ role }).eq("org_id", activeOrganization.id).eq("user_id", member.user_id);
      if (updateError) throw updateError;
      await load();
    } catch (roleError) {
      setError(friendlyError(roleError, "Role could not be changed. The last owner is protected."));
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async () => {
    if (!pendingRemove || !supabase || !activeOrganization) return;
    setBusy(true);
    setError("");
    try {
      const { error: deleteError } = await supabase.from("org_members").delete().eq("org_id", activeOrganization.id).eq("user_id", pendingRemove.user_id);
      if (deleteError) throw deleteError;
      setPendingRemove(null);
      await load();
    } catch (deleteError) {
      setError(friendlyError(deleteError, "Member could not be removed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Workspace</h2>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Organization name" value={activeOrganization?.name ?? "Not available"} />
        <Detail label="Organization role" value={activeOrganization?.role ?? "Not available"} />
        <Detail label="Current user" value={user?.email ?? "Not available"} />
        <Detail label="Organization ID" value={activeOrganization?.id ?? "Not available"} mono />
      </dl>
      {canAdminister && (
        <div className="mt-4">
          {editingName ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input className="field mt-0 sm:max-w-xs" value={orgName} maxLength={200} onChange={(event) => setOrgName(event.target.value)} aria-label="Workspace name" />
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => void saveName()} className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Save</button>
                <button onClick={() => { setEditingName(false); setOrgName(activeOrganization?.name ?? ""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditingName(true)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">Rename workspace</button>
          )}
        </div>
      )}
      <h3 className="mt-6 font-semibold">Members</h3>
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading members…</p>
      ) : error ? (
        <p className="mt-2 text-sm text-red-700">{error}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {members.map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5">
              <span className="font-medium">
                {member.display_name || `${member.user_id.slice(0, 8)}…`}
                {member.user_id === user?.id && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
              </span>
              <span className="flex items-center gap-2">
                {canAdminister && !(member.role === "owner" && !isOwner) ? (
                  <select disabled={busy} value={member.role} onChange={(event) => void changeRole(member, event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs" aria-label={`Role for ${member.display_name ?? member.user_id}`}>
                    {["owner", "admin", "manager", "staff", "viewer"].map((role) => <option value={role} key={role}>{role}</option>)}
                  </select>
                ) : (
                  <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs">{member.role}</span>
                )}
                {canAdminister && member.user_id !== user?.id && (
                  <button disabled={busy} onClick={() => setPendingRemove(member)} className="text-xs font-medium text-red-600 disabled:opacity-40">Remove</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-5 text-slate-500">New members join by signing up with their own email and password; an owner or administrator then adds them to this workspace. Direct email invitations are not supported by the current authentication setup. Owners manage every role; administrators manage non-owner members.</p>
      {pendingRemove && <ConfirmDialog title="Remove member?" message="This person will lose access to every record in this workspace immediately." confirmLabel="Remove member" busy={busy} onConfirm={() => void removeMember()} onCancel={() => setPendingRemove(null)} />}
    </section>
  );
}

/* ---------------- Company profile + financial settings ---------------- */

const EMPTY_SETTINGS: OrganizationSettingsInput = { company_name: "", logo_url: "", description: "", industry: "", website: "", business_email: "", phone: "", address: "", country: "", time_zone: "", default_currency: "BDT", default_tax_rate: 0, tax_registration: "", quotation_validity_days: 30, default_payment_terms: "" };

function CompanySettingsSection() {
  const { activeOrganization } = useAuth();
  const [form, setForm] = useState<OrganizationSettingsInput>(EMPTY_SETTINGS);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canAdminister = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase.from("organization_settings").select("*").eq("org_id", activeOrganization.id).maybeSingle().then(({ data, error }) => {
      if (!active) return;
      if (error && isMissingTable(error)) {
        setAvailable(false);
      } else if (error) {
        setErrors([friendlyError(error, "Company settings could not be loaded.")]);
      } else if (data) {
        setForm({ ...EMPTY_SETTINGS, ...(data as unknown as OrganizationSettingsInput) });
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeOrganization]);

  const update = (key: keyof OrganizationSettingsInput, value: string | number) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!supabase || !activeOrganization) return;
    const checked = validateOrganizationSettings(form);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors([]);
    setNotice("");
    setBusy(true);
    try {
      const values = { org_id: activeOrganization.id, ...checked.value };
      const { error } = await supabase.from("organization_settings").upsert(values, { onConflict: "org_id" });
      if (error) throw error;
      setNotice("Company and financial settings saved for this workspace.");
    } catch (saveError) {
      setErrors([friendlyError(saveError, "Settings could not be saved.")]);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading company settings…</section>;
  if (!available) {
    return (
      <section className="mt-6">
        <MigrationNotice message="Company profile and financial settings need the pending business-completion migration (20261104004000_apex_business_completion.sql). Until it is applied, quotations default to BDT with a 0% tax rate and 30-day validity." />
      </section>
    );
  }

  const input = "field";
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Company profile</h2>
      <p className="mt-1 text-sm text-slate-500">Used on quotations and across the workspace. Each organization keeps its own profile.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="mt-4 block text-xs font-medium text-slate-500">Company name<input className={input} value={form.company_name ?? ""} maxLength={200} disabled={!canAdminister} onChange={(event) => update("company_name", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Industry<input className={input} value={form.industry ?? ""} maxLength={120} disabled={!canAdminister} onChange={(event) => update("industry", event.target.value)} /></label>
      </div>
      <label className="mt-4 block text-xs font-medium text-slate-500">Business description<textarea className={`${input} min-h-16`} value={form.description ?? ""} maxLength={2000} disabled={!canAdminister} onChange={(event) => update("description", event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="mt-4 block text-xs font-medium text-slate-500">Website<input className={input} value={form.website ?? ""} maxLength={200} disabled={!canAdminister} onChange={(event) => update("website", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Logo URL<input className={input} value={form.logo_url ?? ""} maxLength={500} disabled={!canAdminister} onChange={(event) => update("logo_url", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Business email<input className={input} type="email" value={form.business_email ?? ""} disabled={!canAdminister} onChange={(event) => update("business_email", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Phone<input className={input} value={form.phone ?? ""} maxLength={40} disabled={!canAdminister} onChange={(event) => update("phone", event.target.value)} /></label>
      </div>
      <label className="mt-4 block text-xs font-medium text-slate-500">Address<textarea className={`${input} min-h-16`} value={form.address ?? ""} maxLength={1000} disabled={!canAdminister} onChange={(event) => update("address", event.target.value)} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="mt-4 block text-xs font-medium text-slate-500">Country<input className={input} value={form.country ?? ""} maxLength={120} disabled={!canAdminister} onChange={(event) => update("country", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Time zone<input className={input} value={form.time_zone ?? ""} maxLength={80} placeholder="Asia/Dhaka" disabled={!canAdminister} onChange={(event) => update("time_zone", event.target.value)} /></label>
      </div>

      <h2 className="mt-8 font-semibold">Financial settings</h2>
      <p className="mt-1 text-sm text-slate-500">Defaults for new quotations and products. Existing records keep their own values.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="mt-4 block text-xs font-medium text-slate-500">Default currency
          <select className={input} value={form.default_currency ?? "BDT"} disabled={!canAdminister} onChange={(event) => update("default_currency", event.target.value)}>
            {CURRENCIES.map((code) => <option value={code} key={code}>{code}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Default tax rate %<input className={input} type="number" min="0" max="100" step="0.001" value={form.default_tax_rate ?? 0} disabled={!canAdminister} onChange={(event) => update("default_tax_rate", Number(event.target.value))} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Quotation validity (days)<input className={input} type="number" min="1" max="365" step="1" value={form.quotation_validity_days ?? 30} disabled={!canAdminister} onChange={(event) => update("quotation_validity_days", Number(event.target.value))} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="mt-4 block text-xs font-medium text-slate-500">Tax registration<input className={input} value={form.tax_registration ?? ""} maxLength={120} disabled={!canAdminister} onChange={(event) => update("tax_registration", event.target.value)} /></label>
        <label className="mt-4 block text-xs font-medium text-slate-500">Default payment terms<input className={input} value={form.default_payment_terms ?? ""} maxLength={500} placeholder="Net 30" disabled={!canAdminister} onChange={(event) => update("default_payment_terms", event.target.value)} /></label>
      </div>
      {!canAdminister && <p className="mt-4 text-xs text-slate-500">Only an owner or administrator can change company and financial settings.</p>}
      <FormErrors errors={errors} />
      {notice && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {canAdminister && <button disabled={busy} onClick={() => void save()} className="mt-4 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>}
    </section>
  );
}

/* ---------------- Demo workspace ---------------- */

function DemoSection() {
  const { activeOrganization } = useAuth();
  const [seedConfirmation, setSeedConfirmation] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState("");
  const [seedError, setSeedError] = useState("");
  const [preview, setPreview] = useState<DemoPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetResult, setResetResult] = useState("");
  const [resetError, setResetError] = useState("");
  const canSeed = activeOrganization?.role === "owner" || activeOrganization?.role === "admin";

  const seedWorkspace = async () => {
    setSeeding(true);
    setSeedError("");
    setSeedResult("");
    try {
      const response = await loadDemoWorkspace();
      setSeedResult(`${response.counts.customers} customers, ${response.counts.products} products, ${response.counts.inquiries} inquiries, ${response.counts.quotations} draft quotations, ${response.counts.opportunities} opportunities, and ${response.counts.tasks} follow-ups are ready. Re-running this action reuses the same demo records.`);
      setSeedConfirmation(false);
    } catch (error) {
      setSeedError(formatError(error, "Demo workspace loading failed."));
    } finally {
      setSeeding(false);
    }
  };

  const loadPreview = async () => {
    if (!activeOrganization) return;
    setPreviewing(true);
    setResetError("");
    try {
      setPreview(await previewDemoRecords(activeOrganization.id));
    } catch (error) {
      setResetError(friendlyError(error, "Demo records could not be inspected."));
    } finally {
      setPreviewing(false);
    }
  };

  const resetDemo = async () => {
    if (!activeOrganization) return;
    setResetting(true);
    setResetError("");
    setResetResult("");
    try {
      const removed = await resetDemoRecords(activeOrganization.id);
      setResetResult(`Removed ${removed.customers} demo customers, ${removed.products} demo products, ${removed.inquiries} demo inquiries, ${removed.quotations} demo quotations, ${removed.opportunities} demo opportunities, and ${removed.tasks} demo follow-ups. Real business records were not touched.`);
      setPreview(null);
    } catch (error) {
      setResetError(friendlyError(error, "Demo records could not be removed."));
    } finally {
      setResetting(false);
    }
  };

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Demo workspace</p>
          <h2 className="mt-1 text-xl font-semibold">Fictional demonstration data</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Loads labelled demo records (fictional names, <code>.test</code> emails) into only the active organization. Loading is idempotent and additive; it never creates users, resets data, or overwrites business records.</p>
        </div>
        <button disabled={!canSeed || seeding} onClick={() => setSeedConfirmation(true)} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">Load Demo Workspace</button>
      </div>
      {!canSeed && <p className="mt-3 text-sm text-amber-700">Only an organization owner or administrator can load or reset demo data.</p>}
      {seedConfirmation && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="font-medium text-blue-950">Load the fictional demo workspace?</p>
          <p className="mt-1 text-sm text-blue-800">This will create 5 demo customers, 8 demo products, 5 demo inquiries, 3 draft quotations, 2 opportunities, and 5 follow-ups — or reuse them when they already exist.</p>
          <div className="mt-3 flex gap-2">
            <button disabled={seeding} onClick={() => void seedWorkspace()} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{seeding ? "Loading…" : "Confirm load"}</button>
            <button disabled={seeding} onClick={() => setSeedConfirmation(false)} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-medium text-blue-900">Cancel</button>
          </div>
        </div>
      )}
      {seedResult && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{seedResult}</p>}
      {seedError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{seedError}</p>}

      <div className="mt-6 border-t border-slate-100 pt-5">
        <h3 className="font-semibold">Reset demo records only</h3>
        <p className="mt-1 text-sm text-slate-500">Deletes records carrying the demo markers (<code>APEX_DEMO_V1</code>, <code>Apex Demo ·</code>, <code>DEMO-APX-</code>). Real business records never match these markers and are left untouched.</p>
        <button disabled={!canSeed || previewing} onClick={() => void loadPreview()} className="mt-3 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">{previewing ? "Inspecting…" : "Preview demo records"}</button>
        {preview && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">This will permanently delete:</p>
            <p className="mt-1">{preview.customers} customers · {preview.products} products · {preview.inquiries} inquiries · {preview.quotations} quotations · {preview.opportunities} opportunities · {preview.tasks} follow-ups</p>
            <div className="mt-3 flex gap-2">
              <button disabled={resetting} onClick={() => void resetDemo()} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{resetting ? "Removing…" : "Delete demo records"}</button>
              <button disabled={resetting} onClick={() => setPreview(null)} className="rounded-lg border border-amber-200 px-3 py-2 text-sm font-medium text-amber-900">Cancel</button>
            </div>
          </div>
        )}
        {resetResult && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{resetResult}</p>}
        {resetError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{resetError}</p>}
      </div>
    </section>
  );
}

/* ---------------- Meta AI configuration + routing ---------------- */

function MetaSection() {
  const { activeOrganization } = useAuth();
  const [catalog, setCatalog] = useState<ModelCatalogResponse>(() => fallbackModelCatalog("muse-spark-1.3"));
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<MetaConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);
  const isOwner = activeOrganization?.role === "owner";

  const refreshCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const next = await fetchModelCatalog();
      setCatalog(next);
      setSelected(next.settings.manualModel);
    } catch (error) {
      setCatalogError(formatError(error, "Model configuration could not be loaded."));
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    void refreshCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization?.id]);

  const saveMode = async (mode: "auto" | "manual") => {
    setSaving(true);
    setCatalogError("");
    try {
      const next = await saveModelRouting(mode, mode === "manual" ? selected : null);
      setCatalog(next);
      setSelected(next.settings.manualModel);
    } catch (error) {
      setCatalogError(formatError(error, "Model routing could not be updated."));
    } finally {
      setSaving(false);
    }
  };

  const runConnectionTest = async () => {
    setTesting(true);
    setCatalogError("");
    try {
      setConnection(await testMetaConnection());
    } catch (error) {
      setCatalogError(formatError(error, "Connection test failed."));
    } finally {
      setTesting(false);
    }
  };

  const availablePriced = catalog.models.filter((model) => model.available && model.pricingVerified);
  return (
    <>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI settings</p>
            <h2 className="mt-1 text-xl font-semibold">Meta AI configuration</h2>
            <p className="mt-2 text-sm text-slate-500">Configured means the key exists server-side. Reachable means Meta answered. Tested means this page ran a real backend probe.</p>
          </div>
          <button disabled={testing} onClick={() => void runConnectionTest()} className="rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{testing ? "Testing…" : "Test connection"}</button>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <Detail label="API key (server secret)" value={catalog.meta.api_key_configured ? "Configured" : "Not configured"} />
          <Detail label="Default model" value={catalog.meta.default_model} mono />
          <Detail label="API endpoint" value={catalog.meta.api_endpoint} mono />
          <Detail label="Model discovery" value={catalogLoading ? "Checking…" : catalog.discovery.status} />
          <Detail label="Last discovery" value={catalog.discovery.last_discovery_at ? new Date(catalog.discovery.last_discovery_at).toLocaleString() : "Not yet available"} />
          <Detail label="Refresh interval" value={`${catalog.discovery.refresh_seconds} seconds`} />
        </dl>
        {connection && (
          <div className={`mt-4 rounded-xl border p-4 text-sm ${connection.reachable ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            <p className="font-semibold">{connection.reachable ? "Meta API is reachable and tested." : "Meta API did not answer the probe."}</p>
            <p className="mt-1 font-mono text-xs">Status {connection.status} · {connection.latency_ms ?? "—"} ms · {connection.model_count ?? "—"} models · tested {new Date(connection.tested_at).toLocaleString()}{connection.request_id ? ` · request ${connection.request_id}` : ""}</p>
            {connection.error && <p className="mt-1">{connection.error}</p>}
          </div>
        )}
        {!catalog.meta.api_key_configured && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">Add <code>META_API_KEY</code> only through Supabase Edge Function Secrets for this project, then redeploy or invoke a function. The key is never entered, returned, or stored by this page.</p>}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">AI governance</p>
            <h2 className="mt-1 text-xl font-semibold">Verified model routing</h2>
            <p className="mt-2 text-sm text-slate-500">Automatic selection is the default. The server only permits verified models with a verified price for budgeted inquiry analysis.</p>
          </div>
          <button disabled={catalogLoading} onClick={() => void refreshCatalog()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Refresh status</button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Detail label="Routing mode" value={catalog.settings.mode === "manual" ? `Manual · ${catalog.settings.manualModel ?? "not selected"}` : "Automatic"} />
          <Detail label="Usage" value={`$${catalog.usage.committed_cost_usd.toFixed(4)} across ${catalog.usage.request_count} requests`} />
          <Detail label="Spending limit" value={catalog.budget ? `$${catalog.usage.committed_cost_usd.toFixed(4)} / $${catalog.budget.hard_limit_usd.toFixed(2)} hard limit` : "Budget configuration unavailable"} />
        </div>
        {catalog.discovery.error && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Discovery status: {catalog.discovery.error}</p>}
        {catalogError && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{catalogError}</p>}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
              <tr>{["Model", "Availability", "Verified capabilities", "Price", "Usage"].map((label) => <th className="px-4 py-3 font-medium" key={label}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {catalog.models.map((model) => (
                <tr className="border-b border-slate-100 last:border-0" key={model.id}>
                  <td className="px-4 py-3 font-medium text-ink">{model.displayName}<span className="block font-mono text-[11px] text-slate-400">{model.id}</span></td>
                  <td className="px-4 py-3">{model.available ? "Available" : "Not confirmed"}</td>
                  <td className="max-w-sm px-4 py-3 text-xs leading-5 text-slate-600">{model.capabilities.join(", ")}</td>
                  <td className="px-4 py-3">{model.pricingVerified ? "Verified" : "Not available"}</td>
                  <td className="px-4 py-3">{catalog.usage.by_model[model.id] ? `${catalog.usage.by_model[model.id].requests} requests · $${catalog.usage.by_model[model.id].cost_usd.toFixed(4)}` : "No usage"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-[1fr_auto_auto]">
          <label className="text-xs font-medium text-slate-600">Owner-only manual override
            <select disabled={!isOwner || saving || !catalog.settings.available} value={selected ?? ""} onChange={(event) => setSelected(event.target.value || null)} className="field mt-1">
              <option value="">Choose an available priced model</option>
              {availablePriced.map((model) => <option value={model.id} key={model.id}>{model.displayName}</option>)}
            </select>
          </label>
          <button disabled={!isOwner || saving || !catalog.settings.available} onClick={() => void saveMode("auto")} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50">Use automatic</button>
          <button disabled={!isOwner || saving || !selected || !catalog.settings.available} onClick={() => void saveMode("manual")} className="rounded-xl bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Saving…" : "Save manual model"}</button>
        </div>
        <p className="mt-3 text-xs text-slate-500">Only the server-side registry can select model IDs. The current business workflow uses structured extraction; it does not enable tool execution, SQL access, image, or audio workflows. Recent requests and errors live under AI Activity with request IDs.</p>
      </section>
    </>
  );
}

function formatError(error: unknown, fallback: string) {
  if (error instanceof WorkflowRequestError) return `${error.message}${error.requestId ? ` Request ID: ${error.requestId}` : ""}`;
  return error instanceof Error ? error.message : fallback;
}
