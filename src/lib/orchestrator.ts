import { checkQuotationProposal, getAgent, planAgents } from "./agents";
import { executeTool, type ToolContext, type ToolResult } from "./agent-tools";
import { saveRun, type AgentRun, type ApprovalProposal, newId } from "./agent-store";
import { formatMoney } from "./org-settings";

type Inquiry = { id: string; content: string; status: string; customer_id: string | null };
type Product = { id: string; name: string; sku: string; unit_price: number; tax_rate: number; stock_qty: number };

export function isDemoRequest(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return text.includes("pending inquiries") || (text.includes("inquiries") && text.includes("quotation"));
}

function step(run: AgentRun, agent: string, detail: string, status = "completed", tool?: string) {
  run.steps.push({ agent, tool, status, detail, at: new Date().toISOString() });
  saveRun(run);
}

/** Sales -> Operations -> Finance -> Quality pipeline. Persists nothing until approval. */
export async function runQuotationPipeline(ctx: ToolContext, run: AgentRun): Promise<AgentRun> {
  const sales = await executeTool(ctx, "inquiries.search", { query: "", status: "" });
  step(run, "sales", sales.summary, sales.ok ? "completed" : "failed", "inquiries.search");
  if (!sales.ok) { run.status = "failed"; run.error = sales.error; run.result = `Sales Agent failed: ${sales.summary}`; saveRun(run); return run; }
  const inquiries = ((sales.data ?? []) as Inquiry[]).filter((item) => ["new", "processing", "proposal"].includes(item.status)).slice(0, 5);
  if (!inquiries.length) { run.result = "No pending inquiries (new, processing, or proposal) were found. Nothing was prepared and nothing was invented."; run.status = "completed"; step(run, "reporter", `${run.result} Operations, Finance, Quality, and Reporter steps were skipped because there was nothing to review.`); saveRun(run); return run; }

  const productsResult = await executeTool(ctx, "products.search", { query: "" });
  step(run, "operations", productsResult.summary, productsResult.ok ? "completed" : "failed", "products.search");
  if (!productsResult.ok) { run.status = "failed"; run.error = productsResult.error; run.result = `Operations Agent failed: ${productsResult.summary}`; saveRun(run); return run; }
  const products = (productsResult.data ?? []) as Product[];

  let pass = 0, warn = 0, fail = 0;
  for (const inquiry of inquiries) {
    const tokens = inquiry.content.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3);
    const product = products.find((candidate) => tokens.some((token) => candidate.name.toLowerCase().includes(token) || candidate.sku.toLowerCase().includes(token))) ?? products[0];
    const quantity = 1;
    const quality = checkQuotationProposal({ productName: product?.name ?? null, unitPrice: product ? Number(product.unit_price) : null, taxRate: product ? Number(product.tax_rate) : null, quantity, currency: ctx.currency, customerLinked: Boolean(inquiry.customer_id) });
    if (quality.verdict === "PASS") pass += 1; else if (quality.verdict === "WARNING") warn += 1; else fail += 1;
    step(run, "quality", `${quality.verdict}: ${quality.reasons.join(" ")}`, quality.verdict === "FAIL" ? "failed" : "completed");
    if (!product || quality.verdict === "FAIL") continue;
    const total = Math.round((Number(product.unit_price) * quantity * (1 + Number(product.tax_rate) / 100)) * 100) / 100;
    run.approvals.push({
      id: newId(), agent: "finance", tool: "quotations.create", status: "pending",
      title: `Draft quotation for inquiry: ${inquiry.content.slice(0, 70)}`,
      affected: `Inquiry ${inquiry.id.slice(0, 8)}… · ${product.name} (${product.sku}) x${quantity} @ ${formatMoney(Number(product.unit_price), ctx.currency)} · Quality: ${quality.verdict}`,
      financialImpact: `${formatMoney(total, ctx.currency)} at recorded price and ${Number(product.tax_rate)}% tax. The database recalculates on save.`,
      args: { inquiry_id: inquiry.id, customer_id: inquiry.customer_id ?? "", product_id: product.id, quantity },
    });
  }
  run.status = run.approvals.length ? "awaiting_approval" : "completed";
  run.result = `Reviewed ${inquiries.length} pending inquiry(ies) against ${products.length} active product(s). Quality: ${pass} PASS, ${warn} WARNING, ${fail} FAIL. ${run.approvals.length} quotation proposal(s) await your approval below; nothing has been saved yet.`;
  step(run, "reporter", run.result);
  saveRun(run);
  return run;
}

