import { getAgent, planAgents } from "./agents";
import { executeTool, type ToolContext, type ToolResult } from "./agent-tools";
import { saveRun, type AgentRun, type ApprovalProposal, newId } from "./agent-store";
import { formatMoney } from "./org-settings";
import { buildQuotationReview, decomposeRequest, synthesizeReviewResponse, type CustomerRecord, type InquiryRecord, type PlanTaskStatus, type ProductRecord } from "./orchestration";

export function isDemoRequest(prompt: string): boolean {
  const text = prompt.toLowerCase();
  return text.includes("pending inquiries") || (text.includes("inquiries") && text.includes("quotation"));
}

function step(run: AgentRun, agent: string, detail: string, status = "completed", tool?: string) {
  run.steps.push({ agent, tool, status, detail, at: new Date().toISOString() });
  saveRun(run);
}

function setTask(run: AgentRun, id: string, status: PlanTaskStatus, detail?: string) {
  const task = run.tasks?.find((item) => item.id === id);
  if (task) { task.status = status; if (detail) task.detail = detail; }
  saveRun(run);
}

function blockRemaining(run: AgentRun, fromIndex: number, reason: string) {
  for (const task of (run.tasks ?? []).slice(fromIndex)) {
    if (task.status === "pending") { task.status = "blocked"; task.detail = reason; }
  }
}

export type ToolExecutor = (ctx: ToolContext, toolId: string, args: Record<string, unknown>, approved?: boolean) => Promise<ToolResult & { requiresApproval?: boolean }>;

