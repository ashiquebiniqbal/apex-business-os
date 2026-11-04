import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { FALLBACK_CURRENCY, resolveOrganizationCurrency } from "../_shared/currency.ts";
import { getAdminClient } from "../_shared/usage.ts";

import { corsHeadersForRequest } from "../_shared/cors.ts";

// Set per request at the top of the handler; json() reads it for the response.
let corsHeaders: Record<string, string> = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" };

Deno.serve(async (req) => {
  corsHeaders = corsHeadersForRequest(req, Deno.env.get("APP_ORIGIN"));
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required", request_id: requestId }, 401, requestId);
    const payload = await req.json() as { workflow_run_id?: string };
    if (!payload.workflow_run_id || !/^[0-9a-f-]{36}$/i.test(payload.workflow_run_id)) return json({ error: "workflow_run_id is required", request_id: requestId }, 400, requestId);
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !publishableKey) throw new Error("Supabase function configuration is incomplete");
    const db = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } } });
    const admin = getAdminClient();
    const { data: userData } = await db.auth.getUser();
    if (!userData.user) return json({ error: "Unauthorized", request_id: requestId }, 401, requestId);
    const userId = userData.user.id;
    const { data: profile } = await db.from("profiles").select("active_org_id").eq("id", userId).single();
    if (!profile?.active_org_id) return json({ error: "Select an organization before approving", request_id: requestId }, 400, requestId);
    const orgId = profile.active_org_id;
    const { data: membership } = await db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).single();
    if (!membership || !["owner", "admin", "manager"].includes(membership.role)) return json({ error: "Only a manager, admin, or owner can approve proposals", request_id: requestId }, 403, requestId);
    const { data: run, error: runError } = await db.from("workflow_runs").select("id,org_id,inquiry_id,status,input").eq("id", payload.workflow_run_id).eq("org_id", orgId).single();
    if (runError || !run) return json({ error: "Workflow proposal not found", request_id: requestId }, 404, requestId);

    if (run.status === "executed") return await existingExecution(db, run.id, requestId);
    if (run.status !== "proposed") return json({ error: `Workflow is already ${run.status}`, request_id: requestId }, 409, requestId);
    let input: { customerName: string; productQuery: string; quantity: number };
    try {
      input = parseWorkflowInput(run.input);
    } catch {
      return json({ error: "Stored workflow input is invalid; approval was not executed", request_id: requestId }, 400, requestId);
    }
    const { data: products } = await db.from("products").select("id,name,unit_price,tax_rate,stock_qty").eq("org_id", run.org_id).eq("active", true).ilike("name", `%${input.productQuery}%`).order("name").limit(2);
    const product = (products ?? [])[0] ?? null;
    if (!product) return json({ error: "Product is no longer active or cannot be found", request_id: requestId }, 409, requestId);
    if ((products ?? []).length > 1) return json({ error: "Several active products match the stored request; re-run the proposal with a narrower product lookup", request_id: requestId }, 409, requestId);
    if (Number(product.stock_qty) < input.quantity) return json({ error: "Current stock is insufficient; approval was not executed", available_stock: product.stock_qty, request_id: requestId }, 409, requestId);
    const { data: customers } = await db.from("customers").select("id").eq("org_id", run.org_id).ilike("name", input.customerName).order("name").limit(1);
    const customer = (customers ?? [])[0] ?? null;
    // Currency is a server-side organization fact; it is never taken from the proposal payload.
    const currency = await resolveOrganizationCurrency(admin, run.org_id);

    let quotation = await findQuotation(db, run.id);
    if (!quotation) {
      const { data: created, error: quoteError } = await db.from("quotations").insert({ workflow_run_id: run.id, org_id: run.org_id, inquiry_id: run.inquiry_id, customer_id: customer?.id ?? null, status: "pending_approval", currency }).select("id,status,currency,subtotal,tax_total,total").single();
      if (quoteError && quoteError.code !== "23505") throw quoteError;
      quotation = created ?? await findQuotation(db, run.id);
    }
    if (!quotation) throw new Error("Quotation could not be created or recovered");

    const { data: existingLine } = await db.from("quotation_lines").select("id").eq("org_id", run.org_id).eq("quotation_id", quotation.id).maybeSingle();
    if (!existingLine) {
      const { error: lineError } = await db.from("quotation_lines").insert({ org_id: run.org_id, quotation_id: quotation.id, product_id: product.id, quantity: input.quantity, unit_price: 0, tax_rate: 0, line_total: 0 });
      if (lineError && lineError.code !== "23505") throw lineError;
    }
    const { data: approvedQuotation, error: approvalError } = await db.from("quotations").update({ status: "approved" }).eq("id", quotation.id).eq("org_id", run.org_id).select("id,currency,subtotal,tax_total,total").single();
    if (approvalError || !approvedQuotation) throw approvalError ?? new Error("Quotation approval failed");

    const opportunity = await ensureOpportunity(db, run, customer?.id ?? null, input, product.name, Number(approvedQuotation.total));
    const task = await ensureTask(db, run, customer?.id ?? null, input);
    const { data: updatedRun, error: runUpdateError } = await db.from("workflow_runs").update({ status: "executed", output: { quotation_id: approvedQuotation.id, opportunity_id: opportunity?.id ?? null, task_id: task?.id ?? null, total: approvedQuotation.total } }).eq("id", run.id).eq("status", "proposed").select("id").maybeSingle();
    if (runUpdateError) throw runUpdateError;
    if (updatedRun) {
      const { error: auditError } = await admin.rpc("record_audit_log_event", { p_event_key: `inquiry_workflow_executed:${run.id}`, p_org_id: run.org_id, p_actor_id: userId, p_action: "inquiry_workflow_executed", p_entity_type: "quotation", p_entity_id: approvedQuotation.id, p_metadata: { request_id: requestId, workflow_run_id: run.id, total: approvedQuotation.total } });
      if (auditError) throw auditError;
    }
    return json({ status: "executed", request_id: requestId, quotation_id: approvedQuotation.id, opportunity_id: opportunity?.id ?? null, task_id: task?.id ?? null, subtotal: approvedQuotation.subtotal, tax_total: approvedQuotation.tax_total, total: approvedQuotation.total, currency: approvedQuotation.currency ?? currency }, 200, requestId);
  } catch (error) {
    console.error(JSON.stringify({ request_id: requestId, error: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "Approval execution failed", request_id: requestId }, 500, requestId);
  }
});

