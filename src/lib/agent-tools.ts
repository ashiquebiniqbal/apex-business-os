import { supabase } from "./supabase";
import { orgInsert, orgUpdate, friendlyError } from "./records";
import { canAdminister, canManage, canOperate } from "./roles";
import { validateCustomer, validateInquiry, validateOpportunity, validateProduct, validateQuotationLine, validateTask } from "./validation";

export type ToolCategory = "read" | "low" | "high";
export type ToolContext = { orgId: string; role: string | null; currency: string };
export type ToolResult = { tool: string; ok: boolean; summary: string; data?: unknown; error?: string };
export type ToolDef = {
  id: string; description: string; category: ToolCategory; permission: "any" | "operate" | "manage" | "administer";
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
};

function allowed(permission: ToolDef["permission"], role: string | null): boolean {
  if (permission === "any") return true;
  if (permission === "operate") return canOperate(role);
  if (permission === "manage") return canManage(role);
  return canAdminister(role);
}
function ok(tool: string, summary: string, data?: unknown): ToolResult { return { tool, ok: true, summary, data }; }
function fail(tool: string, error: unknown): ToolResult { const message = friendlyError(error, "Tool execution failed."); return { tool, ok: false, summary: message, error: message }; }
function str(args: Record<string, unknown>, key: string): string { const v = args[key]; return typeof v === "string" ? v.trim() : ""; }
function num(args: Record<string, unknown>, key: string, fallback: number): number { const v = Number(args[key]); return Number.isFinite(v) ? v : fallback; }

async function search(table: string, ctx: ToolContext, args: Record<string, unknown>, columns: string, textColumn: string): Promise<ToolResult> {
  const tool = `${table}.search`;
  if (!supabase) return fail(tool, new Error("Supabase is not configured."));
  const query = str(args, "query");
  let request = supabase.from(table).select(columns).eq("org_id", ctx.orgId).order("created_at", { ascending: false }).limit(20);
  if (query) request = request.ilike(textColumn, `%${query}%`);
  if (table === "inquiries" && str(args, "status")) request = request.eq("status", str(args, "status"));
  if (table === "products") request = request.eq("active", true);
  const { data, error } = await request;
  if (error) return fail(tool, error);
  return ok(tool, `Found ${(data ?? []).length} ${table} record(s).`, data ?? []);
}

