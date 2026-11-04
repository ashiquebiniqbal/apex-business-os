// Organization currency resolution for Edge Functions.
// Currency is a server-side fact: it is read from the authenticated user's
// authorized organization settings and is never accepted from a request body
// or from AI model output. The application default is BDT.

export const FALLBACK_CURRENCY = "BDT";

/** Returns a normalized ISO-style 3-letter currency code, or null when unusable. */
export function normalizeCurrencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

type SettingsReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
};

/**
 * Resolves the currency for an organization from its settings row.
 * Falls back to BDT when the settings table is unavailable (migration not
 * applied yet), when no settings row exists, or when the stored value is
 * missing or invalid. Never throws: currency lookup must not break a workflow.
 */
export async function resolveOrganizationCurrency(admin: SettingsReader, orgId: string): Promise<string> {
  try {
    const { data, error } = await admin.from("organization_settings").select("default_currency").eq("org_id", orgId).maybeSingle();
    if (error) return FALLBACK_CURRENCY;
    const stored = (data as { default_currency?: unknown } | null)?.default_currency;
    return normalizeCurrencyCode(stored) ?? FALLBACK_CURRENCY;
  } catch {
    return FALLBACK_CURRENCY;
  }
}
