import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "./supabase";
import { friendlyError, isMissingColumn, isMissingTable } from "./records";

type TableState<T> = {
  rows: T[];
  loading: boolean;
  error: string;
  /** True when extended columns are unavailable and the page degraded to base columns. */
  legacyMode: boolean;
  /** True when the table itself is missing (migration not applied). */
  tableMissing: boolean;
  reload: () => void;
};

/**
 * Loads an organization-scoped table with graceful degradation:
 * full column list first, base columns when the completion migration
 * is not applied yet, and a clear missing-table state for new tables.
 */
export function useOrgTable<T extends Record<string, unknown>>(
  table: string,
  baseSelect: string,
  extendedSelect: string | null,
  orderColumn: string,
): TableState<T> {
  const { activeOrganization } = useAuth();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [legacyMode, setLegacyMode] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const fullSelect = extendedSelect ? `${baseSelect},${extendedSelect}` : baseSelect;
    const load = (select: string) =>
      supabase!.from(table).select(select).eq("org_id", activeOrganization.id).order(orderColumn, { ascending: false });
    void load(fullSelect).then(async ({ data, error: queryError }) => {
      if (!active) return;
      if (queryError && isMissingTable(queryError)) {
        setRows([]);
        setTableMissing(true);
        setLegacyMode(false);
        setError("");
        setLoading(false);
        return;
      }
      if (queryError && isMissingColumn(queryError) && extendedSelect) {
        const fallback = await load(baseSelect);
        if (!active) return;
        if (fallback.error) {
          setError(friendlyError(fallback.error, "Records could not be loaded."));
          setRows([]);
        } else {
          setRows((fallback.data ?? []) as unknown as T[]);
          setLegacyMode(true);
        }
        setLoading(false);
        return;
      }
      if (queryError) setError(friendlyError(queryError, "Records could not be loaded."));
      else setRows((data ?? []) as unknown as T[]);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [activeOrganization, baseSelect, extendedSelect, orderColumn, table, nonce]);

  return { rows, loading, error, legacyMode, tableMissing, reload };
}

export function useOrgOptions<T extends Record<string, unknown>>(table: string, select: string, orderColumn: string) {
  const { activeOrganization } = useAuth();
  const [options, setOptions] = useState<T[]>([]);

  useEffect(() => {
    let active = true;
    if (!supabase || !activeOrganization) {
      setOptions([]);
      return;
    }
    void supabase
      .from(table)
      .select(select)
      .eq("org_id", activeOrganization.id)
      .order(orderColumn, { ascending: true })
      .limit(200)
      .then(({ data }) => {
        if (active) setOptions((data ?? []) as unknown as T[]);
      });
    return () => {
      active = false;
    };
  }, [activeOrganization, orderColumn, select, table]);

  return options;
}
