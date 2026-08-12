import { z } from "zod";

/**
 * Framework-independent schema for vendor-assessment control frameworks
 * (NIST CSF 2.0, ISO 27001, NIST AI RMF, NIST 800-161, etc). This is what
 * a Framework/Control/ControlMapping look like once seeded into the DB.
 *
 * This is separate from the FRAMEWORK CATALOG below, which is metadata
 * about *which* frameworks exist, whether they're seeded, and when/why
 * they'd be turned on - the catalog exists so the product can say
 * "add this framework later" as a real, inspectable decision rather than
 * a prose promise.
 */

export const mappingStrengthSchema = z.enum(["EXACT", "PARTIAL", "RELATED"]);
export type MappingStrength = z.infer<typeof mappingStrengthSchema>;

export const controlSchema = z.object({
  frameworkId: z.string().min(1),
  version: z.string().min(1),
  controlId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  domain: z.string().min(1),
  parentControlId: z.string().nullable().default(null),
  expectedEvidenceTypes: z.array(z.string()).default([]),
  validationGuidance: z.string().min(1),
  sourceUrl: z.string().url(),
  licenseNote: z.string().min(1),
});
export type Control = z.infer<typeof controlSchema>;

export const controlMappingSchema = z.object({
  fromFrameworkId: z.string().min(1),
  fromControlId: z.string().min(1),
  toFrameworkId: z.string().min(1),
  toControlId: z.string().min(1),
  strength: mappingStrengthSchema,
  rationale: z.string().min(1),
});
export type ControlMapping = z.infer<typeof controlMappingSchema>;

/**
 * FRAMEWORK CATALOG
 *
 * `scope` distinguishes two very different kinds of framework a TPRM
 * product touches:
 *  - VENDOR_ASSESSMENT: content you assess *vendors* against (seeded as
 *    Framework/Control rows, shown in the Framework Explorer).
 *  - PLATFORM_SECURITY: frameworks that govern how *this application* is
 *    built and secured (OWASP Top 10s, MITRE ATT&CK/ATLAS, NIST 800-53).
 *    These never appear as seeded controls - they're referenced in
 *    docs/threat-model.md and enforced through engineering practice, CI
 *    security gates, and code review, not through the framework engine's
 *    data model.
 *
 * `status`:
 *  - ACTIVE: seeded now, controls exist under frameworks/<id>.
 *  - CONDITIONAL: not seeded by default; the applicability engine should
 *    only surface it when a vendor record matches `activationTriggers`
 *    (e.g. handlesCardholderData=true -> PCI DSS). Building a full control
 *    set for a framework nobody's vendor triggers wastes seed-maintenance
 *    effort, so conditional frameworks stay data-modeled but empty until
 *    a real vendor needs them.
 *  - DEFERRED: acknowledged as in-scope for a mature TPRM program, not
 *    scheduled; usually because it requires a licensing/usage decision
 *    (e.g. Shared Assessments SIG content) before any content can be
 *    seeded at all.
 */

export const frameworkScopeSchema = z.enum(["VENDOR_ASSESSMENT", "PLATFORM_SECURITY"]);
export type FrameworkScope = z.infer<typeof frameworkScopeSchema>;

export const frameworkStatusSchema = z.enum(["ACTIVE", "CONDITIONAL", "DEFERRED"]);
export type FrameworkStatus = z.infer<typeof frameworkStatusSchema>;

/**
 * Industry vertical a framework was written for. "GENERAL" frameworks
 * (NIST CSF 2.0, ISO 27001, NIST 800-161, NIST AI RMF) apply regardless
 * of tenant industry. "BANKING_FINANCIAL" and "HEALTHCARE" frameworks are
 * only meaningful for tenants operating in those regulated sectors -
 * a general SaaS TPRM tenant should never see FFIEC or HIPAA-specific
 * content by default.
 */
export const industryVerticalSchema = z.enum(["GENERAL", "BANKING_FINANCIAL", "HEALTHCARE"]);
export type IndustryVertical = z.infer<typeof industryVerticalSchema>;

export const frameworkCatalogEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  scope: frameworkScopeSchema,
  status: frameworkStatusSchema,
  purpose: z.string().min(1),
  /** Which industry vertical(s) this framework is relevant to. Most
   *  entries have exactly one; a few (e.g. ISO 22301) apply to more than
   *  one regulated sector. */
  industries: z.array(industryVerticalSchema).min(1).default(["GENERAL"]),
  /** Only meaningful when status === "CONDITIONAL". Human-readable trigger
   *  descriptions; the applicability engine (Phase 4 remainder) will turn
   *  these into structured Vendor-field predicates. */
  activationTriggers: z.array(z.string()).default([]),
  seededControlCount: z.number().int().min(0).default(0),
  sourceUrl: z.string().url().optional(),
  notes: z.string().optional(),
});
export type FrameworkCatalogEntry = z.infer<typeof frameworkCatalogEntrySchema>;
