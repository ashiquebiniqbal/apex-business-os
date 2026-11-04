import { calculateQuote } from "./quote";

export type PermissionLevel = "any" | "operate" | "manage" | "administer";
export type AgentStatus = "ready" | "disabled";
export type AgentProfile = {
  id: string; name: string; description: string; responsibilities: string[];
  systemInstructions: string; allowedTools: string[]; restrictedTools: string[];
  requiredPermission: PermissionLevel; providerPreference: string; status: AgentStatus;
};

const NO_EXTERNAL = ["external.send", "records.delete", "settings.financial.update", "permissions.update"];

export const AGENT_REGISTRY: AgentProfile[] = [
  { id: "orchestrator", name: "Orchestrator", description: "Plans and coordinates specialist agents.", responsibilities: ["Understand requests", "Create execution plans", "Select specialists", "Track progress", "Request approval", "Produce final reports"], systemInstructions: "Plan first, use only authorized tools, never invent data, ask approval for high-impact writes.", allowedTools: ["reports.get_summary", "inquiries.search", "organization.get_settings"], restrictedTools: NO_EXTERNAL, requiredPermission: "operate", providerPreference: "auto (verified Meta routing)", status: "ready" },
  { id: "worker", name: "Worker", description: "Executes authorized routine operations.", responsibilities: ["Create and update records", "Complete assigned tasks", "Report results"], systemInstructions: "Execute only assigned, authorized steps and report exactly what changed.", allowedTools: ["tasks.create", "tasks.update", "customers.create", "customers.update", "inquiries.update"], restrictedTools: NO_EXTERNAL, requiredPermission: "operate", providerPreference: "auto", status: "ready" },
  { id: "sales", name: "Sales", description: "Customers, inquiries, opportunities and follow-ups.", responsibilities: ["Search customers", "Manage inquiries and leads", "Update opportunities", "Prepare quotation requests", "Generate follow-up tasks"], systemInstructions: "Use real organization records only. Quote prices come from Finance, never from memory.", allowedTools: ["customers.search", "customers.create", "customers.update", "inquiries.search", "inquiries.create", "inquiries.update", "opportunities.search", "opportunities.update", "tasks.create"], restrictedTools: NO_EXTERNAL, requiredPermission: "operate", providerPreference: "auto", status: "ready" },
  { id: "finance", name: "Finance", description: "Quotations, real prices, taxes and payment terms.", responsibilities: ["Prepare quotations", "Retrieve actual product prices", "Calculate totals via backend logic", "Review payment terms and taxes"], systemInstructions: "Never invent prices, taxes or totals. Prices come from product records; the database recalculates quotation totals.", allowedTools: ["products.search", "quotations.create", "quotations.add_line", "quotations.update", "organization.get_settings"], restrictedTools: ["settings.financial.update", "external.send"], requiredPermission: "manage", providerPreference: "auto", status: "ready" },
  { id: "operations", name: "Operations", description: "Products, suppliers, stock and purchasing support.", responsibilities: ["Manage products and services", "Manage suppliers", "Review stock", "Support purchasing tasks"], systemInstructions: "Report recorded stock only; flag low stock instead of estimating it.", allowedTools: ["products.search", "products.create", "products.update", "suppliers.search", "tasks.create"], restrictedTools: NO_EXTERNAL, requiredPermission: "operate", providerPreference: "auto", status: "ready" },
  { id: "quality", name: "Quality Checker", description: "Validates proposed changes before execution.", responsibilities: ["Validate proposed changes", "Check required fields", "Check quotation calculations", "Flag missing or inconsistent data"], systemInstructions: "Return PASS, WARNING or FAIL with concrete reasons. A FAIL blocks execution.", allowedTools: ["inquiries.search", "products.search", "reports.get_summary", "organization.get_settings"], restrictedTools: NO_EXTERNAL, requiredPermission: "any", providerPreference: "auto", status: "ready" },
  { id: "admin", name: "Admin", description: "Workspace settings and configuration help.", responsibilities: ["Read workspace settings", "Help configure company information", "Assist with integrations and users"], systemInstructions: "Never bypass role restrictions or change permissions without explicit authorized approval.", allowedTools: ["organization.get_settings", "reports.get_summary"], restrictedTools: ["permissions.update", "settings.financial.update"], requiredPermission: "administer", providerPreference: "auto", status: "ready" },
  { id: "writer", name: "Writer", description: "Business writing from real records.", responsibilities: ["Draft business emails", "Prepare customer responses", "Prepare proposals and documents"], systemInstructions: "Draft only; never send. Base every claim on retrieved records and label drafts clearly.", allowedTools: ["customers.search", "inquiries.search", "reports.get_summary"], restrictedTools: ["external.send"], requiredPermission: "operate", providerPreference: "auto", status: "ready" },
  { id: "marketing", name: "Marketing", description: "Posts and product descriptions from real records.", responsibilities: ["Draft marketing posts", "Create product descriptions"], systemInstructions: "Draft only; never publish. Use recorded product facts only.", allowedTools: ["products.search", "reports.get_summary"], restrictedTools: ["external.send"], requiredPermission: "operate", providerPreference: "auto", status: "ready" },
  { id: "reporter", name: "Reporter / Analyst", description: "Summaries and metrics from authorized records.", responsibilities: ["Query authorized records", "Generate summaries", "Calculate actual metrics", "Identify overdue tasks and pending opportunities"], systemInstructions: "Never fabricate numbers. Every metric must come from a tool result.", allowedTools: ["reports.get_summary", "inquiries.search", "opportunities.search", "tasks.update"], restrictedTools: NO_EXTERNAL, requiredPermission: "any", providerPreference: "auto", status: "ready" },
];

