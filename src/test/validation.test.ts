import { describe, expect, it } from "vitest";
import {
  validateCustomer,
  validateInquiry,
  validateOpportunity,
  validateOrganizationSettings,
  validateProduct,
  validateQuotationLine,
  validateQuotationStatusTransition,
  validateSupplier,
  validateTask,
} from "../lib/validation";

describe("customer validation", () => {
  it("accepts a complete customer", () => {
    const result = validateCustomer({ name: "Rahim Trading", email: "rahim@example.com", phone: "01700", customer_type: "company" });
    expect(result.ok).toBe(true);
  });

  it("rejects blank names and bad emails", () => {
    expect(validateCustomer({ name: "  " })).toMatchObject({ ok: false });
    const bad = validateCustomer({ name: "Acme", email: "not-an-email" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/email/i);
  });
});

describe("product validation", () => {
  it("accepts a product with defaults", () => {
    const result = validateProduct({ sku: "APX-001", name: "Starter", unit_price: 12500 });
    expect(result).toMatchObject({ ok: true, value: { tax_rate: 0, stock_qty: 0 } });
  });

  it("rejects negative prices and out-of-range tax", () => {
    expect(validateProduct({ sku: "A", name: "B", unit_price: -1 }).ok).toBe(false);
    expect(validateProduct({ sku: "A", name: "B", unit_price: 10, tax_rate: 101 }).ok).toBe(false);
    expect(validateProduct({ sku: "A", name: "B", unit_price: 10, stock_qty: -2 }).ok).toBe(false);
  });

  it("rejects unknown product types and bad cost inputs", () => {
    expect(validateProduct({ sku: "A", name: "B", unit_price: 10, kind: "bundle" }).ok).toBe(false);
    expect(validateProduct({ sku: "A", name: "B", unit_price: 10, cost_price: -5 }).ok).toBe(false);
  });
});

describe("inquiry validation", () => {
  it("requires a meaningful description", () => {
    expect(validateInquiry({ content: "hi" }).ok).toBe(false);
    expect(validateInquiry({ content: "Need two licenses", status: "bogus" }).ok).toBe(false);
    expect(validateInquiry({ content: "Need two licenses", status: "new" }).ok).toBe(true);
  });
});

describe("quotation validation", () => {
  it("requires a product and positive quantity", () => {
    expect(validateQuotationLine({ product_id: "", quantity: 1 }).ok).toBe(false);
    expect(validateQuotationLine({ product_id: "p", quantity: 0 }).ok).toBe(false);
    expect(validateQuotationLine({ product_id: "p", quantity: 2, discount_rate: 150 }).ok).toBe(false);
    expect(validateQuotationLine({ product_id: "p", quantity: 2, discount_rate: 10 }).ok).toBe(true);
  });

  it("guards terminal quotation states", () => {
    expect(validateQuotationStatusTransition("accepted", "draft")).toMatch(/cannot be changed/);
    expect(validateQuotationStatusTransition("draft", "pending_approval")).toBeNull();
    expect(validateQuotationStatusTransition("draft", "shipped")).toMatch(/invalid/);
  });
});

describe("opportunity and task validation", () => {
  it("validates opportunities", () => {
    expect(validateOpportunity({ title: "" }).ok).toBe(false);
    expect(validateOpportunity({ title: "Deal", estimated_value: -1 }).ok).toBe(false);
    expect(validateOpportunity({ title: "Deal", status: "open", estimated_value: 5000 }).ok).toBe(true);
  });

  it("validates tasks", () => {
    expect(validateTask({ title: "" }).ok).toBe(false);
    expect(validateTask({ title: "Call", priority: "critical" }).ok).toBe(false);
    expect(validateTask({ title: "Call", status: "open", priority: "high" }).ok).toBe(true);
  });
});

describe("supplier validation", () => {
  it("requires a name and valid email", () => {
    expect(validateSupplier({ name: "" }).ok).toBe(false);
    expect(validateSupplier({ name: "Vendor", email: "bad" }).ok).toBe(false);
    expect(validateSupplier({ name: "Vendor", email: "vendor@example.com" }).ok).toBe(true);
  });
});

describe("organization settings validation", () => {
  it("accepts BDT defaults", () => {
    expect(validateOrganizationSettings({ default_currency: "BDT", default_tax_rate: 0, quotation_validity_days: 30 }).ok).toBe(true);
  });

  it("normalizes blank optional text to null so a first save satisfies the company_name check", () => {
    // Mirrors MvpSettingsPage EMPTY_SETTINGS + a currency-only change (USD):
    // every optional text field starts as "" and must reach the database as null.
    const result = validateOrganizationSettings({
      company_name: "", logo_url: "", description: "", industry: "", website: "", business_email: "",
      phone: "", address: "", country: "", time_zone: "", tax_registration: "", default_payment_terms: "",
      default_currency: "USD", default_tax_rate: 0, quotation_validity_days: 30,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        company_name: null, logo_url: null, description: null, industry: null, website: null, business_email: null,
        phone: null, address: null, country: null, time_zone: null, tax_registration: null, default_payment_terms: null,
        default_currency: "USD",
      },
    });
  });

  it("normalizes whitespace-only text to null and preserves real values", () => {
    const result = validateOrganizationSettings({ company_name: "   ", default_currency: "EUR", website: "https://example.com" });
    expect(result).toMatchObject({ ok: true, value: { company_name: null, default_currency: "EUR", website: "https://example.com" } });
  });

  it("rejects bad currency codes, tax rates, and validity windows", () => {
    expect(validateOrganizationSettings({ default_currency: "bdt" }).ok).toBe(false);
    expect(validateOrganizationSettings({ default_currency: "USD", default_tax_rate: 120 }).ok).toBe(false);
    expect(validateOrganizationSettings({ default_currency: "USD", quotation_validity_days: 400 }).ok).toBe(false);
    expect(validateOrganizationSettings({ business_email: "bad" }).ok).toBe(false);
  });
});
