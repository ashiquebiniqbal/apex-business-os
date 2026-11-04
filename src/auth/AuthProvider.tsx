import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export type Organization = { id: string; name: string; slug: string; role: string };
type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  organizations: Organization[];
  activeOrganization: Organization | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectOrganization: (id: string) => Promise<void>;
  createOrganization: (name: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMemberships = async (userId: string) => {
    if (!supabase) return;
    const [{ data: memberships, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from("org_members").select("org_id, role, organizations(id, name, slug)").eq("user_id", userId),
      supabase.from("profiles").select("active_org_id").eq("id", userId).single(),
    ]);
    if (membershipError) throw membershipError;
    if (profileError && profileError.code !== "PGRST116") throw profileError;
    const next = (memberships ?? []).flatMap((item: any) => item.organizations ? [{ ...item.organizations, role: item.role }] : []);
    setOrganizations(next);
    setActiveOrgId(profile?.active_org_id ?? next[0]?.id ?? null);
  };

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let mounted = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error("Session restore failed", error);
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) {
        try { await loadMemberships(data.session.user.id); } catch (membershipError) { console.error("Membership load failed", membershipError); }
      }
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) void loadMemberships(nextSession.user.id);
      else { setOrganizations([]); setActiveOrgId(null); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: Boolean(supabase), loading, session, user: session?.user ?? null, organizations,
    activeOrganization: organizations.find((org) => org.id === activeOrgId) ?? null,
    signIn: async (email, password) => { if (!supabase) throw new Error("Supabase is not configured."); const { error } = await supabase.auth.signInWithPassword({ email, password }); if (error) throw error; },
    signUp: async (email, password) => { if (!supabase) throw new Error("Supabase is not configured."); const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }); if (error) throw error; },
    signOut: async () => { if (!supabase) return; const { error } = await supabase.auth.signOut(); if (error) throw error; },
    selectOrganization: async (id) => { if (!supabase || !session?.user) throw new Error("You must be signed in."); const { error } = await supabase.from("profiles").update({ active_org_id: id }).eq("id", session.user.id); if (error) throw error; setActiveOrgId(id); },
    createOrganization: async (name) => { if (!supabase || !session?.user) throw new Error("You must be signed in."); const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); const { error } = await supabase.from("organizations").insert({ name: name.trim(), slug, created_by: session.user.id }); if (error) throw error; await loadMemberships(session.user.id); },
  }), [activeOrgId, loading, organizations, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth must be used inside AuthProvider"); return value; }
