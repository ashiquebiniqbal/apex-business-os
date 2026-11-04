export const inquiryAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    customer_intent: { type: "string" },
    business_category: { type: "string" },
    product_requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          product_query: { type: "string" },
          quantity: { type: "number" },
          unit: { type: "string" },
          constraints: { type: "array", items: { type: "string" } },
        },
        required: ["product_query", "quantity", "unit", "constraints"],
      },
    },
    important_constraints: { type: "array", items: { type: "string" } },
    missing_information: { type: "array", items: { type: "string" } },
    suggested_next_action: { type: "string", enum: ["lookup_context", "request_clarification", "prepare_proposal", "human_review"] },
  },
  required: ["summary", "customer_intent", "business_category", "product_requirements", "important_constraints", "missing_information", "suggested_next_action"],
} as const;

export type InquiryAnalysis = {
  summary: string;
  customer_intent: string;
  business_category: string;
  product_requirements: Array<{ product_query: string; quantity: number; unit: string; constraints: string[] }>;
  important_constraints: string[];
  missing_information: string[];
  suggested_next_action: "lookup_context" | "request_clarification" | "prepare_proposal" | "human_review";
};

export class InquirySchemaError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Meta analysis did not match the required schema: ${issues.join("; ")}`);
    this.name = "InquirySchemaError";
    this.issues = issues;
  }
}

export function validateInquiryAnalysis(value: unknown): InquiryAnalysis {
  const item = value as Partial<InquiryAnalysis> | null;
  const issues: string[] = [];
  if (!item || typeof item !== "object") throw new InquirySchemaError(["response was not an object"]);
  if (typeof item.summary !== "string") issues.push("summary must be a string");
  if (typeof item.customer_intent !== "string") issues.push("customer_intent must be a string");
  if (typeof item.business_category !== "string") issues.push("business_category must be a string");
  if (!Array.isArray(item.product_requirements)) issues.push("product_requirements must be an array");
  if (!Array.isArray(item.important_constraints)) issues.push("important_constraints must be an array");
  if (!Array.isArray(item.missing_information)) issues.push("missing_information must be an array");
  if (!["lookup_context", "request_clarification", "prepare_proposal", "human_review"].includes(item.suggested_next_action ?? "")) {
    issues.push("suggested_next_action must be lookup_context, request_clarification, prepare_proposal, or human_review");
  }
  for (const [index, requirement] of (item.product_requirements ?? []).entries()) {
    if (!requirement || typeof requirement.product_query !== "string") issues.push(`product_requirements[${index}].product_query must be a string`);
    if (!requirement || typeof requirement.quantity !== "number" || !Number.isFinite(requirement.quantity) || requirement.quantity <= 0) {
      issues.push(`product_requirements[${index}].quantity must be a positive number`);
    }
    if (!requirement || typeof requirement.unit !== "string") issues.push(`product_requirements[${index}].unit must be a string`);
    if (!requirement || !Array.isArray(requirement.constraints) || requirement.constraints.some((constraint) => typeof constraint !== "string")) {
      issues.push(`product_requirements[${index}].constraints must be an array of strings`);
    }
  }
  if ((item.important_constraints ?? []).some((value) => typeof value !== "string")) issues.push("important_constraints must contain only strings");
  if ((item.missing_information ?? []).some((value) => typeof value !== "string")) issues.push("missing_information must contain only strings");
  if (issues.length) throw new InquirySchemaError(issues);
  return item as InquiryAnalysis;
}
