import { describe, expect, it } from "vitest";
import { resolveApplicableFrameworks, listActiveFrameworksForIndustry } from "./applicability.js";

const baseVendor = {
  serviceCategory: "Human Resources",
  dataClassifications: [] as string[],
  aiFunctionality: false,
  aiProductType: "NONE" as const,
  servesGovernmentCustomers: false,
  processingLocations: ["US"],
  processesSwiftMessaging: false,
  affectsFinancialReporting: false,
  processesMedicareMedicaidClaims: false,
};

describe("resolveApplicableFrameworks — GENERAL tenant", () => {
  it("always includes the four GENERAL ACTIVE frameworks, and no banking/healthcare frameworks", () => {
    const results = resolveApplicableFrameworks(baseVendor);
    const ids = results.map((r) => r.framework.id).sort();
    expect(ids).toEqual(["iso-27001-2022", "nist-800-161", "nist-ai-rmf", "nist-csf-2.0"].sort());
    expect(results.every((r) => r.reason === "always-active")).toBe(true);
  });

  it("activates PCI DSS when the vendor handles payment card data", () => {
    const results = resolveApplicableFrameworks({ ...baseVendor, dataClassifications: ["PAYMENT_CARD"] });
    expect(results.some((r) => r.framework.id === "pci-dss")).toBe(true);
  });

  it("activates HIPAA/HITRUST when the vendor handles PHI, regardless of tenant industry", () => {
    const results = resolveApplicableFrameworks({ ...baseVendor, dataClassifications: ["PHI"] });
    expect(results.some((r) => r.framework.id === "hipaa-hitrust")).toBe(true);
  });

  it("activates the EU AI Act when the tenant itself operates in the EU", () => {
    const results = resolveApplicableFrameworks(
      { ...baseVendor, aiFunctionality: true, aiProductType: "GENERATIVE_AI" },
      { operatesInEu: true },
    );
    expect(results.some((r) => r.framework.id === "eu-ai-act")).toBe(true);
  });

  it("never returns DEFERRED or PLATFORM_SECURITY frameworks", () => {
    const results = resolveApplicableFrameworks({
      ...baseVendor,
      aiFunctionality: true,
      aiProductType: "GENERATIVE_AI",
      dataClassifications: ["PAYMENT_CARD", "PHI"],
    });
    expect(results.some((r) => r.framework.id === "shared-assessments-sig")).toBe(false);
    expect(results.some((r) => r.framework.id === "mitre-atlas-vendor")).toBe(false);
    expect(results.some((r) => r.framework.scope === "PLATFORM_SECURITY")).toBe(false);
  });
});

describe("resolveApplicableFrameworks — BANKING_FINANCIAL tenant", () => {
  it("adds FFIEC, GLBA, and ISO 22301 as industry-active, on top of the four GENERAL frameworks", () => {
    const results = resolveApplicableFrameworks(baseVendor, { industry: "BANKING_FINANCIAL" });
    const ids = results.map((r) => r.framework.id);
    expect(ids).toEqual(
      expect.arrayContaining(["nist-csf-2.0", "iso-27001-2022", "nist-ai-rmf", "nist-800-161", "ffiec-outsourcing", "glba-safeguards", "iso-22301"]),
    );
    const ffiec = results.find((r) => r.framework.id === "ffiec-outsourcing");
    expect(ffiec?.reason).toBe("industry-active");
  });

  it("does NOT add FFIEC/GLBA for a GENERAL or HEALTHCARE tenant", () => {
    const general = resolveApplicableFrameworks(baseVendor);
    expect(general.some((r) => r.framework.id === "ffiec-outsourcing")).toBe(false);

    const healthcare = resolveApplicableFrameworks(baseVendor, { industry: "HEALTHCARE" });
    expect(healthcare.some((r) => r.framework.id === "ffiec-outsourcing")).toBe(false);
  });

  it("activates NYDFS only when the tenant is both BANKING_FINANCIAL and NYDFS-regulated", () => {
    const notRegulated = resolveApplicableFrameworks(baseVendor, { industry: "BANKING_FINANCIAL" });
    expect(notRegulated.some((r) => r.framework.id === "nydfs-500")).toBe(false);

    const regulated = resolveApplicableFrameworks(baseVendor, {
      industry: "BANKING_FINANCIAL",
      nydfsRegulated: true,
    });
    expect(regulated.some((r) => r.framework.id === "nydfs-500")).toBe(true);
  });

  it("activates SWIFT CSP based on the vendor field, independent of tenant industry", () => {
    const results = resolveApplicableFrameworks(
      { ...baseVendor, processesSwiftMessaging: true },
      { industry: "BANKING_FINANCIAL" },
    );
    expect(results.some((r) => r.framework.id === "swift-csp")).toBe(true);
  });

  it("activates Basel outsourcing principles only for D-SIB/G-SIB tier banks", () => {
    const noTier = resolveApplicableFrameworks(baseVendor, { industry: "BANKING_FINANCIAL", baselTier: "NONE" });
    expect(noTier.some((r) => r.framework.id === "basel-outsourcing")).toBe(false);

    const gsib = resolveApplicableFrameworks(baseVendor, { industry: "BANKING_FINANCIAL", baselTier: "G-SIB" });
    expect(gsib.some((r) => r.framework.id === "basel-outsourcing")).toBe(true);
  });

  it("activates SOX ICFR only when the vendor affects financial reporting AND the tenant is publicly traded", () => {
    const vendorOnly = resolveApplicableFrameworks(
      { ...baseVendor, affectsFinancialReporting: true },
      { industry: "BANKING_FINANCIAL", isPubliclyTraded: false },
    );
    expect(vendorOnly.some((r) => r.framework.id === "sox-icfr")).toBe(false);

    const both = resolveApplicableFrameworks(
      { ...baseVendor, affectsFinancialReporting: true },
      { industry: "BANKING_FINANCIAL", isPubliclyTraded: true },
    );
    expect(both.some((r) => r.framework.id === "sox-icfr")).toBe(true);
  });
});

