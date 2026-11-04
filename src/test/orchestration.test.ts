import { describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
vi.stubGlobal("window", { dispatchEvent: () => true });
vi.stubGlobal("CustomEvent", class { constructor(public type: string) { void this.type; } });

import { buildQuotationReview, decomposeRequest, extractQuantity, matchInquiryToProducts, synthesizeReviewResponse, type CustomerRecord, type InquiryRecord, type ProductRecord } from "../lib/orchestration";
import { approveProposal, runQuotationPipeline, type ToolExecutor } from "../lib/orchestrator";
import type { AgentRun } from "../lib/agent-store";
import type { ToolContext } from "../lib/agent-tools";

const EXAMPLE = "Review pending inquiries, identify relevant products, prepare quotations, check the calculations and show me the proposals for approval.";
const ctx: ToolContext = { orgId: "org-1", role: "owner", currency: "BDT" };

const demoProducts: ProductRecord[] = [
  { id: "p1", sku: "DEMO-APX-001", name: "Apex Business Starter", unit_price: 12500, tax_rate: 0, stock_qty: 42 },
  { id: "p2", sku: "DEMO-APX-002", name: "Apex Operations Suite", unit_price: 28000, tax_rate: 0, stock_qty: 18 },
  { id: "p3", sku: "DEMO-APX-003", name: "Apex Finance Controls", unit_price: 7500, tax_rate: 0, stock_qty: 65 },
  { id: "p4", sku: "DEMO-APX-004", name: "Apex Inventory Pack", unit_price: 18500, tax_rate: 0, stock_qty: 27 },
  { id: "p5", sku: "DEMO-APX-005", name: "Apex CRM Enablement", unit_price: 22000, tax_rate: 0, stock_qty: 31 },
  { id: "p6", sku: "DEMO-APX-006", name: "Apex Reporting Pack", unit_price: 14500, tax_rate: 0, stock_qty: 24 },
  { id: "p7", sku: "DEMO-APX-007", name: "Apex Workflow Credits", unit_price: 9500, tax_rate: 0, stock_qty: 90 },
  { id: "p8", sku: "DEMO-APX-008", name: "Apex Support Retainer", unit_price: 35000, tax_rate: 0, stock_qty: 12 },
];
const demoCustomers: CustomerRecord[] = [
  { id: "c1", name: "Apex Demo · Rahim Trading" }, { id: "c2", name: "Apex Demo · Nusrat Enterprise" },
  { id: "c3", name: "Apex Demo · Delta Workshop" }, { id: "c4", name: "Apex Demo · Greenfield Foods" },
  { id: "c5", name: "Apex Demo · Northstar Logistics" },
];
const demoInquiries: InquiryRecord[] = [
  { id: "i1", content: "APEX_DEMO_V1: Rahim Trading requests two Apex Operations Suite licenses and availability confirmation.", status: "new", customer_id: "c1" },
  { id: "i2", content: "APEX_DEMO_V1: Nusrat Enterprise asks for a Finance Controls proposal for its monthly close process.", status: "new", customer_id: "c2" },
  { id: "i3", content: "APEX_DEMO_V1: Delta Workshop requests an Inventory Pack quotation for its service team.", status: "new", customer_id: "c3" },
  { id: "i4", content: "APEX_DEMO_V1: Greenfield Foods asks about CRM Enablement and implementation timing.", status: "new", customer_id: "c4" },
  { id: "i5", content: "APEX_DEMO_V1: Northstar Logistics requests a Reporting Pack follow-up call.", status: "new", customer_id: "c5" },
];

function fakeExecutor(data: { inquiries?: InquiryRecord[]; customers?: CustomerRecord[]; products?: ProductRecord[] }, failures = new Set<string>(), calls: string[] = [], contexts: ToolContext[] = []): ToolExecutor {
  return async (callCtx, toolId) => {
    calls.push(toolId); contexts.push(callCtx);
    if (failures.has(toolId)) return { tool: toolId, ok: false, summary: `${toolId} exploded`, error: "boom" };
    const map: Record<string, unknown> = { "inquiries.search": data.inquiries ?? [], "customers.search": data.customers ?? [], "products.search": data.products ?? [] };
    return { tool: toolId, ok: true, summary: "ok", data: map[toolId] ?? [] };
  };
}

function newRun(prompt = EXAMPLE): AgentRun {
  return { id: `run-${Math.random()}`, orgId: ctx.orgId, userEmail: "owner@example.test", prompt, agents: [], provider: "test", status: "running", steps: [], approvals: [], result: "", createdAt: new Date().toISOString(), tasks: decomposeRequest(prompt, "auto").tasks };
}

describe("multi-step decomposition and routing", () => {
  it("decomposes the example request into the seven-step specialist plan in order", () => {
    const plan = decomposeRequest(EXAMPLE, "auto");
    expect(plan.kind).toBe("quotation_review");
    expect(plan.agents).toEqual(["sales", "operations", "finance", "quality", "reporter"]);
    expect(plan.tasks.map((task) => task.id)).toEqual(["retrieve-inquiries", "resolve-customers", "retrieve-products", "match-products", "prepare-previews", "quality-check", "present-review"]);
    expect(plan.tasks.map((task) => task.agent)).toEqual(["sales", "sales", "operations", "operations", "finance", "quality", "reporter"]);
    expect(plan.tasks.every((task) => task.status === "pending")).toBe(true);
  });

  it("keeps single-operation requests on one specialist instead of the full workflow", () => {
    const plan = decomposeRequest("How many customers do we have?", "auto");
    expect(plan.kind).toBe("specialist");
    expect(plan.tasks).toHaveLength(1);
    expect(decomposeRequest("anything", "finance").tasks[0].agent).toBe("finance");
  });

  it("extracts stated quantities and flags unstated ones", () => {
    expect(extractQuantity("requests two licenses")).toEqual({ quantity: 2, stated: true, evidence: "two" });
    expect(extractQuantity("needs 50 units")).toEqual({ quantity: 50, stated: true, evidence: "50 units" });
    expect(extractQuantity("asks about pricing")).toEqual({ quantity: 1, stated: false, evidence: null });
  });
});

describe("product matching safety", () => {
  it("matches uniquely on token evidence and never falls back to the first product", () => {
    const matched = matchInquiryToProducts(demoInquiries[0], demoProducts);
    expect(matched.status).toBe("matched");
    expect(matched.product?.sku).toBe("DEMO-APX-002");
    expect(matched.evidence).toContain("operations");
    const unmatched = matchInquiryToProducts({ id: "x", content: "We need helicopter rental for a day.", status: "new", customer_id: null }, demoProducts);
    expect(unmatched.status).toBe("unmatched");
    expect(unmatched.product).toBeNull();
  });

  it("requires clarification for ambiguous matches instead of picking one", () => {
    const ambiguous = matchInquiryToProducts({ id: "x", content: "Please quote an Apex product for us.", status: "new", customer_id: null }, demoProducts);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.candidates.length).toBeGreaterThan(1);
  });
});

