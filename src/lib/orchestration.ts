import { checkQuotationProposal, type QualityVerdict } from "./agents";
import { calculateQuote } from "./quote";

export type PlanTaskStatus = "pending" | "running" | "completed" | "blocked" | "failed";
export type PlanTask = { id: string; agent: string; tool?: string; title: string; status: PlanTaskStatus; detail?: string };
export type InquiryRecord = { id: string; content: string; status: string; customer_id: string | null };
export type ProductRecord = { id: string; name: string; sku: string; unit_price: number; tax_rate: number; stock_qty: number };
export type CustomerRecord = { id: string; name: string };

export type MatchOutcome = {
  status: "matched" | "ambiguous" | "unmatched";
  product: ProductRecord | null;
  candidates: ProductRecord[];
  evidence: string[];
  quantity: number;
  quantityStated: boolean;
  quantityEvidence: string | null;
};

export type InquiryReview = {
  inquiryId: string;
  summary: string;
  customerName: string | null;
  match: MatchOutcome;
  missingInformation: string[];
  outcome: "ready" | "clarification" | "blocked";
};

export type QuotationPreview = {
  inquiryId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  stockQty: number;
  currency: string;
};

export type QuotationReview = {
  totalPending: number;
  totalProducts: number;
  inquiries: InquiryReview[];
  previews: QuotationPreview[];
  quality: Array<{ inquiryId: string; check: QualityVerdict }>;
  readyCount: number;
  clarificationCount: number;
  blockedCount: number;
  passCount: number;
  warningCount: number;
  failCount: number;
};

const WORKFLOW_TASKS: Array<Omit<PlanTask, "status">> = [
  { id: "retrieve-inquiries", agent: "sales", tool: "inquiries.search", title: "Retrieve pending inquiries for the active organization" },
  { id: "resolve-customers", agent: "sales", tool: "customers.search", title: "Resolve the customer linked to each inquiry" },
  { id: "retrieve-products", agent: "operations", tool: "products.search", title: "Retrieve active products with pricing, tax, and stock" },
  { id: "match-products", agent: "operations", title: "Match each inquiry against the product catalog (deterministic)" },
  { id: "prepare-previews", agent: "finance", title: "Prepare quotation previews from recorded prices and tax" },
  { id: "quality-check", agent: "quality", title: "Run the Quality Checker against each proposal" },
  { id: "present-review", agent: "reporter", title: "Present the consolidated review for human approval" },
];

/** Deterministic decomposition. A multi-operation quotation-review request becomes a tracked plan; anything else stays a single specialist task. */
export function decomposeRequest(prompt: string, selectedAgent: string): { kind: "quotation_review" | "specialist"; agents: string[]; tasks: PlanTask[] } {
  const text = prompt.toLowerCase();
  const workflowSignals = ["pending inquiries", "proposals for approval", "for approval"].filter((signal) => text.includes(signal)).length;
  const isWorkflow = (selectedAgent === "auto" || selectedAgent === "orchestrator")
    && (text.includes("pending inquiries") || (text.includes("inquiries") && text.includes("quotation")) || workflowSignals > 0);
  if (isWorkflow) {
    return { kind: "quotation_review", agents: ["sales", "operations", "finance", "quality", "reporter"], tasks: WORKFLOW_TASKS.map((task) => ({ ...task, status: "pending" as PlanTaskStatus })) };
  }
  const agent = selectedAgent && selectedAgent !== "auto" && selectedAgent !== "orchestrator" ? selectedAgent : "reporter";
  return { kind: "specialist", agents: [agent], tasks: [{ id: "specialist-task", agent, title: "Run the requested specialist task", status: "pending" }] };
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };

export function extractQuantity(content: string): { quantity: number; stated: boolean; evidence: string | null } {
  const digit = content.match(/\b(\d{1,4})\s*(?:x|units?|licenses?|licences?|items?|pcs|pieces)?\b/i);
  if (digit) return { quantity: Number(digit[1]), stated: true, evidence: digit[0] };
  const words = content.toLowerCase().split(/[^a-z]+/);
  for (const word of words) {
    if (NUMBER_WORDS[word]) return { quantity: NUMBER_WORDS[word], stated: true, evidence: word };
  }
  return { quantity: 1, stated: false, evidence: null };
}

function tokens(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3))];
}