/** Executes one approved proposal: create draft + line (database recalculates totals). */
export async function approveProposal(ctx: ToolContext, run: AgentRun, proposal: ApprovalProposal): Promise<AgentRun> {
  const created = await executeTool(ctx, "quotations.create", proposal.args, true);
  if (!created.ok) { proposal.result = created.summary; run.error = created.summary; saveRun(run); return run; }
  const quotationId = (created.data as { id: string }).id;
  const line = await executeTool(ctx, "quotations.add_line", { quotation_id: quotationId, product_id: String(proposal.args.product_id ?? ""), quantity: Number(proposal.args.quantity ?? 1) }, true);
  proposal.status = "approved";
  proposal.result = line.ok ? `Quotation ${quotationId.slice(0, 8)}… created as a draft with its product line.` : `Quotation created, but the line failed: ${line.summary}`;
  step(run, "finance", proposal.result, line.ok ? "completed" : "failed", "quotations.add_line");
  run.status = run.approvals.some((item) => item.status === "pending") ? "awaiting_approval" : "completed";
  saveRun(run);
  return run;
}

export async function runAgentRequest(ctx: ToolContext & { userEmail: string; userId?: string }, prompt: string, selectedAgent: string): Promise<AgentRun> {
  const agents = planAgents(prompt, selectedAgent);
  const run: AgentRun = { id: newId(), orgId: ctx.orgId, userEmail: ctx.userEmail, userId: ctx.userId, prompt, agents, provider: "Deterministic business tools (no model call — not Meta AI analysis)", status: "running", steps: [], approvals: [], result: "", createdAt: new Date().toISOString() };
  step(run, "orchestrator", `Plan: ${agents.map((id) => getAgent(id).name).join(" -> ")}`, "planning");
  saveRun(run);
  try {
    if (selectedAgent === "auto" || selectedAgent === "orchestrator" ? isDemoRequest(prompt) : false) return await runQuotationPipeline(ctx, run);
    // Direct specialist execution over real tools.
    const primary = agents[0];
    if (primary === "reporter" || primary === "admin") {
      const summary: ToolResult = await executeTool(ctx, "reports.get_summary", {});
      step(run, primary, summary.summary, summary.ok ? "completed" : "failed", "reports.get_summary");
      const settings = primary === "admin" ? await executeTool(ctx, "organization.get_settings", {}) : null;
      if (settings) step(run, "admin", settings.summary, settings.ok ? "completed" : "failed", "organization.get_settings");
      run.result = summary.ok ? `${getAgent(primary).name}: ${summary.summary}${settings ? ` Settings: ${settings.summary}` : ""}` : summary.summary;
    } else if (primary === "writer" || primary === "marketing") {
      const source: ToolResult = await executeTool(ctx, primary === "writer" ? "inquiries.search" : "products.search", { query: "" });
      step(run, primary, source.summary, source.ok ? "completed" : "failed");
      const rows = (source.data ?? []) as Array<Record<string, unknown>>;
      run.result = source.ok ? (rows.length ? `Draft (not sent): Based on ${rows.length} real record(s), the first is “${String(rows[0].name ?? rows[0].content ?? "").slice(0, 120)}”. Ask with a customer or product name to draft against a specific record.` : "No records were found to draft from, so no draft was invented.") : source.summary;
    } else {
      const toolByAgent: Record<string, string> = { sales: "inquiries.search", operations: "products.search", finance: "products.search", quality: "reports.get_summary", worker: "reports.get_summary" };
      const tool = toolByAgent[primary] ?? "reports.get_summary";
      const result: ToolResult = await executeTool(ctx, tool, { query: "" });
      step(run, primary, result.summary, result.ok ? "completed" : "failed", tool);
      run.result = result.ok ? `${getAgent(primary).name}: ${result.summary}` : result.summary;
    }
    run.status = run.result ? "completed" : "failed";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Agent execution failed.";
    run.result = `Execution failed: ${run.error}`;
  }
  saveRun(run);
  return run;
}
