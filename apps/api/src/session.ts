import type { FastifyRequest } from "fastify";
import { prisma } from "@vendorguard/database";
import { COOKIE_NAME, getSessionFromCookie } from "@vendorguard/auth";

/** Same shape the routes already use (userId, tenantId, email, displayName, role). */
export type ApiSession = NonNullable<ReturnType<typeof getSessionFromCookie>>;

/**
 * Database-authoritative API session (security fix, mirrors apps/mcp-server resolveMcpContext).
 *
 * 1. The signed cookie must verify (unchanged: unsigned, malformed or tampered cookies -> null -> 401).
 * 2. The signed (userId, tenantId) pair identifies the session context.
 * 3. The CURRENT TenantMembership for exactly that pair, and its User, are loaded from the database.
 *    Missing membership or user -> null -> 401. No fallback to another tenant.
 * 4. role, email and displayName come from the database - the cookie's copies are never used for authorization.
 *
 * Deliberately no caching: a cache could reintroduce stale authorization state.
 */
export async function resolveSession(request: FastifyRequest): Promise<ApiSession | null> {
  const signed = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!signed) {
    return null;
  }
  const membership = await prisma.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId: signed.tenantId, userId: signed.userId } },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });
  if (!membership || !membership.user) {
    return null;
  }
  return {
    userId: membership.user.id,
    tenantId: membership.tenantId,
    email: membership.user.email,
    displayName: membership.user.displayName,
    role: membership.role,
  };
}