describe("quotation review building", () => {
  it("calculates subtotal, tax, and total from recorded values only", () => {
    const products = [{ id: "p9", sku: "W-1", name: "Widget Pro", unit_price: 100, tax_rate: 10, stock_qty: 20 }];
    const review = buildQuotationReview({ inquiries: [{ id: "i9", content: "We need three Widget Pro units.", status: "new", customer_id: "c1" }], products, customers: demoCustomers, currency: "USD" });
    expect(review.previews).toHaveLength(1);
    expect(review.previews[0]).toMatchObject({ quantity: 3, unitPrice: 100, taxRate: 10, subtotal: 300, taxTotal: 30, total: 330, stockQty: 20 });
    expect(review.readyCount).toBe(1);
  });

  it("blocks insufficient stock with a corrective action and no preview", () => {
    const review = buildQuotationReview({ inquiries: [{ id: "i8", content: "We need 50 Apex Operations Suite units.", status: "new", customer_id: "c1" }], products: demoProducts, customers: demoCustomers, currency: "BDT" });
    expect(review.blockedCount).toBe(1);
    expect(review.previews).toHaveLength(0);
    const entry = review.quality[0];
    expect(entry.check.verdict).toBe("FAIL");
    expect(entry.check.reasons.join(" ")).toContain("Recorded stock is 18");
    expect(entry.check.actions.join(" ")).toContain("at most 18");
  });

  it("produces a consolidated response with real counts and no raw tool text", () => {
    const review = buildQuotationReview({ inquiries: demoInquiries, products: demoProducts, customers: demoCustomers, currency: "BDT" });
    const text = synthesizeReviewResponse(review);
    expect(text).toContain("I reviewed 5 pending inquiries against your 8 active products.");
    expect(text).toContain("No quotation has been approved or sent.");
    expect(text).not.toContain("Found 8 products record(s).");
  });
});