/** Multi-step quotation-review orchestration. Tools run sequentially in plan order; nothing is persisted until human approval. */
export async function runQuotationPipeline(ctx: ToolContext, run: AgentRun, executor: ToolExecutor = executeTool): Promise<AgentRun> {
  if (!run.tasks?.length) run.tasks = decomposeRequest(run.prompt, "auto").tasks;

  setTask(run, "retrieve-inquiries", "running");
  const sales = await executor(ctx, "inquiries.search", { query: "", status: "" });
  const rawInquiries = sales.ok ? ((sales.data ?? []) as InquiryRecord[]) : [];
  const inquiries = rawInquiries.filter((item) => ["new", "processing", "proposal"].includes(item.status)).slice(0, 5);
  if (!sales.ok) {
    setTask(run, "retrieve-inquiries", "failed", sales.summary);
    blockRemaining(run, 1, "Blocked: pending inquiries could not be retrieved.");
    run.status = "failed"; run.error = sales.error;
    run.result = `The review stopped at step 1 (retrieve pending inquiries): ${sales.summary} Matching, quotation previews, quality checks, and the approval review remain incomplete. Nothing was prepared or saved.`;
    saveRun(run); return run;
  }
  setTask(run, "retrieve-inquiries", "completed", `${inquiries.length} pending inquiries retrieved.`);
  step(run, "sales", `Retrieved ${inquiries.length} pending inquiries.`, "completed", "inquiries.search");
  if (!inquiries.length) {
    blockRemaining(run, 1, "Skipped: no pending inquiries to review.");
    run.status = "completed";
    run.result = "No pending inquiries (new, processing, or proposal) were found, so there was nothing to match, price, or check. Nothing was prepared and nothing was invented.";
    saveRun(run); return run;
  }

  setTask(run, "resolve-customers", "running");
  const customersResult = await executor(ctx, "customers.search", { query: "" });
  const customers = customersResult.ok ? ((customersResult.data ?? []) as CustomerRecord[]) : [];
  setTask(run, "resolve-customers", customersResult.ok ? "completed" : "failed", customersResult.ok ? `${customers.length} customer records available for linking.` : `Customer lookup failed: ${customersResult.summary} Customer names may be missing below.`);
  if (customersResult.ok) step(run, "sales", `Resolved customers against ${customers.length} records.`, "completed", "customers.search");

  setTask(run, "retrieve-products", "running");
  const productsResult = await executor(ctx, "products.search", { query: "" });
  if (!productsResult.ok) {
    setTask(run, "retrieve-products", "failed", productsResult.summary);
    blockRemaining(run, 3, "Blocked: the active product catalog could not be retrieved.");
    run.status = "failed"; run.error = productsResult.error;
    run.result = `The review stopped at step 3 (retrieve active products): ${productsResult.summary} ${inquiries.length} pending inquiries were retrieved, but matching, quotation previews, and quality checks remain incomplete. Nothing was prepared or saved.`;
    saveRun(run); return run;
  }
  const products = (productsResult.data ?? []) as ProductRecord[];
  setTask(run, "retrieve-products", "completed", `${products.length} active products retrieved.`);
  step(run, "operations", `Retrieved ${products.length} active products with recorded pricing, tax, and stock.`, "completed", "products.search");

  setTask(run, "match-products", "running");
  const review = buildQuotationReview({ inquiries, products, customers, currency: ctx.currency });
  run.review = review;
  setTask(run, "match-products", "completed", `${review.readyCount + review.blockedCount} matched, ${review.clarificationCount} need clarification.`);
  step(run, "operations", `Matched inquiries against the catalog: ${review.readyCount + review.blockedCount} matched, ${review.clarificationCount} ambiguous or unmatched. No product was assumed.`, "completed");
  setTask(run, "prepare-previews", "completed", `${review.previews.length} quotation previews calculated from recorded prices and tax rates.`);
  step(run, "finance", `Prepared ${review.previews.length} quotation previews. Totals use recorded unit prices and tax rates.`, "completed");
  setTask(run, "quality-check", "completed", `Quality: ${review.passCount} PASS, ${review.warningCount} WARNING, ${review.failCount} FAIL.`);
  step(run, "quality", `Quality Checker: ${review.passCount} PASS, ${review.warningCount} WARNING, ${review.failCount} FAIL. Failures are blocked from approval.`, "completed");

  const proposedInquiries = new Set(run.approvals.map((item) => String(item.args.inquiry_id)));
  for (const preview of review.previews) {
    if (proposedInquiries.has(preview.inquiryId)) continue;
    proposedInquiries.add(preview.inquiryId);
    const inquiry = inquiries.find((item) => item.id === preview.inquiryId);
    const check = review.quality.find((item) => item.inquiryId === preview.inquiryId)?.check;
    run.approvals.push({
      id: newId(), agent: "finance", tool: "quotations.create", status: "pending",
      title: `Draft quotation for inquiry: ${(inquiry?.content ?? "").slice(0, 70)}`,
      affected: `Inquiry ${preview.inquiryId.slice(0, 8)}… · ${preview.productName} (${preview.sku}) x${preview.quantity} @ ${formatMoney(preview.unitPrice, ctx.currency)} · Quality: ${check?.verdict ?? "WARNING"}`,
      financialImpact: `${formatMoney(preview.total, ctx.currency)} (subtotal ${formatMoney(preview.subtotal, ctx.currency)} + tax ${formatMoney(preview.taxTotal, ctx.currency)} at ${preview.taxRate}%). The database recalculates on save.`,
      args: { inquiry_id: preview.inquiryId, customer_id: inquiry?.customer_id ?? "", product_id: products.find((p) => p.sku === preview.sku)?.id ?? "", quantity: preview.quantity },
    });
  }
  setTask(run, "present-review", "completed", `${run.approvals.length} proposals presented for approval.`);
  run.status = run.approvals.length ? "awaiting_approval" : "completed";
  run.result = synthesizeReviewResponse(review);
  step(run, "reporter", run.result, "completed");
  saveRun(run);
  return run;
}

/** Executes one approved proposal: create draft + line (database recalculates totals). */
export async function approveProposal(ctx: ToolContext, run: AgentRun, proposal: ApprovalProposal): Promise<AgentRun> {
  if (proposal.status !== "pending") return run;
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
  const plan = decomposeRequest(prompt, selectedAgent);
  const run: AgentRun = { id: newId(), orgId: ctx.orgId, userEmail: ctx.userEmail, userId: ctx.userId, prompt, agents, provider: "Deterministic business tools (no model call — not Meta AI analysis)", status: "running", steps: [], approvals: [], result: "", createdAt: new Date().toISOString(), tasks: plan.tasks };
  step(run, "orchestrator", `Plan: ${plan.tasks.map((task) => task.title).join(" -> ")}`, "planning");
  saveRun(run);
  try {
    if (plan.kind === "quotation_review") return await runQuotationPipeline(ctx, run);
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
    const task = run.tasks?.find((item) => item.id === "specialist-task");
    if (task) { task.status = run.result ? "completed" : "failed"; task.detail = run.result.slice(0, 160); }
    run.status = run.result ? "completed" : "failed";
  } catch (error) {
    run.status = "failed";
    run.error = error instanceof Error ? error.message : "Agent execution failed.";
    run.result = `Execution failed: ${run.error}`;
  }
  saveRun(run);
  return run;
}