async function existingExecution(db: ReturnType<typeof createClient>, workflowRunId: string, requestId: string) {
  const [{ data: quotation }, { data: opportunity }, { data: task }] = await Promise.all([
    db.from("quotations").select("id,currency,subtotal,tax_total,total").eq("workflow_run_id", workflowRunId).maybeSingle(),
    db.from("opportunities").select("id").eq("workflow_run_id", workflowRunId).maybeSingle(),
    db.from("tasks").select("id").eq("workflow_run_id", workflowRunId).maybeSingle(),
  ]);
  if (!quotation) return json({ error: "Executed workflow artifacts could not be recovered", request_id: requestId }, 500, requestId);
  // Replays always report the currency stored on the quotation; finalized records are never rewritten.
  return json({ status: "executed", idempotent_replay: true, request_id: requestId, quotation_id: quotation.id, opportunity_id: opportunity?.id ?? null, task_id: task?.id ?? null, subtotal: quotation.subtotal, tax_total: quotation.tax_total, total: quotation.total, currency: quotation.currency ?? FALLBACK_CURRENCY }, 200, requestId);
}

async function findQuotation(db: ReturnType<typeof createClient>, workflowRunId: string) {
  const { data } = await db.from("quotations").select("id,status,currency,subtotal,tax_total,total").eq("workflow_run_id", workflowRunId).maybeSingle();
  return data;
}

async function ensureOpportunity(db: ReturnType<typeof createClient>, run: any, customerId: string | null, input: { customerName: string; productQuery: string }, productName: string, total: number) {
  const { data: existing } = await db.from("opportunities").select("id").eq("workflow_run_id", run.id).maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("opportunities").insert({ workflow_run_id: run.id, org_id: run.org_id, customer_id: customerId, inquiry_id: run.inquiry_id, title: `${input.customerName} · ${productName}`, status: "open", estimated_value: total }).select("id").single();
  if (error && error.code !== "23505") throw error;
  return data ?? (await db.from("opportunities").select("id").eq("workflow_run_id", run.id).single()).data;
}

async function ensureTask(db: ReturnType<typeof createClient>, run: any, customerId: string | null, input: { customerName: string }) {
  const { data: existing } = await db.from("tasks").select("id").eq("workflow_run_id", run.id).maybeSingle();
  if (existing) return existing;
  const { data, error } = await db.from("tasks").insert({ workflow_run_id: run.id, org_id: run.org_id, customer_id: customerId, inquiry_id: run.inquiry_id, title: `Follow up on approved quotation for ${input.customerName}`, status: "open", due_at: new Date(Date.now() + 86400000).toISOString() }).select("id").single();
  if (error && error.code !== "23505") throw error;
  return data ?? (await db.from("tasks").select("id").eq("workflow_run_id", run.id).single()).data;
}

function parseWorkflowInput(value: unknown) {
  const input = value as { customerName?: unknown; productQuery?: unknown; quantity?: unknown } | null;
  const quantity = Number(input?.quantity);
  if (!input || typeof input.customerName !== "string" || typeof input.productQuery !== "string" || !Number.isFinite(quantity) || quantity <= 0) throw new Error("Stored workflow input is invalid");
  return { customerName: input.customerName, productQuery: input.productQuery, quantity };
}

function json(body: unknown, status = 200, requestId?: string) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...(requestId ? { "x-request-id": requestId } : {}), "Content-Type": "application/json" } }); }