describe("pipeline execution control", () => {
  it("runs the exact example request against the demo workspace sequentially, once per tool", async () => {
    const calls: string[] = [];
    const run = await runQuotationPipeline(ctx, newRun(), fakeExecutor({ inquiries: demoInquiries, customers: demoCustomers, products: demoProducts }, new Set(), calls));
    expect(calls).toEqual(["inquiries.search", "customers.search", "products.search"]);
    expect(run.tasks?.every((task) => task.status === "completed")).toBe(true);
    expect(run.status).toBe("awaiting_approval");
    expect(run.approvals).toHaveLength(5);
    expect(run.approvals.every((item) => item.status === "pending")).toBe(true);
    expect(run.approvals[0].args).toMatchObject({ inquiry_id: "i1", product_id: "p2", quantity: 2 });
    expect(run.result).toContain("I reviewed 5 pending inquiries against your 8 active products.");
    expect(run.result).toContain("No quotation has been approved or sent.");
    expect(run.result).not.toContain("record(s)");
    expect(run.review?.readyCount).toBe(5);
  });

  it("does not duplicate proposals when the same inquiry appears twice", async () => {
    const duplicated = [...demoInquiries.slice(0, 2), demoInquiries[0]];
    const run = await runQuotationPipeline(ctx, newRun(), fakeExecutor({ inquiries: duplicated, customers: demoCustomers, products: demoProducts }));
    expect(run.review?.totalPending).toBe(2);
    expect(run.approvals.filter((item) => item.args.inquiry_id === "i1")).toHaveLength(1);
  });

  it("blocks later steps and explains the failure when product retrieval fails", async () => {
    const run = await runQuotationPipeline(ctx, newRun(), fakeExecutor({ inquiries: demoInquiries, customers: demoCustomers }, new Set(["products.search"])));
    expect(run.status).toBe("failed");
    expect(run.tasks?.find((task) => task.id === "retrieve-inquiries")?.status).toBe("completed");
    expect(run.tasks?.find((task) => task.id === "retrieve-products")?.status).toBe("failed");
    expect(run.tasks?.find((task) => task.id === "match-products")?.status).toBe("blocked");
    expect(run.result).toContain("step 3");
    expect(run.result).toContain("remain incomplete");
    expect(run.approvals).toHaveLength(0);
  });

  it("stops at step 1 when inquiry retrieval fails and creates nothing", async () => {
    const run = await runQuotationPipeline(ctx, newRun(), fakeExecutor({}, new Set(["inquiries.search"])));
    expect(run.status).toBe("failed");
    expect(run.tasks?.find((task) => task.id === "retrieve-inquiries")?.status).toBe("failed");
    expect(run.tasks?.find((task) => task.id === "present-review")?.status).toBe("blocked");
    expect(run.result).toContain("step 1");
  });

  it("keeps every tool call inside the caller's organization context", async () => {
    const contexts: ToolContext[] = [];
    const runA = await runQuotationPipeline({ ...ctx, orgId: "org-A" }, { ...newRun(), orgId: "org-A" }, fakeExecutor({ inquiries: demoInquiries, customers: demoCustomers, products: demoProducts }, new Set(), [], contexts));
    expect(contexts.every((callCtx) => callCtx.orgId === "org-A")).toBe(true);
    expect(runA.approvals.every((item) => demoProducts.some((p) => p.id === item.args.product_id))).toBe(true);
    const otherOrgReview = buildQuotationReview({ inquiries: demoInquiries, products: [{ id: "z1", sku: "Z-1", name: "Unrelated Gadget", unit_price: 5, tax_rate: 0, stock_qty: 3 }], customers: [], currency: "BDT" });
    expect(otherOrgReview.readyCount).toBe(0);
    expect(otherOrgReview.clarificationCount).toBe(5);
  });

  it("refuses to execute an approval twice", async () => {
    const run = newRun();
    run.approvals.push({ id: "a1", agent: "finance", tool: "quotations.create", title: "t", affected: "", args: { inquiry_id: "i1", product_id: "p2", quantity: 1 }, status: "approved", result: "already done" });
    const result = await approveProposal(ctx, run, run.approvals[0]);
    expect(result.approvals[0].result).toBe("already done");
  });
});
