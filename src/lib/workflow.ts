import { supabase } from "./supabase";

export class WorkflowRequestError extends Error {
  readonly requestId?: string;
  readonly status?: number;

  constructor(message: string, details: { requestId?: string; status?: number } = {}) {
    super(message);
    this.name = "WorkflowRequestError";
    this.requestId = details.requestId;
    this.status = details.status;
  }
}

export type InquiryWorkflowInput = {
  inquiry: string;
  customerName: string;
  customerEmail?: string;
  productQuery: string;
  quantity: number;
  additionalRequirements?: string;
};

export type WorkflowProposal = {
  status: string;
  request_id?: string;
  workflow_run_id?: string;
  analysis_source?: "meta" | "not_configured";
  analysis?: {
    summary: string;
    customer_intent: string;
    business_category: string;
    product_requirements: Array<{ product_query: string; quantity: number; unit: string; constraints: string[] }>;
    important_constraints: string[];
    missing_information: string[];
    suggested_next_action: string;
  };
  proposal?: {
    ai_analysis: WorkflowProposal["analysis"];
    customer: { name: string; email?: string | null };
    product: { sku: string; name: string; unit_price: number; tax_rate: number; recorded_stock: number };
    quantity: number;
    currency: string;
    quotation_preview: { subtotal: number; tax_total: number; total: number; authoritative: string };
    suggested_opportunity?: { title: string; estimated_value: number };
    suggested_follow_up?: { title: string; due_in_days: number };
    missing_information: string[];
    requires_human_approval: boolean;
  };
  missing_information?: string[];
  usage?: { status?: string; budget_guarded?: boolean; actual_cost_usd?: number } | null;
  model_routing?: { requested_capability?: string; routing_mode?: string; selected_model?: string; actual_model?: string; fallback_from?: string | null; latency_ms?: number } | null;
  quotation_id?: string;
  opportunity_id?: string | null;
  task_id?: string | null;
  subtotal?: number;
  tax_total?: number;
  total?: number;
};

export async function proposeInquiryWorkflow(input: InquiryWorkflowInput) {
  if (!supabase) throw new Error("Connect Supabase before running the server-side workflow.");
  const { data, error } = await supabase.functions.invoke("inquiry-workflow", { body: input });
  if (error) throw await toWorkflowRequestError(error, "Inquiry workflow could not be completed.");
  return data as WorkflowProposal;
}

export async function approveInquiryWorkflow(workflowRunId: string) {
  if (!supabase) throw new Error("Connect Supabase before running the server-side workflow.");
  const { data, error } = await supabase.functions.invoke("approve-inquiry-workflow", { body: { workflow_run_id: workflowRunId } });
  if (error) throw await toWorkflowRequestError(error, "Workflow approval could not be completed.");
  return data as WorkflowProposal;
}

export type DemoWorkspaceResult = {
  status: string;
  organization_id: string;
  demo_version: string;
  counts: { customers: number; products: number; inquiries: number; quotations: number; opportunities: number; tasks: number };
  note: string;
};

export async function loadDemoWorkspace() {
  if (!supabase) throw new Error("Connect Supabase before loading the demo workspace.");
  const { data, error } = await supabase.functions.invoke("seed-demo-workspace", { body: {} });
  if (error) throw await toWorkflowRequestError(error, "Demo workspace could not be loaded.");
  return data as DemoWorkspaceResult;
}

async function toWorkflowRequestError(error: unknown, fallback: string): Promise<WorkflowRequestError> {
  const fallbackError = error instanceof Error ? error.message : fallback;
  const response = typeof error === "object" && error !== null && "context" in error
    ? (error as { context?: Response }).context
    : undefined;
  if (!response || typeof response.json !== "function") return new WorkflowRequestError(fallbackError);
  try {
    const body = await response.clone().json() as { error?: unknown; detail?: unknown; request_id?: unknown };
    const message = [body.error, body.detail].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ") || fallbackError;
    return new WorkflowRequestError(message, {
      requestId: typeof body.request_id === "string" ? body.request_id : undefined,
      status: response.status,
    });
  } catch {
    return new WorkflowRequestError(fallbackError, { status: response.status });
  }
}
