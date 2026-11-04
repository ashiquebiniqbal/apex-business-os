import { describe, expect, it } from "vitest";
import { canAdminister, canManage, canOperate, isOwner, normalizeRole } from "../lib/roles";
import { friendlyError, isDemoCustomer, isDemoProduct, isDemoText, isMissingColumn, isMissingTable, isPermissionError } from "../lib/records";

describe("role helpers mirror the database RLS grants", () => {
  it("normalizes known roles and rejects unknown ones", () => {
    expect(normalizeRole("owner")).toBe("owner");
    expect(normalizeRole("superadmin")).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });

  it("grants operators and managers per the migration matrix", () => {
    expect(canOperate("staff")).toBe(true);
    expect(canOperate("viewer")).toBe(false);
    expect(canManage("staff")).toBe(false);
    expect(canManage("manager")).toBe(true);
    expect(canManage("viewer")).toBe(false);
  });

  it("identifies owners and administrators", () => {
    expect(isOwner("owner")).toBe(true);
    expect(isOwner("admin")).toBe(false);
    expect(canAdminister("admin")).toBe(true);
    expect(canAdminister("manager")).toBe(false);
  });
});

describe("database error classification", () => {
  it("detects missing tables and columns for graceful degradation", () => {
    expect(isMissingTable({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTable({ code: "42501", message: "x" })).toBe(false);
    expect(isMissingColumn({ code: "42703", message: "x" })).toBe(true);
    expect(isMissingColumn(new Error('column "kind" does not exist'))).toBe(true);
    expect(isMissingColumn({ code: "23505", message: "duplicate" })).toBe(false);
  });

  it("surfaces the real message from plain Supabase error objects instead of a generic fallback", () => {
    const checkViolation = { code: "23514", message: 'new row for relation "organization_settings" violates check constraint "organization_settings_company_name_check"' };
    expect(friendlyError(checkViolation, "Settings could not be saved.")).toBe(checkViolation.message);
    expect(friendlyError({ code: "23505", message: "duplicate key value" }, "Fallback.")).toBe("duplicate key value");
    expect(friendlyError({}, "Fallback.")).toBe("Fallback.");
    expect(friendlyError(null, "Fallback.")).toBe("Fallback.");
  });

  it("detects permission denials", () => {
    expect(isPermissionError({ code: "42501", message: "x" })).toBe(true);
    expect(isPermissionError(new Error("new row violates row-level security policy"))).toBe(true);
    expect(isPermissionError(new Error("other"))).toBe(false);
  });
});

describe("demo detection matches only seed markers", () => {
  it("flags seeded demo records", () => {
    expect(isDemoText("APEX_DEMO_V1: hello")).toBe(true);
    expect(isDemoCustomer({ name: "Apex Demo · Rahim", email: "x@y.com" })).toBe(true);
    expect(isDemoCustomer({ name: "Real Co", email: "real@example.test" })).toBe(true);
    expect(isDemoProduct({ sku: "DEMO-APX-001", name: "x" })).toBe(true);
  });

  it("never flags real business records", () => {
    expect(isDemoText("Need two licenses")).toBe(false);
    expect(isDemoCustomer({ name: "Rahim Trading", email: "rahim@example.com" })).toBe(false);
    expect(isDemoProduct({ sku: "APX-001", name: "Starter" })).toBe(false);
  });
});