/** Deterministic token-evidence matching. Never falls back to an arbitrary product: no unique winner means clarification. */
export function matchInquiryToProducts(inquiry: InquiryRecord, products: ProductRecord[]): MatchOutcome {
  const quantity = extractQuantity(inquiry.content);
  const text = inquiry.content.toLowerCase();
  const scored = products.map((product) => {
    const nameTokens = tokens(`${product.name} ${product.sku}`);
    const evidence = nameTokens.filter((token) => new RegExp(`\\b${token}\\b`).test(text));
    const fullName = text.includes(product.name.toLowerCase()) ? 2 : 0;
    return { product, evidence, score: evidence.length + fullName };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { status: "unmatched", product: null, candidates: [], evidence: [], quantity: quantity.quantity, quantityStated: quantity.stated, quantityEvidence: quantity.evidence };
  const top = scored[0];
  const tied = scored.filter((entry) => entry.score === top.score);
  if (tied.length > 1) return { status: "ambiguous", product: null, candidates: tied.map((entry) => entry.product), evidence: top.evidence, quantity: quantity.quantity, quantityStated: quantity.stated, quantityEvidence: quantity.evidence };
  return { status: "matched", product: top.product, candidates: [top.product], evidence: top.evidence, quantity: quantity.quantity, quantityStated: quantity.stated, quantityEvidence: quantity.evidence };
}

/** Pure review builder: matching, deterministic pricing, Quality Checker, and outcome counts. Creates no approvals and writes nothing. */
export function buildQuotationReview(input: { inquiries: InquiryRecord[]; products: ProductRecord[]; customers: CustomerRecord[]; currency: string }): QuotationReview {
  const customersById = new Map(input.customers.map((customer) => [customer.id, customer.name]));
  const seen = new Set<string>();
  const inquiries: InquiryReview[] = [];
  const previews: QuotationPreview[] = [];
  const quality: QuotationReview["quality"] = [];
  let pass = 0, warn = 0, fail = 0;
  for (const inquiry of input.inquiries) {
    if (seen.has(inquiry.id)) continue;
    seen.add(inquiry.id);
    const match = matchInquiryToProducts(inquiry, input.products);
    const customerName = inquiry.customer_id ? (customersById.get(inquiry.customer_id) ?? null) : null;
    const missing: string[] = [];
    if (!inquiry.customer_id) missing.push("No customer is linked to this inquiry.");
    if (match.status === "unmatched") missing.push("No active product matches this inquiry. Name the product or add its product record.");
    if (match.status === "ambiguous") missing.push(`Several products match (${match.candidates.map((c) => `${c.name} (${c.sku})`).join("; ")}). Narrow the inquiry to exactly one product.`);
    if (match.status === "matched" && !match.quantityStated) missing.push("Quantity was not stated; the preview uses 1. Confirm the quantity before approval.");
    let outcome: InquiryReview["outcome"] = match.status === "matched" ? "ready" : "clarification";
    if (match.status === "matched" && match.product) {
      const product = match.product;
      const check = checkQuotationProposal({ productName: product.name, unitPrice: Number(product.unit_price), taxRate: Number(product.tax_rate), quantity: match.quantity, currency: input.currency, customerLinked: Boolean(inquiry.customer_id), stockQty: Number(product.stock_qty), quantityStated: match.quantityStated });
      quality.push({ inquiryId: inquiry.id, check });
      if (check.verdict === "PASS") pass += 1; else if (check.verdict === "WARNING") warn += 1; else fail += 1;
      if (check.verdict === "FAIL") { outcome = "blocked"; missing.push(...check.reasons); }
      else {
        const totals = calculateQuote(Number(product.unit_price), Number(product.tax_rate), match.quantity);
        previews.push({ inquiryId: inquiry.id, productName: product.name, sku: product.sku, quantity: match.quantity, unitPrice: Number(product.unit_price), taxRate: Number(product.tax_rate), subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total, stockQty: Number(product.stock_qty), currency: input.currency });
      }
    }
    inquiries.push({ inquiryId: inquiry.id, summary: inquiry.content.slice(0, 140), customerName, match, missingInformation: missing, outcome });
  }
  return {
    totalPending: inquiries.length,
    totalProducts: input.products.length,
    inquiries, previews, quality,
    readyCount: inquiries.filter((item) => item.outcome === "ready").length,
    clarificationCount: inquiries.filter((item) => item.outcome === "clarification").length,
    blockedCount: inquiries.filter((item) => item.outcome === "blocked").length,
    passCount: pass, warningCount: warn, failCount: fail,
  };
}

/** One synthesized business response built only from actual review results. */
export function synthesizeReviewResponse(review: QuotationReview): string {
  const failedNote = review.failCount ? ` ${review.failCount} proposal(s) failed quality checks and are blocked.` : "";
  const lines = [
    `I reviewed ${review.totalPending} pending ${review.totalPending === 1 ? "inquiry" : "inquiries"} against your ${review.totalProducts} active ${review.totalProducts === 1 ? "product" : "products"}.`,
    `${review.readyCount} ${review.readyCount === 1 ? "inquiry has" : "inquiries have"} a sufficiently evidenced product match, ${review.clarificationCount} need clarification, and ${review.blockedCount} are blocked.`,
    review.previews.length ? `I prepared ${review.previews.length} quotation ${review.previews.length === 1 ? "preview" : "previews"} using recorded prices and tax rates (Quality: ${review.passCount} PASS, ${review.warningCount} WARNING, ${review.failCount} FAIL).${failedNote}` : "No quotation previews could be prepared from the available matches.",
    review.previews.length ? "All previews are awaiting your review below. No quotation has been approved or sent." : "Nothing has been approved or sent.",
    review.readyCount ? "Next action: review each proposal and approve or reject it." : review.clarificationCount ? "Next action: clarify the flagged inquiries, then re-run the review." : "Next action: resolve the blocked items, then re-run the review.",
  ];
  return lines.join(" ");
}
