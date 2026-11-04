import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isMissingTable } from "./records";

export type OrganizationSettings = {
  org_id: string;
  company_name: string | null;
  logo_url: string | null;
  description: string | null;
  industry: string | null;
  website: string | null;
  business_email: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  time_zone: string | null;
  default_currency: string;
  default_tax_rate: number;
  tax_registration: string | null;
  quotation_validity_days: number;
  default_payment_terms: string | null;
  updated_at: string | null;
};

export const DEFAULT_SETTINGS: Omit<OrganizationSettings, "org_id" | "updated_at"> = {
  company_name: null,
  logo_url: null,
  description: null,
  industry: null,
  website: null,
  business_email: null,
  phone: null,
  address: null,
  country: null,
  time_zone: null,
  default_currency: "BDT",
  default_tax_rate: 0,
  tax_registration: null,
  quotation_validity_days: 30,
  default_payment_terms: null,
};

export function formatMoney(amount: number, currency = "BDT"): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(safe);
  } catch {
    return `${currency} ${safe.toLocaleString()}`;
  }
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/**
 * Loads organization settings when the completion migration is applied.
 * Falls back to workspace defaults (BDT, 0% tax) when the table is missing,
 * so every module stays usable before the migration is approved.
 */
export function useOrganizationSettings(orgId: string | null) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [tableAvailable, setTableAvailable] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!supabase || !orgId) {
      setSettings(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void supabase
      .from("organization_settings")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error && isMissingTable(error)) {
          setTableAvailable(false);
          setSettings(null);
        } else if (!error) {
          setSettings((data ?? null) as OrganizationSettings | null);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orgId]);

  const currency = settings?.default_currency ?? DEFAULT_SETTINGS.default_currency;
  const defaultTaxRate = Number(settings?.default_tax_rate ?? DEFAULT_SETTINGS.default_tax_rate);
  return { settings, tableAvailable, loading, currency, defaultTaxRate };
}
