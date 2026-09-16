/**
 * Shared domain constants. These mirror (but do not replace) the Prisma
 * schema enums so that non-database packages (risk-engine, ai-client,
 * mcp-server) can depend on them without importing the Prisma client.
 */

export const ROLES = ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"] as const;
export type Role = (typeof ROLES)[number];

export const RISK_BANDS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export const EVIDENCE_STATES = [
  "UPLOADED",
  "QUARANTINED",
  "SCANNING",
  "CLEAN",
  "REJECTED",
  "EXTRACTING",
  "INDEXED",
  "FAILED",
  "EXPIRED",
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const FINDING_STATUSES = [
  "PASS",
  "PARTIAL",
  "FAIL",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
  "NOT_APPLICABLE",
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const REVIEW_DECISIONS = [
  "ACCEPT",
  "REJECT",
  "OVERRIDE",
  "REQUEST_MORE_EVIDENCE",
  "NOT_APPLICABLE",
] as const;
export type ReviewDecisionType = (typeof REVIEW_DECISIONS)[number];

export const MAPPING_STRENGTHS = ["EXACT", "PARTIAL", "RELATED"] as const;
export type MappingStrength = (typeof MAPPING_STRENGTHS)[number];

/**
 * Controlled whitelist for AiSystem.dataCategories (Slice 1). Keeps values
 * consistent (e.g. never "PII" vs "Personal Information") without requiring
 * a migration every time the list grows, unlike a Prisma enum would.
 */
export const DATA_CATEGORIES = ["PII", "FINANCIAL", "HEALTH", "BIOMETRIC", "CHILDREN", "OTHER"] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

/**
 * Minimum role required to perform risk acceptance. Enforced server-side
 * in both the API and the MCP server (risk acceptance is intentionally
 * NOT exposed as an autonomous MCP tool at all - see docs/mcp-security.md).
 */
export const RISK_ACCEPTANCE_ROLES: readonly Role[] = ["ADMIN", "REVIEWER"];

/** Central role -> permitted actions map used by the authorization package. */
export const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  ADMIN: [
    "tenant:manage",
    "framework:manage",
    "vendor:*",
    "ai-system:*",
    "assessment:*",
    "finding:*",
    "questionnaire:review",
    "remediation:*",
    "risk:accept",
    "audit:read",
  ],
  ANALYST: [
    "vendor:create",
    "vendor:read",
    "vendor:update",
    "ai-system:create",
    "ai-system:read",
    "ai-system:update",
    "ai-system:link-vendor",
    "evidence:upload",
    "evidence:read",
    "assessment:create",
    "assessment:read",
    "finding:propose",
    "remediation:create",
    "remediation:read",
  ],
  REVIEWER: [
    "vendor:read",
    "ai-system:read",
    "assessment:read",
    "finding:read",
    "finding:review",
    "questionnaire:review",
    "remediation:read",
    "remediation:update",
    "risk:accept",
  ],
  AUDITOR: [
    "vendor:read",
    "ai-system:read",
    "assessment:read",
    "finding:read",
    "evidence:read-metadata",
    "audit:read",
    "remediation:read",
  ],
  READ_ONLY: ["vendor:read", "ai-system:read", "assessment:read", "finding:read"],
};

export function roleHasPermission(role: Role, permission: string): boolean {
  const grants = ROLE_PERMISSIONS[role];
  if (grants.includes(permission)) return true;
  const [resource] = permission.split(":");
  return grants.includes(`${resource}:*`);
}
