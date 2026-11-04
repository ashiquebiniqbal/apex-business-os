import { supabase } from "./supabase";
import { DEMO_VERSION } from "./records";

export type DemoPreview = { customers: number; products: number; inquiries: number; quotations: number; opportunities: number; tasks: number };

function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** Finds demo record IDs using only the deterministic seed markers. Never matches real business data. */
async function findDemoIds(orgId: string) {
  const client = requireClient();
  const [customers, products, inquiries] = await Promise.all([
    client.from("customers").select("id").eq("org_id", orgId).like("name", "Apex Demo · %"),
    client.from("products").select("id").eq("org_id", orgId).like("sku", "DEMO-APX-%"),
    client.from("inquiries").select("id").eq("org_id", orgId).like("content", `${DEMO_VERSION}:%`),
  ]);
  if (customers.error) throw customers.error;
  if (products.error) throw products.error;
  if (inquiries.error) throw inquiries.error;
  const inquiryIds = (inquiries.data ?? []).map((row) => row.id as string);
  let quotationIds: string[] = [];
  let opportunityIds: string[] = [];
  let taskIds: string[] = [];
  if (inquiryIds.length) {
    const [quotations, opportunities, tasks] = await Promise.all([
      client.from("quotations").select("id").eq("org_id", orgId).in("inquiry_id", inquiryIds),
      client.from("opportunities").select("id").eq("org_id", orgId).in("inquiry_id", inquiryIds),
      client.from("tasks").select("id").eq("org_id", orgId).in("inquiry_id", inquiryIds),
    ]);
    if (quotations.error) throw quotations.error;
    if (opportunities.error) throw opportunities.error;
    if (tasks.error) throw tasks.error;
    quotationIds = (quotations.data ?? []).map((row) => row.id as string);
    opportunityIds = (opportunities.data ?? []).map((row) => row.id as string);
    taskIds = (tasks.data ?? []).map((row) => row.id as string);
  }
  return {
    customerIds: (customers.data ?? []).map((row) => row.id as string),
    productIds: (products.data ?? []).map((row) => row.id as string),
    inquiryIds,
    quotationIds,
    opportunityIds,
    taskIds,
  };
}

export async function previewDemoRecords(orgId: string): Promise<DemoPreview> {
  const ids = await findDemoIds(orgId);
  return { customers: ids.customerIds.length, products: ids.productIds.length, inquiries: ids.inquiryIds.length, quotations: ids.quotationIds.length, opportunities: ids.opportunityIds.length, tasks: ids.taskIds.length };
}

/**
 * Deletes only demo-marker records in foreign-key-safe order.
 * Real business records are never matched and never touched.
 */
export async function resetDemoRecords(orgId: string): Promise<DemoPreview> {
  const client = requireClient();
  const ids = await findDemoIds(orgId);
  const remove = async (table: string, values: string[]) => {
    if (!values.length) return;
    const { error } = await client.from(table).delete().eq("org_id", orgId).in("id", values);
    if (error) throw error;
  };
  if (ids.quotationIds.length) {
    const { error } = await client.from("quotation_lines").delete().eq("org_id", orgId).in("quotation_id", ids.quotationIds);
    if (error) throw error;
  }
  await remove("quotations", ids.quotationIds);
  await remove("opportunities", ids.opportunityIds);
  await remove("tasks", ids.taskIds);
  await remove("inquiries", ids.inquiryIds);
  await remove("products", ids.productIds);
  await remove("customers", ids.customerIds);
  return { customers: ids.customerIds.length, products: ids.productIds.length, inquiries: ids.inquiryIds.length, quotations: ids.quotationIds.length, opportunities: ids.opportunityIds.length, tasks: ids.taskIds.length };
}
