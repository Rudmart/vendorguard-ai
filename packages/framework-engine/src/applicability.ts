import { z } from "zod";
import { FRAMEWORK_CATALOG, listActiveVendorAssessmentFrameworks } from "./catalog.js";
import type { FrameworkCatalogEntry, IndustryVertical } from "./types.js";

/**
 * Minimal vendor-profile shape needed to resolve framework applicability.
 * This intentionally mirrors a subset of the Vendor entity fields from
 * spec section 9 (intake) rather than importing the Prisma client, so
 * framework-engine has no dependency on the database package.
 */
export const vendorApplicabilityProfileSchema = z.object({
  serviceCategory: z.string().optional(),
  category: z.string().optional(),
  dataClassifications: z.array(z.string()).default([]),
  aiFunctionality: z.boolean().default(false),
  aiProductType: z.enum(["GENERATIVE", "PREDICTIVE", "ML", "AGENT", "NONE"]).default("NONE"),
  servesGovernmentCustomers: z.boolean().default(false),
  processingLocations: z.array(z.string()).default([]),
  processesSwiftMessaging: z.boolean().default(false),
  affectsFinancialReporting: z.boolean().default(false),
  processesMedicareMedicaidClaims: z.boolean().default(false),
});
export type VendorApplicabilityProfile = z.infer<typeof vendorApplicabilityProfileSchema>;

/**
 * Tenant-level context needed for tenant-scoped triggers (NYDFS, Basel
 * tiering, SOX) that don't depend on any single vendor's fields.
 */
export const tenantApplicabilityProfileSchema = z.object({
  industry: z.enum(["GENERAL", "BANKING_FINANCIAL", "HEALTHCARE"]).default("GENERAL"),
  operatesInEu: z.boolean().default(false),
  nydfsRegulated: z.boolean().default(false),
  baselTier: z.enum(["NONE", "D-SIB", "G-SIB"]).default("NONE"),
  isPubliclyTraded: z.boolean().default(false),
});
export type TenantApplicabilityProfile = z.infer<typeof tenantApplicabilityProfileSchema>;

const EU_MEMBER_STATE_CODES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Structured predicate evaluators for each CONDITIONAL framework's
 * activation trigger. Kept as an explicit switch (rather than a generic
 * rule DSL) so every condition is readable and testable on its own -
 * this is intentionally simple for the MVP; a rule engine can replace it
 * later without changing this function's public contract.
 */
function evaluateConditionalTrigger(
  frameworkId: string,
  vendor: VendorApplicabilityProfile,
  tenant: TenantApplicabilityProfile,
): boolean {
  switch (frameworkId) {
    case "csa-caiq":
      return vendor.serviceCategory === "Cloud/SaaS";
    case "pci-dss":
      return vendor.dataClassifications.includes("PAYMENT_CARD");
    case "hipaa-hitrust":
      return vendor.dataClassifications.includes("PHI");
    case "fedramp-800-53":
      return vendor.serviceCategory === "Cloud/SaaS" && vendor.servesGovernmentCustomers;
    case "iso-42001":
      return vendor.aiFunctionality;
    case "eu-ai-act": {
      const vendorInEu = vendor.processingLocations.some((loc) => EU_MEMBER_STATE_CODES.has(loc));
      return vendor.aiFunctionality && (vendorInEu || tenant.operatesInEu);
    }
    case "owasp-llm-top10-vendor":
      return vendor.aiFunctionality && vendor.aiProductType === "GENERATIVE";
    case "iso-27036":
      // Requires an existing ISO 27001 assessment relationship - not
      // resolvable from vendor fields alone; left false until Phase 4's
      // assessment-history lookup exists. See ROADMAP.md.
      return false;

    // --- Banking / financial tenant-scoped and vendor-scoped triggers ---
    case "nydfs-500":
      return tenant.industry === "BANKING_FINANCIAL" && tenant.nydfsRegulated;
    case "swift-csp":
      return vendor.processesSwiftMessaging;
    case "basel-outsourcing":
      return tenant.industry === "BANKING_FINANCIAL" && tenant.baselTier !== "NONE";
    case "sox-icfr":
      return vendor.affectsFinancialReporting && tenant.isPubliclyTraded;

    // --- Healthcare vendor-scoped triggers ---
    case "fda-medical-device-cyber":
      return vendor.category === "MEDICAL_DEVICE";
    case "42-cfr-part-2":
      return vendor.dataClassifications.includes("SUBSTANCE_USE_RECORDS");
    case "cms-regulations":
      return vendor.processesMedicareMedicaidClaims;

    default:
      return false;
  }
}

