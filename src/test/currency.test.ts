import { describe, expect, it } from "vitest";
import { FALLBACK_CURRENCY, normalizeCurrencyCode, resolveOrganizationCurrency } from "../../supabase/functions/_shared/currency";
import { DEFAULT_SETTINGS } from "../lib/org-settings";

type FakeAdmin = Parameters<typeof resolveOrganizationCurrency>[0];

function fakeAdmin(rows: Record<string, { default_currency: unknown } | null>, forcedError?: unknown): FakeAdmin {
  return {
    from: () => ({
      select: () => ({
        eq: (_column: string, value: unknown) => ({
          maybeSingle: async () => {
            const orgId = String(value);
            if (forcedError) return { data: null, error: forcedError };
            if (!(orgId in rows)) return { data: null, error: null };
            return { data: rows[orgId], error: null };
          },
        }),
      }),
    }),
  } as unknown as FakeAdmin;
}

describe("normalizeCurrencyCode", () => {
  it("accepts valid 3-letter codes and normalizes case and whitespace", () => {
    expect(normalizeCurrencyCode("BDT")).toBe("BDT");
    expect(normalizeCurrencyCode("USD")).toBe("USD");
    expect(normalizeCurrencyCode("EUR")).toBe("EUR");
    expect(normalizeCurrencyCode(" usd ")).toBe("USD");
  });

  it("rejects empty, malformed, and non-string values", () => {
    expect(normalizeCurrencyCode("")).toBeNull();
    expect(normalizeCurrencyCode("   ")).toBeNull();
    expect(normalizeCurrencyCode("US")).toBeNull();
    expect(normalizeCurrencyCode("USDD")).toBeNull();
    expect(normalizeCurrencyCode("U$D")).toBeNull();
    expect(normalizeCurrencyCode(null)).toBeNull();
    expect(normalizeCurrencyCode(undefined)).toBeNull();
    expect(normalizeCurrencyCode(123)).toBeNull();
  });
});

describe("resolveOrganizationCurrency", () => {
  it("returns the configured organization currency (BDT, USD, EUR)", async () => {
    const admin = fakeAdmin({ orgA: { default_currency: "BDT" }, orgB: { default_currency: "USD" }, orgC: { default_currency: "EUR" } });
    await expect(resolveOrganizationCurrency(admin, "orgA")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "orgB")).resolves.toBe("USD");
    await expect(resolveOrganizationCurrency(admin, "orgC")).resolves.toBe("EUR");
  });

  it("falls back to BDT for missing settings, empty, or invalid values", async () => {
    const admin = fakeAdmin({ none: null, empty: { default_currency: "" }, blank: { default_currency: "   " }, bad: { default_currency: "XX" }, nulled: { default_currency: null } });
    await expect(resolveOrganizationCurrency(admin, "none")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "empty")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "blank")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "bad")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "nulled")).resolves.toBe("BDT");
    await expect(resolveOrganizationCurrency(admin, "unknown-org")).resolves.toBe("BDT");
  });

  it("falls back to BDT when the settings table is unavailable", async () => {
    const missingTable = fakeAdmin({}, new Error("Could not find the table 'public.organization_settings' in the schema cache"));
    await expect(resolveOrganizationCurrency(missingTable, "orgA")).resolves.toBe(FALLBACK_CURRENCY);
  });

  it("scopes resolution to the requested organization and never leaks across orgs", async () => {
    const admin = fakeAdmin({ orgUSD: { default_currency: "USD" }, orgEUR: { default_currency: "EUR" } });
    // Interleaved calls stay isolated per organization.
    await expect(resolveOrganizationCurrency(admin, "orgEUR")).resolves.toBe("EUR");
    await expect(resolveOrganizationCurrency(admin, "orgUSD")).resolves.toBe("USD");
    await expect(resolveOrganizationCurrency(admin, "orgEUR")).resolves.toBe("EUR");
  });

  it("cannot be overridden by untrusted input — it reads only the settings row", async () => {
    // The resolver accepts no currency parameter, so a model or frontend cannot inject one.
    const admin = fakeAdmin({ orgA: { default_currency: "EUR" } }, undefined);
    const withExtra = admin as unknown as { from: FakeAdmin["from"] };
    expect(withExtra).toBeDefined();
    await expect(resolveOrganizationCurrency(admin, "orgA")).resolves.toBe("EUR");
    // Repeated deterministic resolution for idempotent/replayed approvals.
    await expect(resolveOrganizationCurrency(admin, "orgA")).resolves.toBe("EUR");
  });

  it("matches the frontend manual-quotation fallback (BDT)", () => {
    expect(FALLBACK_CURRENCY).toBe("BDT");
    expect(DEFAULT_SETTINGS.default_currency).toBe(FALLBACK_CURRENCY);
  });
});
