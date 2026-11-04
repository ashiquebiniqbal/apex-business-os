export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export const CURRENCIES = [
  "BDT",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "PKR",
  "LKR",
  "NPR",
  "MMK",
  "SGD",
  "MYR",
  "AED",
  "SAR",
  "CNY",
  "JPY",
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export function isValidCurrency(value: string): value is CurrencyCode {
  return (CURRENCIES as readonly string[]).includes(value);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function fail(errors: string[]): ValidationResult<never> {
  return { ok: false, errors };
}

export type CustomerInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  customer_type?: string | null;
  address?: string | null;
  notes?: string | null;
};

export function validateCustomer(input: CustomerInput): ValidationResult<Required<Pick<CustomerInput, "name">> & CustomerInput> {
  const errors: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) errors.push("Customer name is required (1-200 characters).");
  if (input.email && !isValidEmail(input.email)) errors.push("Customer email address is invalid.");
  if (input.phone && input.phone.trim().length > 40) errors.push("Phone number must be 40 characters or fewer.");
  if (input.customer_type && !["individual", "company"].includes(input.customer_type)) errors.push("Customer type must be individual or company.");
  if (input.address && input.address.length > 1000) errors.push("Address must be 1000 characters or fewer.");
  if (input.notes && input.notes.length > 5000) errors.push("Notes must be 5000 characters or fewer.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, name } };
}

export type ProductInput = {
  sku: string;
  name: string;
  unit_price: number;
  tax_rate?: number;
  stock_qty?: number;
  active?: boolean;
  kind?: string | null;
  category?: string | null;
  unit?: string | null;
  cost_price?: number | null;
  min_stock_level?: number | null;
};

export function validateProduct(input: ProductInput): ValidationResult<ProductInput> {
  const errors: string[] = [];
  const sku = input.sku.trim();
  const name = input.name.trim();
  if (sku.length < 1 || sku.length > 60) errors.push("SKU / product code is required (1-60 characters).");
  if (name.length < 1 || name.length > 200) errors.push("Product name is required (1-200 characters).");
  if (!Number.isFinite(input.unit_price) || input.unit_price < 0) errors.push("Selling price must be a number zero or greater.");
  const taxRate = input.tax_rate ?? 0;
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) errors.push("Tax rate must be between 0 and 100.");
  const stockQty = input.stock_qty ?? 0;
  if (!Number.isFinite(stockQty) || stockQty < 0) errors.push("Stock quantity must be zero or greater.");
  if (input.kind && !["product", "service"].includes(input.kind)) errors.push("Product type must be product or service.");
  if (input.category && input.category.length > 120) errors.push("Category must be 120 characters or fewer.");
  if (input.unit && input.unit.length > 40) errors.push("Unit must be 40 characters or fewer.");
  if (input.cost_price !== null && input.cost_price !== undefined && (!Number.isFinite(input.cost_price) || input.cost_price < 0)) {
    errors.push("Cost price must be zero or greater.");
  }
  if (input.min_stock_level !== null && input.min_stock_level !== undefined && (!Number.isFinite(input.min_stock_level) || input.min_stock_level < 0)) {
    errors.push("Minimum stock level must be zero or greater.");
  }
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, sku, name, tax_rate: taxRate, stock_qty: stockQty } };
}

export type InquiryInput = {
  content: string;
  status?: string;
  customer_id?: string | null;
  assigned_to?: string | null;
};

export const INQUIRY_STATUSES = ["new", "processing", "proposal", "approved", "rejected", "closed"] as const;

export function validateInquiry(input: InquiryInput): ValidationResult<InquiryInput> {
  const errors: string[] = [];
  const content = input.content.trim();
  if (content.length < 3 || content.length > 10000) errors.push("Inquiry description is required (3-10000 characters).");
  if (input.status && !(INQUIRY_STATUSES as readonly string[]).includes(input.status)) errors.push("Inquiry status is invalid.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, content } };
}

export type QuotationLineInput = { product_id: string; quantity: number; discount_rate?: number };

export function validateQuotationLine(input: QuotationLineInput): ValidationResult<QuotationLineInput> {
  const errors: string[] = [];
  if (!input.product_id) errors.push("A product or service is required for every quotation line.");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || input.quantity > 1000000) {
    errors.push("Quantity must be a positive number.");
  }
  const discount = input.discount_rate ?? 0;
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) errors.push("Discount must be between 0 and 100 percent.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, discount_rate: discount } };
}

export const QUOTATION_STATUSES = ["draft", "pending_approval", "approved", "sent", "accepted", "rejected"] as const;

export function validateQuotationStatusTransition(from: string, to: string): string | null {
  if (!(QUOTATION_STATUSES as readonly string[]).includes(to)) return "Quotation status is invalid.";
  if (from === to) return null;
  const terminal = ["accepted", "rejected"];
  if (terminal.includes(from)) return `A ${from} quotation cannot be changed.`;
  if (from === "approved" && !["sent", "accepted", "rejected"].includes(to)) return "An approved quotation can only move to sent, accepted, or rejected.";
  return null;
}