describe("resolveApplicableFrameworks — HEALTHCARE tenant", () => {
  it("adds NIST 800-66 and ISO 22301 as industry-active, on top of the four GENERAL frameworks", () => {
    const results = resolveApplicableFrameworks(baseVendor, { industry: "HEALTHCARE" });
    const ids = results.map((r) => r.framework.id);
    expect(ids).toEqual(expect.arrayContaining(["nist-800-66", "iso-22301"]));
    expect(ids).not.toContain("ffiec-outsourcing");
  });

  it("activates FDA medical device guidance only for MEDICAL_DEVICE category vendors", () => {
    const nonDevice = resolveApplicableFrameworks(
      { ...baseVendor, category: "Software" },
      { industry: "HEALTHCARE" },
    );
    expect(nonDevice.some((r) => r.framework.id === "fda-medical-device-cyber")).toBe(false);

    const device = resolveApplicableFrameworks(
      { ...baseVendor, category: "MEDICAL_DEVICE" },
      { industry: "HEALTHCARE" },
    );
    expect(device.some((r) => r.framework.id === "fda-medical-device-cyber")).toBe(true);
  });

  it("activates 42 CFR Part 2 for substance-use records and CMS regulations for Medicare/Medicaid claims processing", () => {
    const results = resolveApplicableFrameworks(
      {
        ...baseVendor,
        dataClassifications: ["SUBSTANCE_USE_RECORDS"],
        processesMedicareMedicaidClaims: true,
      },
      { industry: "HEALTHCARE" },
    );
    expect(results.some((r) => r.framework.id === "42-cfr-part-2")).toBe(true);
    expect(results.some((r) => r.framework.id === "cms-regulations")).toBe(true);
  });
});

describe("listActiveFrameworksForIndustry", () => {
  it("returns 4 frameworks for GENERAL, 7 for BANKING_FINANCIAL, 6 for HEALTHCARE", () => {
    expect(listActiveFrameworksForIndustry("GENERAL")).toHaveLength(4);
    expect(listActiveFrameworksForIndustry("BANKING_FINANCIAL")).toHaveLength(7);
    expect(listActiveFrameworksForIndustry("HEALTHCARE")).toHaveLength(6);
  });

  it("BANKING_FINANCIAL and HEALTHCARE both include the shared ISO 22301 continuity framework", () => {
    const banking = listActiveFrameworksForIndustry("BANKING_FINANCIAL").map((f) => f.id);
    const healthcare = listActiveFrameworksForIndustry("HEALTHCARE").map((f) => f.id);
    expect(banking).toContain("iso-22301");
    expect(healthcare).toContain("iso-22301");
  });
});
