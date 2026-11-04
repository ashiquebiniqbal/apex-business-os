import { describe, expect, it } from "vitest";
import { InquirySchemaError, validateInquiryAnalysis } from "../../supabase/functions/_shared/inquiry-schema";

const valid = {
  summary: "The customer wants licenses.",
  customer_intent: "Request a quotation",
  business_category: "Software",
  product_requirements: [{ product_query: "Operations Suite", quantity: 2, unit: "license", constraints: [] }],
  important_constraints: ["Confirm availability"],
  missing_information: [],
  suggested_next_action: "prepare_proposal",
};

describe("inquiry analysis schema", () => {
  it("accepts the strict business inquiry shape", () => {
    expect(validateInquiryAnalysis(valid)).toEqual(valid);
  });

  it("rejects malformed or unsafe product requirements", () => {
    expect(() => validateInquiryAnalysis({ ...valid, product_requirements: [{ ...valid.product_requirements[0], quantity: 0 }] })).toThrow();
    expect(() => validateInquiryAnalysis({ ...valid, suggested_next_action: "execute_sql" })).toThrow();
  });

  it("reports every schema issue for actionable errors", () => {
    try {
      validateInquiryAnalysis({ summary: 42, product_requirements: [{ product_query: "x", quantity: -1, unit: "u", constraints: "nope" }] });
      expect.unreachable("invalid analysis must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(InquirySchemaError);
      const issues = (error as InquirySchemaError).issues;
      expect(issues.length).toBeGreaterThan(1);
      expect(issues.join(" ")).toMatch(/customer_intent/);
      expect(issues.join(" ")).toMatch(/quantity must be a positive number/);
    }
  });
});