export const OPPORTUNITY_STATUSES = ["proposed", "open", "won", "lost"] as const;

export type OpportunityInput = {
  title: string;
  status?: string;
  estimated_value?: number;
  customer_id?: string | null;
  inquiry_id?: string | null;
  expected_close_date?: string | null;
  notes?: string | null;
};

export function validateOpportunity(input: OpportunityInput): ValidationResult<OpportunityInput> {
  const errors: string[] = [];
  const title = input.title.trim();
  if (title.length < 1 || title.length > 200) errors.push("Opportunity title is required (1-200 characters).");
  if (input.status && !(OPPORTUNITY_STATUSES as readonly string[]).includes(input.status)) errors.push("Opportunity status is invalid.");
  if (input.estimated_value !== undefined && (!Number.isFinite(input.estimated_value) || input.estimated_value < 0)) {
    errors.push("Deal value must be zero or greater.");
  }
  if (input.notes && input.notes.length > 5000) errors.push("Notes must be 5000 characters or fewer.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, title } };
}

export const TASK_STATUSES = ["open", "done", "dismissed"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TaskInput = {
  title: string;
  status?: string;
  due_at?: string | null;
  customer_id?: string | null;
  inquiry_id?: string | null;
  opportunity_id?: string | null;
  assigned_to?: string | null;
  priority?: string | null;
  notes?: string | null;
};

export function validateTask(input: TaskInput): ValidationResult<TaskInput> {
  const errors: string[] = [];
  const title = input.title.trim();
  if (title.length < 1 || title.length > 200) errors.push("Task title is required (1-200 characters).");
  if (input.status && !(TASK_STATUSES as readonly string[]).includes(input.status)) errors.push("Task status is invalid.");
  if (input.priority && !(TASK_PRIORITIES as readonly string[]).includes(input.priority)) errors.push("Task priority is invalid.");
  if (input.notes && input.notes.length > 5000) errors.push("Notes must be 5000 characters or fewer.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, title } };
}

export type SupplierInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
};

export function validateSupplier(input: SupplierInput): ValidationResult<SupplierInput> {
  const errors: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) errors.push("Supplier name is required (1-200 characters).");
  if (input.email && !isValidEmail(input.email)) errors.push("Supplier email address is invalid.");
  if (input.phone && input.phone.trim().length > 40) errors.push("Phone number must be 40 characters or fewer.");
  if (input.address && input.address.length > 1000) errors.push("Address must be 1000 characters or fewer.");
  if (input.notes && input.notes.length > 5000) errors.push("Notes must be 5000 characters or fewer.");
  if (errors.length) return fail(errors);
  return { ok: true, value: { ...input, name } };
}

export type OrganizationSettingsInput = {
  company_name?: string | null;
  logo_url?: string | null;
  description?: string | null;
  industry?: string | null;
  website?: string | null;
  business_email?: string | null;
  phone?: string | null;
  address?: string | null;
  country?: string | null;
  time_zone?: string | null;
  default_currency?: string;
  default_tax_rate?: number;
  tax_registration?: string | null;
  quotation_validity_days?: number;
  default_payment_terms?: string | null;
};

const SETTINGS_TEXT_FIELDS = [
  "company_name",
  "logo_url",
  "description",
  "industry",
  "website",
  "business_email",
  "phone",
  "address",
  "country",
  "time_zone",
  "tax_registration",
  "default_payment_terms",
] as const;

/** Blank optional text must be stored as null: the database rejects "" for company_name. */
function blankToNull(value: string | null | undefined): string | null {
  return value == null || value.trim() === "" ? null : value;
}

export function validateOrganizationSettings(input: OrganizationSettingsInput): ValidationResult<OrganizationSettingsInput> {
  const value: OrganizationSettingsInput = { ...input };
  for (const field of SETTINGS_TEXT_FIELDS) value[field] = blankToNull(input[field]);
  const errors: string[] = [];
  if (value.company_name && value.company_name.length > 200) errors.push("Company name must be 200 characters or fewer.");
  if (value.logo_url && value.logo_url.length > 500) errors.push("Logo URL must be 500 characters or fewer.");
  if (value.business_email && !isValidEmail(value.business_email)) errors.push("Business email address is invalid.");
  if (value.default_currency && !/^[A-Z]{3}$/.test(value.default_currency)) errors.push("Default currency must be a 3-letter code such as BDT.");
  const taxRate = value.default_tax_rate ?? 0;
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) errors.push("Default tax rate must be between 0 and 100.");
  const validity = value.quotation_validity_days ?? 30;
  if (!Number.isInteger(validity) || validity < 1 || validity > 365) errors.push("Quotation validity must be 1-365 days.");
  if (errors.length) return fail(errors);
  return { ok: true, value };
}