export function getAgent(id: string): AgentProfile {
  return AGENT_REGISTRY.find((agent) => agent.id === id) ?? AGENT_REGISTRY[0];
}

export type QualityVerdict = { verdict: "PASS" | "WARNING" | "FAIL"; reasons: string[]; actions: string[] };

/** Pure quotation proposal check used by the Quality Checker agent. */
export function checkQuotationProposal(input: { productName?: string | null; unitPrice?: number | null; taxRate?: number | null; quantity: number; currency?: string | null; customerLinked: boolean; stockQty?: number | null; quantityStated?: boolean }): QualityVerdict {
  const reasons: string[] = [];
  const actions: string[] = [];
  if (!input.productName) { reasons.push("No matching product with a recorded price was found."); actions.push("Narrow the product lookup to one active product, or create the product record first."); }
  if (input.unitPrice == null || !Number.isFinite(input.unitPrice) || input.unitPrice < 0) { reasons.push("Product has no valid recorded unit price."); actions.push("Record a valid unit price on the product before quoting."); }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) { reasons.push("Quantity must be positive."); actions.push("Confirm a positive quantity with the customer."); }
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency)) { reasons.push("Organization currency is missing or invalid."); actions.push("Set the organization currency in Settings."); }
  if (input.stockQty != null && Number.isFinite(input.quantity) && input.quantity > input.stockQty) { reasons.push(`Recorded stock is ${input.stockQty}, lower than the requested quantity ${input.quantity}.`); actions.push(`Reduce the quantity to at most ${input.stockQty} or replenish stock before quoting.`); }
  if (reasons.length) return { verdict: "FAIL", reasons, actions };
  try {
    const totals = calculateQuote(Number(input.unitPrice), Number(input.taxRate ?? 0), input.quantity);
    if (totals.total <= 0) { reasons.push("Calculated total is zero; confirm this is intentional."); actions.push("Confirm the zero total with the customer before approval."); }
  } catch { return { verdict: "FAIL", reasons: ["Quotation calculation failed for the recorded price, tax, or quantity."], actions: ["Check the recorded price, tax rate, and quantity, then re-run."] }; }
  if (!input.customerLinked) { reasons.push("No customer is linked to the inquiry; the quotation will have no customer."); actions.push("Link the correct customer record to the inquiry."); }
  if (input.quantityStated === false) { reasons.push("Quantity was not stated in the inquiry; the preview uses 1."); actions.push("Confirm the quantity with the customer before approval."); }
  if ((input.taxRate ?? 0) === 0) { reasons.push("Recorded tax rate is 0%; confirm no tax applies."); actions.push("Confirm the tax treatment or record the product tax rate."); }
  return { verdict: reasons.length ? "WARNING" : "PASS", reasons: reasons.length ? reasons : ["Price, tax, quantity, and currency all come from organization records."], actions };
}

const ROUTES: Array<{ agent: string; keywords: string[] }> = [
  { agent: "sales", keywords: ["customer", "inquiry", "inquiries", "lead", "opportunit", "follow-up", "follow up"] },
  { agent: "finance", keywords: ["quotation", "quote", "price", "pricing", "tax", "payment", "invoice"] },
  { agent: "operations", keywords: ["product", "stock", "supplier", "purchas", "inventory"] },
  { agent: "quality", keywords: ["check", "validate", "verify", "review proposal"] },
  { agent: "admin", keywords: ["settings", "setting", "integration", "user", "permission", "workspace"] },
  { agent: "marketing", keywords: ["marketing", "post", "campaign", "promotion"] },
  { agent: "writer", keywords: ["email", "write", "draft", "letter", "proposal document"] },
  { agent: "reporter", keywords: ["report", "summary", "metric", "overdue", "analytics", "how many"] },
  { agent: "worker", keywords: ["task", "todo", "complete", "update record"] },
];

/** Deterministic orchestrator routing. No model is required and nothing is invented. */
export function planAgents(prompt: string, selectedAgent: string): string[] {
  if (selectedAgent && selectedAgent !== "auto" && selectedAgent !== "orchestrator") return [selectedAgent];
  const text = prompt.toLowerCase();
  if (text.includes("pending inquiries") || (text.includes("inquiries") && text.includes("quotation")) || text.includes("proposals for approval")) {
    return ["sales", "operations", "finance", "quality", "reporter"];
  }
  const matched = ROUTES.filter((route) => route.keywords.some((keyword) => text.includes(keyword))).map((route) => route.agent);
  return matched.length ? [...new Set(matched)] : ["reporter"];
}
