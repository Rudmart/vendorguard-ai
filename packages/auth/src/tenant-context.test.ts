import { describe, expect, it } from "vitest";
import {
  resolveRequestContext,
  assertOwnedByTenant,
  TenantContextError,
  type TenantMembershipLookup,
  type AuthenticatedClaims,
} from "./tenant-context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const USER_A = "33333333-3333-3333-3333-333333333333";

function fakeMemberships(rows: Array<{ userExternalId: string; tenantId: string; userId: string; role: "ADMIN" | "ANALYST" | "REVIEWER" | "AUDITOR" | "READ_ONLY" }>): TenantMembershipLookup {
  return {
    async findMembership({ userExternalId, tenantId }) {
      const row = rows.find((r) => r.userExternalId === userExternalId && r.tenantId === tenantId);
      return row ? { userId: row.userId, tenantId: row.tenantId, role: row.role } : null;
    },
  };
}

describe("resolveRequestContext", () => {
  const claims: AuthenticatedClaims = {
    externalUserId: "entra-oid-abc",
    requestedTenantId: TENANT_A,
    correlationId: "corr-1",
  };

  it("resolves a context from a real membership row, taking the role from the membership not the claims", async () => {
    const memberships = fakeMemberships([
      { userExternalId: "entra-oid-abc", tenantId: TENANT_A, userId: USER_A, role: "ANALYST" },
    ]);
    const ctx = await resolveRequestContext(claims, memberships);
    expect(ctx.tenantId).toBe(TENANT_A);
    expect(ctx.userId).toBe(USER_A);
    expect(ctx.role).toBe("ANALYST");
  });

  it("throws NO_MEMBERSHIP when the user has no row for the requested tenant (the core cross-tenant-access test)", async () => {
    const memberships = fakeMemberships([
      // User exists, but only has a membership in TENANT_B, not TENANT_A.
      { userExternalId: "entra-oid-abc", tenantId: TENANT_B, userId: USER_A, role: "ADMIN" },
    ]);
    await expect(resolveRequestContext(claims, memberships)).rejects.toThrow(TenantContextError);
    await expect(resolveRequestContext(claims, memberships)).rejects.toMatchObject({ code: "NO_MEMBERSHIP" });
  });

  it("throws NO_MEMBERSHIP for a user who doesn't exist in any tenant", async () => {
    const memberships = fakeMemberships([]);
    await expect(resolveRequestContext(claims, memberships)).rejects.toMatchObject({ code: "NO_MEMBERSHIP" });
  });

  it("throws INVALID_CLAIMS when required claim fields are missing", async () => {
    const memberships = fakeMemberships([
      { userExternalId: "entra-oid-abc", tenantId: TENANT_A, userId: USER_A, role: "ADMIN" },
    ]);
    await expect(
      resolveRequestContext({ ...claims, externalUserId: "" }, memberships),
    ).rejects.toMatchObject({ code: "INVALID_CLAIMS" });
    await expect(
      resolveRequestContext({ ...claims, requestedTenantId: "" }, memberships),
    ).rejects.toMatchObject({ code: "INVALID_CLAIMS" });
  });

  it("a user with memberships in BOTH tenants only ever resolves the tenant actually requested", async () => {
    const memberships = fakeMemberships([
      { userExternalId: "entra-oid-abc", tenantId: TENANT_A, userId: USER_A, role: "READ_ONLY" },
      { userExternalId: "entra-oid-abc", tenantId: TENANT_B, userId: USER_A, role: "ADMIN" },
    ]);
    const ctxA = await resolveRequestContext({ ...claims, requestedTenantId: TENANT_A }, memberships);
    expect(ctxA.tenantId).toBe(TENANT_A);
    expect(ctxA.role).toBe("READ_ONLY"); // NOT the ADMIN role from tenant B

    const ctxB = await resolveRequestContext({ ...claims, requestedTenantId: TENANT_B }, memberships);
    expect(ctxB.tenantId).toBe(TENANT_B);
    expect(ctxB.role).toBe("ADMIN");
  });
});

describe("assertOwnedByTenant", () => {
  const contextA = { userId: USER_A, tenantId: TENANT_A, role: "ADMIN" as const, correlationId: "c1" };

  it("passes silently when the record belongs to the context's tenant", () => {
    expect(() => assertOwnedByTenant({ tenantId: TENANT_A }, contextA, "Vendor")).not.toThrow();
  });

  it("throws when the record belongs to a different tenant (the fetch-then-check cross-tenant guard)", () => {
    expect(() => assertOwnedByTenant({ tenantId: TENANT_B }, contextA, "Vendor")).toThrow(TenantContextError);
  });

  it("throws with a 'not found' message for cross-tenant records, not a distinguishing 'forbidden' message", () => {
    try {
      assertOwnedByTenant({ tenantId: TENANT_B }, contextA, "Vendor");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TenantContextError);
      expect((err as TenantContextError).message).toMatch(/not found/i);
      expect((err as TenantContextError).message).not.toMatch(/forbidden|denied|another tenant/i);
    }
  });

  it("throws for a null/undefined record the same way as a cross-tenant record", () => {
    expect(() => assertOwnedByTenant(null, contextA, "Vendor")).toThrow(TenantContextError);
    expect(() => assertOwnedByTenant(undefined, contextA, "Vendor")).toThrow(TenantContextError);
  });
});
