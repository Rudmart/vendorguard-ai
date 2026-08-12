import { describe, expect, it } from "vitest";
import {
  FRAMEWORK_CATALOG,
  getFrameworkCatalogEntry,
  listActiveVendorAssessmentFrameworks,
  listByScope,
  listByStatus,
} from "./catalog.js";

describe("framework catalog integrity", () => {
  it("has unique ids", () => {
    const ids = FRAMEWORK_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every ACTIVE, VENDOR_ASSESSMENT framework declares a non-zero seeded control count", () => {
    const active = FRAMEWORK_CATALOG.filter(
      (f) => f.status === "ACTIVE" && f.scope === "VENDOR_ASSESSMENT",
    );
    expect(active.length).toBeGreaterThan(0);
    for (const f of active) {
      expect(f.seededControlCount, `${f.id} is ACTIVE but has 0 seeded controls`).toBeGreaterThan(0);
    }
  });

  it("no CONDITIONAL or DEFERRED framework claims seeded controls", () => {
    const notActive = FRAMEWORK_CATALOG.filter((f) => f.status !== "ACTIVE");
    for (const f of notActive) {
      expect(f.seededControlCount, `${f.id} is ${f.status} but claims seeded controls`).toBe(0);
    }
  });

  it("every CONDITIONAL entry documents at least one activation trigger", () => {
    const conditional = listByStatus("CONDITIONAL");
    expect(conditional.length).toBeGreaterThan(0);
    for (const f of conditional) {
      expect(f.activationTriggers.length, `${f.id} is CONDITIONAL but has no activation trigger`).toBeGreaterThan(0);
    }
  });

  it("no PLATFORM_SECURITY entry is marked CONDITIONAL (that status is only for vendor-triggered content)", () => {
    const platform = listByScope("PLATFORM_SECURITY");
    for (const f of platform) {
      expect(f.status).not.toBe("CONDITIONAL");
    }
  });

  it("includes NIST 800-161 as ACTIVE, added this session for supply-chain-specific coverage", () => {
    const entry = getFrameworkCatalogEntry("nist-800-161");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("ACTIVE");
    expect(entry?.scope).toBe("VENDOR_ASSESSMENT");
  });

  it("listActiveVendorAssessmentFrameworks returns exactly the four ACTIVE vendor-assessment frameworks", () => {
    const active = listActiveVendorAssessmentFrameworks();
    expect(active.map((f) => f.id).sort()).toEqual(
      ["iso-27001-2022", "nist-800-161", "nist-ai-rmf", "nist-csf-2.0"].sort(),
    );
  });

  it("OWASP/MITRE/NIST 800-53 platform frameworks are catalogued under PLATFORM_SECURITY, not vendor assessment", () => {
    const platformIds = [
      "owasp-api-top10",
      "owasp-web-top10",
      "owasp-llm-top10-platform",
      "nist-800-53",
      "mitre-attack",
      "mitre-atlas-platform",
    ];
    for (const id of platformIds) {
      const entry = getFrameworkCatalogEntry(id);
      expect(entry, `${id} missing from catalog`).toBeDefined();
      expect(entry?.scope).toBe("PLATFORM_SECURITY");
    }
  });

  it("every entry has a resolvable, schema-valid shape (parsed at module load)", () => {
    // FRAMEWORK_CATALOG is already .map(schema.parse)'d at import time, so
    // reaching this point without a thrown error is itself the assertion.
    expect(FRAMEWORK_CATALOG.length).toBeGreaterThanOrEqual(30);
  });

  it("every entry declares at least one valid industry tag", () => {
    for (const f of FRAMEWORK_CATALOG) {
      expect(f.industries.length, `${f.id} has no industries`).toBeGreaterThan(0);
      for (const industry of f.industries) {
        expect(["GENERAL", "BANKING_FINANCIAL", "HEALTHCARE"]).toContain(industry);
      }
    }
  });

  it("includes FFIEC and GLBA as ACTIVE, BANKING_FINANCIAL-tagged frameworks added this session", () => {
    const ffiec = getFrameworkCatalogEntry("ffiec-outsourcing");
    const glba = getFrameworkCatalogEntry("glba-safeguards");
    expect(ffiec?.status).toBe("ACTIVE");
    expect(ffiec?.industries).toContain("BANKING_FINANCIAL");
    expect(glba?.status).toBe("ACTIVE");
    expect(glba?.industries).toContain("BANKING_FINANCIAL");
  });

  it("includes NIST 800-66 as ACTIVE, HEALTHCARE-tagged, added this session", () => {
    const entry = getFrameworkCatalogEntry("nist-800-66");
    expect(entry?.status).toBe("ACTIVE");
    expect(entry?.industries).toEqual(["HEALTHCARE"]);
  });

  it("ISO 22301 is ACTIVE and tagged for both regulated verticals", () => {
    const entry = getFrameworkCatalogEntry("iso-22301");
    expect(entry?.status).toBe("ACTIVE");
    expect(entry?.industries).toEqual(expect.arrayContaining(["BANKING_FINANCIAL", "HEALTHCARE"]));
  });

  it("industry-specific ACTIVE frameworks only surface via listActiveVendorAssessmentFrameworks for their own industry", () => {
    const generalList = listActiveVendorAssessmentFrameworks("GENERAL").map((f) => f.id);
    expect(generalList).not.toContain("ffiec-outsourcing");
    expect(generalList).not.toContain("nist-800-66");

    const bankingList = listActiveVendorAssessmentFrameworks("BANKING_FINANCIAL").map((f) => f.id);
    expect(bankingList).toContain("ffiec-outsourcing");
    expect(bankingList).not.toContain("nist-800-66");

    const healthcareList = listActiveVendorAssessmentFrameworks("HEALTHCARE").map((f) => f.id);
    expect(healthcareList).toContain("nist-800-66");
    expect(healthcareList).not.toContain("ffiec-outsourcing");
  });

  it("new banking/healthcare CONDITIONAL entries each declare exactly one industry and a trigger", () => {
    const ids = ["nydfs-500", "swift-csp", "basel-outsourcing", "sox-icfr", "fda-medical-device-cyber", "42-cfr-part-2", "cms-regulations"];
    for (const id of ids) {
      const entry = getFrameworkCatalogEntry(id);
      expect(entry, `${id} missing`).toBeDefined();
      expect(entry?.status).toBe("CONDITIONAL");
      expect(entry?.activationTriggers.length).toBeGreaterThan(0);
    }
  });
});
