import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { getAdminClient } from "../_shared/usage.ts";

import { corsHeadersForRequest } from "../_shared/cors.ts";

// Set per request at the top of the handler; json() reads it for the response.
let corsHeaders: Record<string, string> = { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" };

const DEMO_PREFIX = "APEX_DEMO_V1";
const customerSeed = [
  { name: "Apex Demo · Rahim Trading", email: "rahim.demo@example.test", phone: "+880 1700 000001" },
  { name: "Apex Demo · Nusrat Enterprise", email: "nusrat.demo@example.test", phone: "+880 1700 000002" },
  { name: "Apex Demo · Delta Workshop", email: "delta.demo@example.test", phone: "+880 1700 000003" },
  { name: "Apex Demo · Greenfield Foods", email: "greenfield.demo@example.test", phone: "+880 1700 000004" },
  { name: "Apex Demo · Northstar Logistics", email: "northstar.demo@example.test", phone: "+880 1700 000005" },
];
const productSeed = [
  { sku: "DEMO-APX-001", name: "Apex Business Starter", unit_price: 12500, stock_qty: 42 },
  { sku: "DEMO-APX-002", name: "Apex Operations Suite", unit_price: 28000, stock_qty: 18 },
  { sku: "DEMO-APX-003", name: "Apex Finance Controls", unit_price: 7500, stock_qty: 65 },
  { sku: "DEMO-APX-004", name: "Apex Inventory Pack", unit_price: 18500, stock_qty: 27 },
  { sku: "DEMO-APX-005", name: "Apex CRM Enablement", unit_price: 22000, stock_qty: 31 },
  { sku: "DEMO-APX-006", name: "Apex Reporting Pack", unit_price: 14500, stock_qty: 24 },
  { sku: "DEMO-APX-007", name: "Apex Workflow Credits", unit_price: 9500, stock_qty: 90 },
  { sku: "DEMO-APX-008", name: "Apex Support Retainer", unit_price: 35000, stock_qty: 12 },
];
const inquirySeed = [
  "APEX_DEMO_V1: Rahim Trading requests two Apex Operations Suite licenses and availability confirmation.",
  "APEX_DEMO_V1: Nusrat Enterprise asks for a Finance Controls proposal for its monthly close process.",
  "APEX_DEMO_V1: Delta Workshop requests an Inventory Pack quotation for its service team.",
  "APEX_DEMO_V1: Greenfield Foods asks about CRM Enablement and implementation timing.",
  "APEX_DEMO_V1: Northstar Logistics requests a Reporting Pack follow-up call.",
];
const quoteSeed = [
  { inquiryIndex: 0, productSku: "DEMO-APX-002", quantity: 2 },
  { inquiryIndex: 1, productSku: "DEMO-APX-003", quantity: 3 },
  { inquiryIndex: 2, productSku: "DEMO-APX-004", quantity: 1 },
];

Deno.serve(async (req) => {
  corsHeaders = corsHeadersForRequest(req, Deno.env.get("APP_ORIGIN"));
  const requestId = req.headers.get("x-request-id")?.trim() || crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") return json({ error: "POST is required", request_id: requestId }, 405, requestId);
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required", request_id: requestId }, 401, requestId);
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !publishableKey) throw new Error("Supabase function configuration is incomplete");
    const db = createClient(url, publishableKey, { global: { headers: { Authorization: authHeader } } });
    const admin = getAdminClient();
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData.user) return json({ error: "Unauthorized", request_id: requestId }, 401, requestId);
    const userId = userData.user.id;
    const { data: profile, error: profileError } = await db.from("profiles").select("active_org_id").eq("id", userId).single();
    if (profileError || !profile?.active_org_id) return json({ error: "Select an organization before loading demo data", request_id: requestId }, 400, requestId);
    const orgId = profile.active_org_id;
    const { data: membership, error: membershipError } = await db.from("org_members").select("role").eq("org_id", orgId).eq("user_id", userId).single();
    if (membershipError || !membership || !["owner", "admin"].includes(membership.role)) return json({ error: "Only an organization owner or administrator can load demo data", request_id: requestId }, 403, requestId);

    const customers = [];
    for (const seed of customerSeed) customers.push(await ensureCustomer(db, orgId, seed));
    const products = [];
    for (const seed of productSeed) products.push(await ensureProduct(db, orgId, seed));
    const productsBySku = new Map(products.map((product) => [product.sku, product]));
    const inquiries = [];
    for (let index = 0; index < inquirySeed.length; index += 1) inquiries.push(await ensureInquiry(db, orgId, customers[index].id, inquirySeed[index]));
    const quotations = [];
    for (const seed of quoteSeed) {
      const product = productsBySku.get(seed.productSku);
      if (!product) throw new Error(`Demo product ${seed.productSku} was not available`);
      quotations.push(await ensureQuotation(db, orgId, inquiries[seed.inquiryIndex].id, customers[seed.inquiryIndex].id, product.id, seed.quantity));
    }
    const opportunities = [];
    for (const index of [0, 1]) opportunities.push(await ensureOpportunity(db, orgId, inquiries[index].id, customers[index].id, quotations[index].total));
    const tasks = [];
    for (let index = 0; index < inquirySeed.length; index += 1) tasks.push(await ensureTask(db, orgId, inquiries[index].id, customers[index].id, index));

    const counts = { customers: customers.length, products: products.length, inquiries: inquiries.length, quotations: quotations.length, opportunities: opportunities.length, tasks: tasks.length };
    const { error: auditError } = await admin.rpc("record_audit_log_event", { p_event_key: `demo_workspace_seed:${orgId}:${DEMO_PREFIX}`, p_org_id: orgId, p_actor_id: userId, p_action: "demo_workspace_seeded", p_entity_type: "organization", p_entity_id: orgId, p_metadata: { request_id: requestId, demo_version: DEMO_PREFIX, counts } });
    if (auditError) throw auditError;
    return json({ status: "seeded", request_id: requestId, organization_id: orgId, demo_version: DEMO_PREFIX, counts, note: "All records are fictional demo data. Re-running this action reuses the deterministic demo records." }, 200, requestId);
  } catch (error) {
    console.error(JSON.stringify({ request_id: requestId, error: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "Demo workspace could not be loaded", request_id: requestId }, 500, requestId);
  }
});

