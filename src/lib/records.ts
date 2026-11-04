import { supabase } from "./supabase";

export type SupabaseError = { code?: string; message: string; details?: string | null };

/** PostgREST/Supabase error codes that mean the table (or migration) is not applied yet. */
export function isMissingTable(error: unknown): boolean {
  const code = (error as SupabaseError | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String((error as SupabaseError | null)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  );
}

/** Postgres error code 42703 (undefined column): the completion migration is not applied yet. */
export function isMissingColumn(error: unknown): boolean {
  const code = (error as SupabaseError | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String((error as SupabaseError | null)?.message ?? "");
  return code === "42703" || /column .* does not exist/i.test(message);
}

export function isPermissionError(error: unknown): boolean {
  const code = (error as SupabaseError | null)?.code ?? "";
  const message = error instanceof Error ? error.message : String((error as SupabaseError | null)?.message ?? "");
  return code === "42501" || /row-level security|permission denied/i.test(message);
}

export function friendlyError(error: unknown, fallback: string): string {
  if (isMissingTable(error)) return "This data is not available yet: the supporting database migration has not been applied. Ask an administrator to review the pending migration.";
  if (isMissingColumn(error)) return "Some fields are unavailable: the business-completion migration has not been applied yet. Base fields below still work.";
  if (isPermissionError(error)) return "Your organization role does not allow this action. The database policy blocked it.";
  const message = error instanceof Error ? error.message : (error as SupabaseError | null)?.message;
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}

export function requireClient() {
  if (!supabase) throw new Error("Supabase is not configured. Add the browser connection settings first.");
  return supabase;
}

export async function orgInsert<T>(table: string, orgId: string, values: Record<string, unknown>): Promise<T> {
  const client = requireClient();
  const { data, error } = await client.from(table).insert({ org_id: orgId, ...values }).select().single();
  if (error) throw error;
  return data as T;
}

export async function orgUpdate(table: string, orgId: string, id: string, values: Record<string, unknown>): Promise<void> {
  const client = requireClient();
  const { error } = await client.from(table).update(values).eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

export async function orgDelete(table: string, orgId: string, id: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.from(table).delete().eq("id", id).eq("org_id", orgId);
  if (error) throw error;
}

/** Demo markers used by the idempotent seed function. Client-side detection only; never fabricates data. */
export const DEMO_VERSION = "APEX_DEMO_V1";

export function isDemoText(value: string | null | undefined): boolean {
  return Boolean(value && (value.includes(DEMO_VERSION) || value.startsWith("Apex Demo · ")));
}

export function isDemoCustomer(row: { name: string; email: string | null }): boolean {
  return isDemoText(row.name) || Boolean(row.email?.endsWith(".test"));
}

export function isDemoProduct(row: { sku: string; name: string }): boolean {
  return row.sku.startsWith("DEMO-APX-") || isDemoText(row.name);
}