export const TOOL_REGISTRY: ToolDef[] = [
  { id: "customers.search", description: "Search customers by name", category: "read", permission: "any", run: (c, a) => search("customers", c, a, "id,name,email,phone,customer_type,created_at", "name") },
  { id: "customers.create", description: "Create a customer", category: "low", permission: "operate", run: async (c, a) => { const v = validateCustomer({ name: str(a, "name"), email: str(a, "email") || null, phone: str(a, "phone") || null }); if (!v.ok) return fail("customers.create", new Error(v.errors.join(" "))); try { const row = await orgInsert("customers", c.orgId, v.value as unknown as Record<string, unknown>); return ok("customers.create", `Customer created: ${str(a, "name")}`, row); } catch (e) { return fail("customers.create", e); } } },
  { id: "customers.update", description: "Update a customer", category: "low", permission: "operate", run: async (c, a) => { try { await orgUpdate("customers", c.orgId, str(a, "id"), { name: str(a, "name") || undefined, phone: str(a, "phone") || null }); return ok("customers.update", "Customer updated."); } catch (e) { return fail("customers.update", e); } } },
  { id: "products.search", description: "Search active products/services with recorded prices", category: "read", permission: "any", run: (c, a) => search("products", c, a, "id,sku,name,unit_price,tax_rate,stock_qty,kind,category", "name") },
  { id: "products.create", description: "Create a product/service", category: "low", permission: "manage", run: async (c, a) => { const v = validateProduct({ sku: str(a, "sku"), name: str(a, "name"), unit_price: num(a, "unit_price", -1), tax_rate: num(a, "tax_rate", 0), stock_qty: num(a, "stock_qty", 0) }); if (!v.ok) return fail("products.create", new Error(v.errors.join(" "))); try { const row = await orgInsert("products", c.orgId, v.value as unknown as Record<string, unknown>); return ok("products.create", `Product created: ${str(a, "name")}`, row); } catch (e) { return fail("products.create", e); } } },
  { id: "products.update", description: "Update a product price/stock", category: "low", permission: "manage", run: async (c, a) => { try { await orgUpdate("products", c.orgId, str(a, "id"), { unit_price: num(a, "unit_price", 0), stock_qty: num(a, "stock_qty", 0) }); return ok("products.update", "Product updated. The database keeps historical quotation prices unchanged."); } catch (e) { return fail("products.update", e); } } },
  { id: "suppliers.search", description: "Search suppliers by name", category: "read", permission: "any", run: (c, a) => search("suppliers", c, a, "id,name,email,phone,created_at", "name") },
  { id: "inquiries.search", description: "Search inquiries; pass status to filter (e.g. new)", category: "read", permission: "any", run: (c, a) => search("inquiries", c, a, "id,content,status,customer_id,created_at", "content") },
  { id: "inquiries.create", description: "Create an inquiry", category: "low", permission: "operate", run: async (c, a) => { const v = validateInquiry({ content: str(a, "content"), status: "new", customer_id: str(a, "customer_id") || null }); if (!v.ok) return fail("inquiries.create", new Error(v.errors.join(" "))); try { const row = await orgInsert("inquiries", c.orgId, v.value as unknown as Record<string, unknown>); return ok("inquiries.create", "Inquiry created.", row); } catch (e) { return fail("inquiries.create", e); } } },
  { id: "inquiries.update", description: "Update inquiry status", category: "low", permission: "operate", run: async (c, a) => { const v = validateInquiry({ content: str(a, "content") || "status update", status: str(a, "status") || undefined }); if (!v.ok) return fail("inquiries.update", new Error(v.errors.join(" "))); try { await orgUpdate("inquiries", c.orgId, str(a, "id"), { status: str(a, "status") }); return ok("inquiries.update", `Inquiry status set to ${str(a, "status")}.`); } catch (e) { return fail("inquiries.update", e); } } },
  { id: "quotations.create", description: "Create a draft quotation in the organization currency (approval required)", category: "high", permission: "manage", run: async (c, a) => { try { const row = await orgInsert("quotations", c.orgId, { customer_id: str(a, "customer_id") || null, inquiry_id: str(a, "inquiry_id") || null, status: "draft", currency: c.currency }); return ok("quotations.create", `Draft quotation created in ${c.currency}.`, row); } catch (e) { return fail("quotations.create", e); } } },
  { id: "quotations.add_line", description: "Add a product line; database snapshots price/tax and recalculates totals", category: "high", permission: "manage", run: async (c, a) => { const v = validateQuotationLine({ product_id: str(a, "product_id"), quantity: num(a, "quantity", 0), discount_rate: num(a, "discount_rate", 0) }); if (!v.ok) return fail("quotations.add_line", new Error(v.errors.join(" "))); try { const row = await orgInsert("quotation_lines", c.orgId, { quotation_id: str(a, "quotation_id"), product_id: v.value.product_id, quantity: v.value.quantity, discount_rate: v.value.discount_rate ?? 0 }); return ok("quotations.add_line", "Quotation line added; totals recalculated by the database.", row); } catch (e) { return fail("quotations.add_line", e); } } },
  { id: "quotations.update", description: "Update quotation status (approval required)", category: "high", permission: "manage", run: async (c, a) => { try { await orgUpdate("quotations", c.orgId, str(a, "id"), { status: str(a, "status") }); return ok("quotations.update", `Quotation status set to ${str(a, "status")}.`); } catch (e) { return fail("quotations.update", e); } } },
  { id: "opportunities.search", description: "Search opportunities", category: "read", permission: "any", run: (c, a) => search("opportunities", c, a, "id,title,status,estimated_value,customer_id,inquiry_id,created_at", "title") },
  { id: "opportunities.update", description: "Update an opportunity", category: "low", permission: "manage", run: async (c, a) => { const v = validateOpportunity({ title: str(a, "title") || "Opportunity", status: str(a, "status") || undefined }); if (!v.ok) return fail("opportunities.update", new Error(v.errors.join(" "))); try { await orgUpdate("opportunities", c.orgId, str(a, "id"), { status: str(a, "status") || undefined, estimated_value: a.estimated_value == null ? undefined : num(a, "estimated_value", 0) }); return ok("opportunities.update", "Opportunity updated."); } catch (e) { return fail("opportunities.update", e); } } },
  { id: "tasks.create", description: "Create a follow-up task", category: "low", permission: "operate", run: async (c, a) => { const v = validateTask({ title: str(a, "title"), status: "open", customer_id: str(a, "customer_id") || null, inquiry_id: str(a, "inquiry_id") || null }); if (!v.ok) return fail("tasks.create", new Error(v.errors.join(" "))); try { const row = await orgInsert("tasks", c.orgId, v.value as unknown as Record<string, unknown>); return ok("tasks.create", `Task created: ${str(a, "title")}`, row); } catch (e) { return fail("tasks.create", e); } } },
  { id: "tasks.update", description: "Update a task status", category: "low", permission: "operate", run: async (c, a) => { try { await orgUpdate("tasks", c.orgId, str(a, "id"), { status: str(a, "status") }); return ok("tasks.update", `Task status set to ${str(a, "status")}.`); } catch (e) { return fail("tasks.update", e); } } },
  { id: "reports.get_summary", description: "Real counts, overdue tasks and pending value for the organization", category: "read", permission: "any", run: async (c) => {
      if (!supabase) return fail("reports.get_summary", new Error("Supabase is not configured."));
      try {
        const client = supabase;
        const count = async (table: string, build: (q: any) => any = (q) => q) => { const r = await build(client.from(table).select("*", { count: "exact", head: true }).eq("org_id", c.orgId)); if (r.error) throw r.error; return r.count ?? 0; };
        const [customers, products, openInquiries, draftQuotations, openOpportunities, overdueTasks] = await Promise.all([
          count("customers"), count("products"), count("inquiries", (q) => q.in("status", ["new", "processing", "proposal"])),
          count("quotations", (q) => q.in("status", ["draft", "pending_approval"])), count("opportunities", (q) => q.in("status", ["proposed", "open"])),
          count("tasks", (q) => q.eq("status", "open").lt("due_at", new Date().toISOString())),
        ]);
        return ok("reports.get_summary", `${customers} customers · ${products} products · ${openInquiries} open inquiries · ${draftQuotations} pending quotations · ${openOpportunities} open opportunities · ${overdueTasks} overdue tasks.`, { customers, products, openInquiries, draftQuotations, openOpportunities, overdueTasks });
      } catch (e) { return fail("reports.get_summary", e); }
    } },
  { id: "organization.get_settings", description: "Read company and financial settings", category: "read", permission: "any", run: async (c) => { if (!supabase) return fail("organization.get_settings", new Error("Supabase is not configured.")); const { data, error } = await supabase.from("organization_settings").select("*").eq("org_id", c.orgId).maybeSingle(); if (error) return fail("organization.get_settings", error); return ok("organization.get_settings", data ? `Currency ${data.default_currency}, tax ${data.default_tax_rate}%, validity ${data.quotation_validity_days} days.` : "No settings row yet; defaults are BDT, 0% tax, 30 days.", data); } },
];

export function getTool(id: string): ToolDef | undefined { return TOOL_REGISTRY.find((tool) => tool.id === id); }

/** Single execution gate: permission, category approval, then the typed tool. */
export async function executeTool(ctx: ToolContext, toolId: string, args: Record<string, unknown>, approved = false): Promise<ToolResult & { requiresApproval?: boolean }> {
  const tool = getTool(toolId);
  if (!tool) return { tool: toolId, ok: false, summary: `Unknown tool: ${toolId}`, error: "unknown_tool" };
  if (!allowed(tool.permission, ctx.role)) return { tool: toolId, ok: false, summary: `Your role (${ctx.role ?? "unknown"}) cannot run ${toolId}. The database policy also enforces this.`, error: "permission_denied" };
  if (tool.category === "high" && !approved) return { tool: toolId, ok: false, summary: `${toolId} is a high-impact write and needs explicit approval first.`, error: "approval_required", requiresApproval: true };
  return tool.run(ctx, args);
}
