import { z } from "zod";
import { ROLES, type Role } from "@vendorguard/shared";

/**
 * SECURITY-CRITICAL MODULE.
 *
 * This is the single place tenant identity is allowed to enter the system.
 * Every service/repository call that touches tenant-owned data MUST derive
 * its tenantId from a RequestContext built here - NEVER from a request
 * body, query string, or path parameter supplied by the client.
 *
 * Production: RequestContext is built from a verified Entra ID JWT's
 * claims (see docs/authorization-model.md, Phase 6/8 wiring in apps/api).
 * Development: RequestContext is built from the dev persona session
 * (packages/shared env.ts already fails closed if dev auth is enabled in
 * production - this module is the second, independent layer: even if dev
 * auth somehow ran in prod, it still cannot forge a tenant membership it
 * doesn't have a database row for).
 */

export const requestContextSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  role: z.enum(ROLES),
  correlationId: z.string().min(1),
});
export type RequestContext = z.infer<typeof requestContextSchema>;

/**
 * Minimal shape of a resolved TenantMembership row, as looked up by
 * (externalUserId, tenantId) - callers pass in a lookup function so this
 * module has no direct Prisma dependency (keeps packages/auth testable
 * without a database, and usable from both apps/api and apps/mcp-server).
 */
export interface TenantMembershipLookup {
  findMembership(args: {
    userExternalId: string;
    tenantId: string;
  }): Promise<{ userId: string; tenantId: string; role: Role } | null>;
}

export class TenantContextError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_MEMBERSHIP" | "TENANT_MISMATCH" | "INVALID_CLAIMS",
  ) {
    super(message);
    this.name = "TenantContextError";
  }
}

export interface AuthenticatedClaims {
  /** Subject from the verified JWT (production) or dev persona session (development). */
  externalUserId: string;
  /** Tenant the request is scoped to - e.g. from a required X-Tenant-Id header or a
   *  single-tenant claim, validated against a real membership below. This is an
   *  input to *look up* the membership, not itself trusted as authorization. */
  requestedTenantId: string;
  correlationId: string;
}

/**
 * Resolves a RequestContext from authenticated claims by looking up a real
 * TenantMembership row. This is the ONLY function that should ever produce
 * a RequestContext - if it throws, the caller must respond 403/404, never
 * fall back to a default tenant or an unscoped query.
 *
 * Critically: the role in the resulting context comes from the membership
 * row, never from the claims/session directly - a client cannot claim to
 * be ADMIN, only the database membership can grant that.
 */
export async function resolveRequestContext(
  claims: AuthenticatedClaims,
  memberships: TenantMembershipLookup,
): Promise<RequestContext> {
  if (!claims.externalUserId || !claims.requestedTenantId || !claims.correlationId) {
    throw new TenantContextError("Missing required claims fields", "INVALID_CLAIMS");
  }

  const membership = await memberships.findMembership({
    userExternalId: claims.externalUserId,
    tenantId: claims.requestedTenantId,
  });

  if (!membership) {
    throw new TenantContextError(
      `No active membership for this user in tenant ${claims.requestedTenantId}`,
      "NO_MEMBERSHIP",
    );
  }

  if (membership.tenantId !== claims.requestedTenantId) {
    // Defensive check: a lookup implementation bug should never silently
    // return a membership for a different tenant than was requested.
    throw new TenantContextError("Membership lookup returned a mismatched tenant", "TENANT_MISMATCH");
  }

  return requestContextSchema.parse({
    userId: membership.userId,
    tenantId: membership.tenantId,
    role: membership.role,
    correlationId: claims.correlationId,
  });
}

/**
 * Guard used by every repository/service function that accepts a
 * tenant-scoped record ID: confirms the record's own tenantId matches the
 * context's tenantId before returning/mutating it. Call this AFTER
 * fetching a record by ID and BEFORE returning it or applying a mutation -
 * never construct a query that trusts a client-supplied tenantId directly.
 */
export function assertOwnedByTenant(
  record: { tenantId: string } | null | undefined,
  context: RequestContext,
  resourceLabel = "resource",
): asserts record is { tenantId: string } {
  if (!record) {
    throw new TenantContextError(`${resourceLabel} not found`, "NO_MEMBERSHIP");
  }
  if (record.tenantId !== context.tenantId) {
    // Deliberately the same error shape as "not found" - see
    // docs/threat-model.md: cross-tenant existence should not be
    // distinguishable from non-existence via error messages/timing.
    throw new TenantContextError(`${resourceLabel} not found`, "TENANT_MISMATCH");
  }
}
