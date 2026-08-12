import { roleHasPermission, RISK_ACCEPTANCE_ROLES, type Role } from "@vendorguard/shared";
import type { RequestContext } from "./tenant-context.js";

/**
 * Server-side authorization guard. A hidden button in the UI is NOT
 * authorization (spec §6) - every mutating or sensitive-read service
 * function must call one of these guards using the RequestContext
 * resolved by tenant-context.ts, never trust a role passed in a request
 * body.
 */

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly requiredPermission?: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Throws AuthorizationError if the context's role lacks the given permission. */
export function requirePermission(context: RequestContext, permission: string): void {
  if (!roleHasPermission(context.role, permission)) {
    throw new AuthorizationError(
      `Role ${context.role} does not have permission '${permission}'`,
      permission,
    );
  }
}

/** Throws AuthorizationError if the context's role is not one of the allowed roles. */
export function requireRole(context: RequestContext, allowedRoles: readonly Role[]): void {
  if (!allowedRoles.includes(context.role)) {
    throw new AuthorizationError(
      `Role ${context.role} is not permitted; requires one of: ${allowedRoles.join(", ")}`,
    );
  }
}

/**
 * Risk acceptance requires REVIEWER or ADMIN (spec §6, §10). This is
 * intentionally its own named guard, not just a requirePermission call,
 * because risk acceptance is also deliberately NOT exposed as an
 * autonomous MCP tool (spec §15) - keeping this guard distinct makes it
 * easy to grep for every place risk can be accepted and confirm a human
 * with the right role is always in the loop.
 */
export function requireRiskAcceptanceAuthority(context: RequestContext): void {
  requireRole(context, RISK_ACCEPTANCE_ROLES);
}

/**
 * Confirms a finding's review decision is being made by a role permitted
 * to review findings. Distinct from requireRiskAcceptanceAuthority because
 * accepting/rejecting/overriding a finding is a lower bar than accepting
 * portfolio risk (REVIEWER only, ADMIN implicitly via finding:* grant -
 * ANALYST can propose findings but not review its own proposals).
 */
export function requireFindingReviewAuthority(context: RequestContext): void {
  requirePermission(context, "finding:review");
}