async function ensureCustomer(db: ReturnType<typeof createClient>, orgId: string, seed: { name: string; email: string; phone: string }) {
  const { data: existing, error: lookupError } = await db.from("customers").select("id,name,email,phone").eq("org_id", orgId).eq("name", seed.name).eq("email", seed.email).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const { data, error } = await db.from("customers").insert({ org_id: orgId, ...seed }).select("id,name,email,phone").single();
  if (error) throw error;
  return data;
}

async function ensureProduct(db: ReturnType<typeof createClient>, orgId: string, seed: { sku: string; name: string; unit_price: number; stock_qty: number }) {
  const { data: existing, error: lookupError } = await db.from("products").select("id,sku,name,unit_price,tax_rate,stock_qty").eq("org_id", orgId).eq("sku", seed.sku).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const { data, error } = await db.from("products").insert({ org_id: orgId, ...seed, tax_rate: 0, active: true }).select("id,sku,name,unit_price,tax_rate,stock_qty").single();
  if (error) throw error;
  return data;
}

async function ensureInquiry(db: ReturnType<typeof createClient>, orgId: string, customerId: string, content: string) {
  const { data: existing, error: lookupError } = await db.from("inquiries").select("id,customer_id,content,status").eq("org_id", orgId).eq("content", content).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const { data, error } = await db.from("inquiries").insert({ org_id: orgId, customer_id: customerId, content, status: "new" }).select("id,customer_id,content,status").single();
  if (error) throw error;
  return data;
}

async function ensureQuotation(db: ReturnType<typeof createClient>, orgId: string, inquiryId: string, customerId: string, productId: string, quantity: number) {
  const { data: existing, error: lookupError } = await db.from("quotations").select("id,subtotal,tax_total,total,status").eq("org_id", orgId).eq("inquiry_id", inquiryId).maybeSingle();
  if (lookupError) throw lookupError;
  let quotation = existing;
  if (!quotation) {
    const { data, error } = await db.from("quotations").insert({ org_id: orgId, inquiry_id: inquiryId, customer_id: customerId, status: "draft", currency: "BDT" }).select("id,subtotal,tax_total,total,status").single();
    if (error) throw error;
    quotation = data;
  }
  if (!quotation) throw new Error("Demo quotation could not be created");
  const { data: line, error: lineLookupError } = await db.from("quotation_lines").select("id").eq("org_id", orgId).eq("quotation_id", quotation.id).eq("product_id", productId).maybeSingle();
  if (lineLookupError) throw lineLookupError;
  if (!line) {
    const { error } = await db.from("quotation_lines").insert({ org_id: orgId, quotation_id: quotation.id, product_id: productId, quantity, unit_price: 0, tax_rate: 0, line_total: 0 });
    if (error) throw error;
  }
  const { data: refreshed, error: refreshError } = await db.from("quotations").select("id,subtotal,tax_total,total,status").eq("org_id", orgId).eq("id", quotation.id).single();
  if (refreshError) throw refreshError;
  return refreshed;
}

async function ensureOpportunity(db: ReturnType<typeof createClient>, orgId: string, inquiryId: string, customerId: string, estimatedValue: number) {
  const { data: existing, error: lookupError } = await db.from("opportunities").select("id,title,status,estimated_value").eq("org_id", orgId).eq("inquiry_id", inquiryId).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const { data, error } = await db.from("opportunities").insert({ org_id: orgId, customer_id: customerId, inquiry_id: inquiryId, title: `${DEMO_PREFIX} · Demo sales opportunity`, status: "proposed", estimated_value: estimatedValue }).select("id,title,status,estimated_value").single();
  if (error) throw error;
  return data;
}

async function ensureTask(db: ReturnType<typeof createClient>, orgId: string, inquiryId: string, customerId: string, index: number) {
  const title = `${DEMO_PREFIX} · Follow up ${index + 1}`;
  const { data: existing, error: lookupError } = await db.from("tasks").select("id,title,status,due_at").eq("org_id", orgId).eq("inquiry_id", inquiryId).eq("title", title).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;
  const { data, error } = await db.from("tasks").insert({ org_id: orgId, customer_id: customerId, inquiry_id: inquiryId, title, status: "open", due_at: new Date(Date.now() + (index + 1) * 86400000).toISOString() }).select("id,title,status,due_at").single();
  if (error) throw error;
  return data;
}

function json(body: unknown, status = 200, requestId?: string) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, ...(requestId ? { "x-request-id": requestId } : {}), "Content-Type": "application/json" } });
}
