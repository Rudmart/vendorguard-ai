import { frameworkCatalogEntrySchema, type FrameworkCatalogEntry } from "./types.js";

/**
 * The full framework catalog for VendorGuard AI, covering both:
 *   - what vendors get assessed against (VENDOR_ASSESSMENT)
 *   - what secures the platform itself (PLATFORM_SECURITY)
 *
 * See docs/frameworks.md for the narrative version of this table and
 * docs/threat-model.md for how PLATFORM_SECURITY entries are actually
 * enforced (they are not seeded controls - see types.ts).
 */
export const FRAMEWORK_CATALOG: readonly FrameworkCatalogEntry[] = [
  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — ACTIVE (seeded now)
  // ---------------------------------------------------------------------
  {
    id: "nist-csf-2.0",
    name: "NIST Cybersecurity Framework",
    version: "2.0",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose: "General-purpose cyber posture baseline applied to every active vendor.",
    industries: ["GENERAL"],
    seededControlCount: 15,
    sourceUrl: "https://www.nist.gov/cyberframework",
    notes: "Demonstration subset - not full framework coverage.",
  },
  {
    id: "iso-27001-2022",
    name: "ISO/IEC 27001:2022",
    version: "2022",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose: "ISMS control catalog; strong mapping target for SOC 2 / ISO certificate evidence.",
    industries: ["GENERAL"],
    seededControlCount: 12,
    sourceUrl: "https://www.iso.org/standard/27001",
    notes: "Control identifiers and original implementation summaries only - no reproduced standards text.",
  },
  {
    id: "nist-ai-rmf",
    name: "NIST AI Risk Management Framework",
    version: "1.0",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose: "Applied when a vendor record has aiFunctionality=true; covers model governance, not just infosec.",
    industries: ["GENERAL"],
    seededControlCount: 12,
    sourceUrl: "https://www.nist.gov/itl/ai-risk-management-framework",
    notes: "Demonstration subset across Map/Measure/Manage functions.",
  },
  {
    id: "nist-800-161",
    name: "NIST SP 800-161r1 (Cyber Supply Chain Risk Management)",
    version: "Rev. 1",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose:
      "The framework written specifically for third-party/supply-chain risk, as opposed to general " +
      "cyber posture. Added to make the assessment content actually TPRM-shaped: covers supplier " +
      "due diligence, contractual flow-down of security requirements, fourth-party visibility, and " +
      "supply-chain incident response - the parts CSF/ISO 27001 only touch tangentially.",
    industries: ["GENERAL"],
    seededControlCount: 12,
    sourceUrl: "https://csrc.nist.gov/pubs/sp/800/161/r1/final",
    notes: "Demonstration subset; added in this session per product decision to prioritize C-SCRM content.",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — ACTIVE, BANKING_FINANCIAL (seeded now: this build
  // targets banks and financial services tenants, so these apply to every
  // vendor for a BANKING_FINANCIAL tenant the same way the four GENERAL
  // frameworks above apply to everyone)
  // ---------------------------------------------------------------------
  {
    id: "ffiec-outsourcing",
    name: "FFIEC IT Examination Handbook — Third-Party Relationships",
    version: "2021 (interagency guidance update)",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose:
      "The primary U.S. banking-regulator framework for third-party risk management, issued jointly " +
      "by OCC/Fed/FDIC. Covers the full vendor lifecycle a bank examiner will look for: planning, due " +
      "diligence, contract negotiation, ongoing monitoring, and termination. This is the framework a " +
      "bank's TPRM program is actually examined against, so it is seeded as ACTIVE rather than " +
      "conditional for BANKING_FINANCIAL tenants.",
    industries: ["BANKING_FINANCIAL"],
    seededControlCount: 12,
    sourceUrl: "https://ithandbook.ffiec.gov/",
    notes: "Demonstration subset; added for financial-services/banking product focus.",
  },
  {
    id: "glba-safeguards",
    name: "GLBA Safeguards Rule",
    version: "16 CFR Part 314 (2021 revision)",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose:
      "Requires financial institutions to ensure service providers safeguard nonpublic personal " +
      "information (NPI). Distinct from FFIEC's process-oriented guidance - GLBA is the substantive " +
      "data-protection obligation that flows down to vendors handling customer financial data.",
    industries: ["BANKING_FINANCIAL"],
    seededControlCount: 10,
    sourceUrl: "https://www.ftc.gov/legal-library/browse/rules/safeguards-rule",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — ACTIVE, HEALTHCARE
  // ---------------------------------------------------------------------
  {
    id: "nist-800-66",
    name: "NIST SP 800-66 (HIPAA Security Rule Implementation Guide)",
    version: "Rev. 2",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose:
      "NIST's implementation guidance for the HIPAA Security Rule - more actionable for control-level " +
      "assessment than HIPAA's statutory text itself, and the natural ACTIVE baseline for every vendor " +
      "of a HEALTHCARE tenant, the same way FFIEC guidance is ACTIVE for BANKING_FINANCIAL tenants. " +
      "HIPAA/HITRUST itself stays CONDITIONAL below, triggered specifically by PHI handling, since not " +
      "every vendor of a healthcare tenant touches PHI directly (e.g. a facilities vendor).",
    industries: ["HEALTHCARE"],
    seededControlCount: 10,
    sourceUrl: "https://csrc.nist.gov/pubs/sp/800/66/r2/final",
    notes: "Demonstration subset; added for healthcare product focus.",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — ACTIVE, cross-sector (BANKING_FINANCIAL + HEALTHCARE)
  // Operational resilience matters to both regulated sectors identically.
  // ---------------------------------------------------------------------
  {
    id: "iso-22301",
    name: "ISO 22301 (Business Continuity Management)",
    version: "2019",
    scope: "VENDOR_ASSESSMENT",
    status: "ACTIVE",
    purpose:
      "Operational-resilience baseline: both bank examiners and healthcare regulators expect vendors " +
      "supporting critical functions to demonstrate tested continuity capability, not just a written " +
      "plan (this overlaps with, but is more rigorous than, NIST 800-161's C-SCRM-9 continuity control).",
    industries: ["BANKING_FINANCIAL", "HEALTHCARE"],
    seededControlCount: 8,
    sourceUrl: "https://www.iso.org/standard/75106.html",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — CONDITIONAL, BANKING_FINANCIAL
  // ---------------------------------------------------------------------
  {
    id: "nydfs-500",
    name: "NYDFS Cybersecurity Regulation (23 NYCRR 500)",
    version: "2023 amendment",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Applies to vendors of institutions licensed/regulated by New York State (banks, insurers, etc).",
    industries: ["BANKING_FINANCIAL"],
    activationTriggers: ["Tenant.industry == 'BANKING_FINANCIAL' AND Tenant.nydfsRegulated == true"],
    seededControlCount: 0,
    sourceUrl: "https://www.dfs.ny.gov/system/files/documents/2023/04/rf_23_nycrr_500_amend2_final.pdf",
  },
  {
    id: "swift-csp",
    name: "SWIFT Customer Security Programme (CSP)",
    version: "2025 CSCF",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Applies specifically to vendors that touch SWIFT payment messaging infrastructure.",
    industries: ["BANKING_FINANCIAL"],
    activationTriggers: ["Vendor.processesSwiftMessaging == true"],
    seededControlCount: 0,
    sourceUrl: "https://www.swift.com/myswift/customer-security-programme-csp",
  },
  {
    id: "basel-outsourcing",
    name: "Basel Committee Principles for Operational Resilience & Outsourcing",
    version: "2021",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Relevant for internationally active or systemically important banks with cross-border vendor relationships.",
    industries: ["BANKING_FINANCIAL"],
    activationTriggers: ["Tenant.industry == 'BANKING_FINANCIAL' AND Tenant.baselTier IN ('D-SIB','G-SIB')"],
    seededControlCount: 0,
    sourceUrl: "https://www.bis.org/bcbs/publ/d516.htm",
  },
  {
    id: "sox-icfr",
    name: "SOX Internal Controls over Financial Reporting (vendor-facing)",
    version: "Sarbanes-Oxley Section 404",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Applies when a vendor's system materially affects the tenant's financial reporting (e.g. GL/ERP processors).",
    industries: ["BANKING_FINANCIAL"],
    activationTriggers: ["Vendor.affectsFinancialReporting == true AND Tenant.isPubliclyTraded == true"],
    seededControlCount: 0,
    sourceUrl: "https://www.sec.gov/about/laws/soa2002.pdf",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — CONDITIONAL, HEALTHCARE
  // ---------------------------------------------------------------------
  {
    id: "fda-medical-device-cyber",
    name: "FDA Premarket/Postmarket Cybersecurity Guidance (Medical Devices)",
    version: "2023 premarket guidance",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Applies to vendors supplying networked or software-based medical devices.",
    industries: ["HEALTHCARE"],
    activationTriggers: ["Vendor.category == 'MEDICAL_DEVICE'"],
    seededControlCount: 0,
    sourceUrl: "https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cybersecurity-medical-devices-quality-system-considerations-and-content-premarket-submissions",
  },
  {
    id: "42-cfr-part-2",
    name: "42 CFR Part 2 (Substance Use Disorder Records)",
    version: "2024 revision",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Stricter confidentiality requirements than HIPAA alone for vendors handling substance-use treatment records.",
    industries: ["HEALTHCARE"],
    activationTriggers: ["Vendor.dataClassifications includes 'SUBSTANCE_USE_RECORDS'"],
    seededControlCount: 0,
    sourceUrl: "https://www.ecfr.gov/current/title-42/chapter-I/subchapter-A/part-2",
  },
  {
    id: "cms-regulations",
    name: "CMS Regulations (Medicare/Medicaid vendor requirements)",
    version: "2024",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Applies to vendors processing claims or data for Medicare/Medicaid-participating providers.",
    industries: ["HEALTHCARE"],
    activationTriggers: ["Vendor.processesMedicareMedicaidClaims == true"],
    seededControlCount: 0,
    sourceUrl: "https://www.cms.gov/regulations-and-guidance",
  },

  // ---------------------------------------------------------------------
  // VENDOR_ASSESSMENT — CONDITIONAL (schema-modeled now, seeded later,
  // only when a real vendor's fields trigger them)
  // ---------------------------------------------------------------------
  {
    id: "iso-27036",
    name: "ISO/IEC 27036 (Supplier Relationship Security)",
    version: "2021-2022 parts",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "ISO's supplier-relationship security series, complementary to 27001 and 800-161.",
    activationTriggers: [
      "Vendor already has an active ISO 27001 assessment and procurement wants ISO-only mappings",
    ],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://www.iso.org/standard/59648.html",
  },
  {
    id: "shared-assessments-sig",
    name: "Shared Assessments SIG",
    version: "SIG 2024",
    scope: "VENDOR_ASSESSMENT",
    status: "DEFERRED",
    purpose: "Industry-standard vendor questionnaire many TPRM teams already map to.",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    notes: "DEFERRED not CONDITIONAL: requires a licensing/usage decision before any content can be seeded.",
  },
  {
    id: "csa-caiq",
    name: "CSA CAIQ / Cloud Controls Matrix",
    version: "CCM v4",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Cloud-vendor-specific assessment standard.",
    activationTriggers: ["Vendor.serviceCategory == 'Cloud/SaaS'"],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://cloudsecurityalliance.org/research/cloud-controls-matrix",
  },
  {
    id: "pci-dss",
    name: "PCI DSS",
    version: "4.0.1",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Only relevant when a vendor touches cardholder data.",
    activationTriggers: ["Vendor.dataClassifications includes 'PAYMENT_CARD'"],
    industries: ["GENERAL", "BANKING_FINANCIAL"],
    seededControlCount: 0,
    sourceUrl: "https://www.pcisecuritystandards.org/document_library",
  },
  {
    id: "hipaa-hitrust",
    name: "HIPAA / HITRUST CSF",
    version: "HITRUST CSF v11",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Only relevant when a vendor touches protected health information.",
    activationTriggers: ["Vendor.dataClassifications includes 'PHI'"],
    industries: ["HEALTHCARE"],
    seededControlCount: 0,
    sourceUrl: "https://hitrustalliance.net/product-tool/hitrust-csf",
  },
  {
    id: "fedramp-800-53",
    name: "FedRAMP (NIST SP 800-53 vendor-facing baseline)",
    version: "Rev. 5",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Only relevant when a vendor is a CSP serving a regulated/government customer.",
    activationTriggers: ["Vendor.serviceCategory == 'Cloud/SaaS' AND Vendor.servesGovernmentCustomers == true"],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://www.fedramp.gov/documents-templates/",
  },
  {
    id: "iso-42001",
    name: "ISO/IEC 42001 (AI Management System)",
    version: "2023",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose:
      "Assesses whether a vendor has an AI governance *process* (accountability, lifecycle controls, " +
      "impact assessment), complementing NIST AI RMF's outcome-based subcategories.",
    activationTriggers: ["Vendor.aiFunctionality == true"],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://www.iso.org/standard/81230.html",
  },
  {
    id: "eu-ai-act",
    name: "EU AI Act risk classification",
    version: "Regulation (EU) 2024/1689",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose:
      "Not a control checklist - a risk-classification field (prohibited / high-risk / limited / minimal) " +
      "applied to AI vendors serving EU users or EU-based customers.",
    activationTriggers: [
      "Vendor.aiFunctionality == true AND (Vendor.processingLocations includes an EU state OR tenant operates in EU)",
    ],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://artificialintelligenceact.eu/",
  },
  {
    id: "owasp-llm-top10-vendor",
    name: "OWASP LLM Top 10 (applied to a vendor's AI product)",
    version: "2025",
    scope: "VENDOR_ASSESSMENT",
    status: "CONDITIONAL",
    purpose: "Questionnaire/control lens for assessing a vendor's own LLM-based product, not our platform.",
    activationTriggers: ["Vendor.aiFunctionality == true AND Vendor.aiProductType == 'GENERATIVE'"],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://genai.owasp.org/llm-top-10/",
  },
  {
    id: "mitre-atlas-vendor",
    name: "MITRE ATLAS (applied to a vendor's AI system)",
    version: "2025",
    scope: "VENDOR_ASSESSMENT",
    status: "DEFERRED",
    purpose: "Adversarial ML threat catalog to inform deeper AI-vendor questionnaire design.",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://atlas.mitre.org/",
    notes: "DEFERRED: most valuable as questionnaire-design input, not automated scoring; revisit after several AI vendors are onboarded.",
  },

  // ---------------------------------------------------------------------
  // PLATFORM_SECURITY — how VendorGuard AI itself is built (never seeded
  // as vendor-facing controls; enforced via engineering practice + CI)
  // ---------------------------------------------------------------------
  {
    id: "owasp-api-top10",
    name: "OWASP API Security Top 10",
    version: "2023",
    scope: "PLATFORM_SECURITY",
    status: "ACTIVE",
    purpose: "Applied now to apps/api design: authz on every route, object-level access control, rate limiting.",
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://owasp.org/API-Security/editions/2023/en/0x00-header/",
  },
  {
    id: "owasp-web-top10",
    name: "OWASP Top 10 (Web Application)",
    version: "2021",
    scope: "PLATFORM_SECURITY",
    status: "ACTIVE",
    purpose: "Applied now to apps/web: XSS/CSRF prevention, secure headers, auth handling.",
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://owasp.org/Top10/",
  },
  {
    id: "owasp-llm-top10-platform",
    name: "OWASP LLM Top 10 (applied to our own assistant)",
    version: "2025",
    scope: "PLATFORM_SECURITY",
    status: "ACTIVE",
    purpose: "Directly targeted by the prompt-injection defenses in packages/ai-client and apps/mcp-server.",
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://genai.owasp.org/llm-top-10/",
  },
  {
    id: "nist-800-53",
    name: "NIST SP 800-53",
    version: "Rev. 5",
    scope: "PLATFORM_SECURITY",
    status: "DEFERRED",
    purpose: "Control baseline the platform could be formally assessed against later (e.g. moderate baseline).",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final",
    notes: "Referenced narratively in docs/threat-model.md now; full control-by-control mapping deferred until pursuing a formal ATO-style assessment.",
  },
  {
    id: "mitre-attack",
    name: "MITRE ATT&CK",
    version: "v16",
    scope: "PLATFORM_SECURITY",
    status: "DEFERRED",
    purpose: "Threat modeling for platform infrastructure (Azure, containers, CI/CD).",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://attack.mitre.org/",
    notes: "Referenced narratively in docs/threat-model.md; full technique-to-mitigation mapping deferred until detection/logging maturity supports it.",
  },
  {
    id: "mitre-atlas-platform",
    name: "MITRE ATLAS (applied to our own RAG/MCP pipeline)",
    version: "2025",
    scope: "PLATFORM_SECURITY",
    status: "DEFERRED",
    purpose: "Threat modeling for the platform's own AI attack surface.",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://atlas.mitre.org/",
  },
  {
    id: "iso-42001-platform",
    name: "ISO/IEC 42001 (governance of our own AI assistant)",
    version: "2023",
    scope: "PLATFORM_SECURITY",
    status: "DEFERRED",
    purpose: "Documenting an AI management system around VendorGuard AI's own assistant feature.",
    activationTriggers: [],
    industries: ["GENERAL"],
    seededControlCount: 0,
    sourceUrl: "https://www.iso.org/standard/81230.html",
    notes: "Meaningful once the assistant feature (Phase 6) is fully built.",
  },
].map((entry) => frameworkCatalogEntrySchema.parse(entry));

export function getFrameworkCatalogEntry(id: string): FrameworkCatalogEntry | undefined {
  return FRAMEWORK_CATALOG.find((f) => f.id === id);
}

export function listByScope(scope: FrameworkCatalogEntry["scope"]): FrameworkCatalogEntry[] {
  return FRAMEWORK_CATALOG.filter((f) => f.scope === scope);
}

export function listByStatus(status: FrameworkCatalogEntry["status"]): FrameworkCatalogEntry[] {
  return FRAMEWORK_CATALOG.filter((f) => f.status === status);
}

export function listByIndustry(industry: FrameworkCatalogEntry["industries"][number]): FrameworkCatalogEntry[] {
  return FRAMEWORK_CATALOG.filter((f) => f.industries.includes(industry));
}

/**
 * Frameworks that should currently appear seeded in the Framework Explorer
 * for a tenant in the given industry. GENERAL frameworks always appear;
 * BANKING_FINANCIAL/HEALTHCARE-tagged ACTIVE frameworks only appear for a
 * tenant actually in that vertical - a healthcare tenant should never see
 * FFIEC seeded as if every vendor is examined against it.
 */
export function listActiveVendorAssessmentFrameworks(
  industry: FrameworkCatalogEntry["industries"][number] = "GENERAL",
): FrameworkCatalogEntry[] {
  return FRAMEWORK_CATALOG.filter(
    (f) =>
      f.scope === "VENDOR_ASSESSMENT" &&
      f.status === "ACTIVE" &&
      (f.industries.includes("GENERAL") || f.industries.includes(industry)),
  );
}
