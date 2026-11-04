export type OrgRole = "owner" | "admin" | "manager" | "staff" | "viewer";

const MANAGERS: OrgRole[] = ["owner", "admin", "manager"];
const OPERATORS: OrgRole[] = ["owner", "admin", "manager", "staff"];

export function normalizeRole(role: string | null | undefined): OrgRole | null {
  return role === "owner" || role === "admin" || role === "manager" || role === "staff" || role === "viewer" ? role : null;
}

/** Mirrors the database RLS operator grants (customers/inquiries/tasks writes, workflow proposals). */
export function canOperate(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized !== null && (OPERATORS as string[]).includes(normalized);
}

/** Mirrors the database RLS manager grants (products/quotations/opportunities writes, approvals, deletes). */
export function canManage(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized !== null && (MANAGERS as string[]).includes(normalized);
}

export function isOwner(role: string | null | undefined): boolean {
  return normalizeRole(role) === "owner";
}

export function canAdminister(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role);
  return normalized === "owner" || normalized === "admin";
}

export function permissionNote(role: string | null | undefined, action: string): string | null {
  if (canManage(role)) return null;
  if (canOperate(role)) return `${action} requires a manager, admin, or owner role. Your role: ${role ?? "unknown"}.`;
  return `${action} requires an operator role or higher. Your role: ${role ?? "unknown"}. Server policies enforce this limit.`;
}