export interface ApplicableFrameworkResult {
  framework: FrameworkCatalogEntry;
  reason: "always-active" | "industry-active" | "trigger-matched";
}

/**
 * Resolves which frameworks apply to a given vendor within a given
 * tenant's industry context:
 *  - GENERAL ACTIVE frameworks always apply.
 *  - Industry-tagged ACTIVE frameworks (FFIEC, GLBA, NIST 800-66, ISO
 *    22301) apply only when the tenant's industry matches.
 *  - CONDITIONAL frameworks apply when their trigger predicate matches
 *    this vendor's fields and/or the tenant's context.
 *  - DEFERRED frameworks never apply until promoted to ACTIVE or
 *    CONDITIONAL.
 */
export function resolveApplicableFrameworks(
  vendor: VendorApplicabilityProfile,
  tenant: Partial<TenantApplicabilityProfile> = {},
): ApplicableFrameworkResult[] {
  const parsedVendor = vendorApplicabilityProfileSchema.parse(vendor);
  const parsedTenant = tenantApplicabilityProfileSchema.parse(tenant);

  const results: ApplicableFrameworkResult[] = [];

  for (const framework of FRAMEWORK_CATALOG) {
    if (framework.scope !== "VENDOR_ASSESSMENT") continue;

    if (framework.status === "ACTIVE") {
      if (framework.industries.includes("GENERAL")) {
        results.push({ framework, reason: "always-active" });
      } else if (framework.industries.includes(parsedTenant.industry)) {
        results.push({ framework, reason: "industry-active" });
      }
      continue;
    }

    if (framework.status === "CONDITIONAL") {
      const matched = evaluateConditionalTrigger(framework.id, parsedVendor, parsedTenant);
      if (matched) results.push({ framework, reason: "trigger-matched" });
    }
    // DEFERRED frameworks are never returned.
  }

  return results;
}

/** Convenience wrapper for just listing what's seeded/active for an industry, ignoring vendor-level conditionals. */
export function listActiveFrameworksForIndustry(industry: IndustryVertical): FrameworkCatalogEntry[] {
  return listActiveVendorAssessmentFrameworks(industry);
}


/**
 * Minimal control shape needed to resolve requirement-level applicability.
 * Mirrors packages/database's Control model fields, passed in by the
 * caller (e.g. the API route) since framework-engine has no dependency
 * on the database package - see module comment above.
 */
export interface ApplicabilityControlInput {
  id: string;
  controlId: string;
  title: string;
  frameworkCatalogId: string;
}

export interface ApplicableRequirementResult {
  control: ApplicabilityControlInput;
  framework: FrameworkCatalogEntry;
  applicable: boolean;
  reason: string;
}

/**
 * Resolves requirement-level (per-Control) applicability by expanding
 * each applicable framework (per resolveApplicableFrameworks) into its
 * individual seeded controls. Every control under an applicable framework
 * is marked applicable with the SAME reasoning as its parent framework -
 * a deliberate simplification: no per-control condition is invented
 * beyond what resolveApplicableFrameworks already establishes, so every
 * "why" string traces back to a real, tested trigger rather than an
 * authored threshold. Purely additive - does not touch or replace the
 * existing manual framework-selection flow used at assessment creation.
 */
export function resolveApplicableRequirements(
  vendor: VendorApplicabilityProfile,
  controls: ApplicabilityControlInput[],
  tenant: Partial<TenantApplicabilityProfile> = {},
): ApplicableRequirementResult[] {
  const applicableFrameworks = resolveApplicableFrameworks(vendor, tenant);
  const applicableFrameworkIds = new Map(
    applicableFrameworks.map((r) => [r.framework.id, r]),
  );

  const results: ApplicableRequirementResult[] = [];
  for (const control of controls) {
    const match = applicableFrameworkIds.get(control.frameworkCatalogId);
    if (!match) continue;
    results.push({
      control,
      framework: match.framework,
      applicable: true,
      reason: reasonText(match.reason, match.framework),
    });
  }
  return results;
}

function reasonText(
  reason: ApplicableFrameworkResult["reason"],
  framework: FrameworkCatalogEntry,
): string {
  switch (reason) {
    case "always-active":
      return `Applies to all vendors - ${framework.name} is a general-purpose framework.`;
    case "industry-active":
      return `Applies because your organization operates in a regulated industry (${framework.industries.join(", ")}).`;
    case "trigger-matched":
      return `Applies because this vendor matches ${framework.name}'s activation trigger: ${framework.activationTriggers.join("; ")}.`;
  }
}
