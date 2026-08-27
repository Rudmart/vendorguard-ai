import { describe, expect, it } from "vitest";
import { resolveApplicableFrameworks, listActiveFrameworksForIndustry, resolveApplicableRequirements } from "./applicability.js";

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

describe("resolveApplicableFrameworks â€” GENERAL tenant", () => {
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

describe("resolveApplicableFrameworks â€” BANKING_FINANCIAL tenant", () => {
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

describe("resolveApplicableFrameworks â€” HEALTHCARE tenant", () => {
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


describe("resolveApplicableRequirements", () => {
  const sampleControls = [
    { id: "c1", controlId: "CSF-1", title: "Asset Management", frameworkCatalogId: "nist-csf-2.0" },
    { id: "c2", controlId: "ISO-1", title: "Access Control Policy", frameworkCatalogId: "iso-27001-2022" },
    { id: "c3", controlId: "AIRMF-1", title: "AI Governance Structure", frameworkCatalogId: "nist-ai-rmf" },
    { id: "c4", controlId: "ISO42-1", title: "AI Management System Scope", frameworkCatalogId: "iso-42001" },
    { id: "c5", controlId: "EUAI-1", title: "AI system risk classification", frameworkCatalogId: "eu-ai-act" },
    { id: "c6", controlId: "PCI-1", title: "Cardholder Data Encryption", frameworkCatalogId: "pci-dss" },
  ];

  it("returns requirements only for controls under frameworks that actually apply", () => {
    const results = resolveApplicableRequirements(baseVendor, sampleControls);
    const controlIds = results.map((r) => r.control.controlId).sort();
    // baseVendor: no AI, no payment card data -> only the 4 GENERAL ACTIVE frameworks' controls
    expect(controlIds).toEqual(["AIRMF-1", "CSF-1", "ISO-1"].sort());
  });

  it("is genuinely data-driven: changing vendor AI fields changes which requirements appear, without any code change", () => {
    const withoutAi = resolveApplicableRequirements(baseVendor, sampleControls);
    const withAi = resolveApplicableRequirements(
      { ...baseVendor, aiFunctionality: true, aiProductType: "GENERATIVE_AI" },
      sampleControls,
    );
    expect(withoutAi.some((r) => r.control.controlId === "ISO42-1")).toBe(false);
    expect(withAi.some((r) => r.control.controlId === "ISO42-1")).toBe(true);
  });

  it("is genuinely data-driven: EU AI Act requirement only appears when EU exposure trigger matches", () => {
    const noEu = resolveApplicableRequirements(
      { ...baseVendor, aiFunctionality: true, aiProductType: "GENERATIVE_AI" },
      sampleControls,
    );
    const withEu = resolveApplicableRequirements(
      { ...baseVendor, aiFunctionality: true, aiProductType: "GENERATIVE_AI" },
      sampleControls,
      { operatesInEu: true },
    );
    expect(noEu.some((r) => r.control.controlId === "EUAI-1")).toBe(false);
    expect(withEu.some((r) => r.control.controlId === "EUAI-1")).toBe(true);
  });

  it("every result includes a non-empty, real reason string tracing back to the framework trigger", () => {
    const results = resolveApplicableRequirements(baseVendor, sampleControls);
    for (const r of results) {
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.applicable).toBe(true);
    }
  });

  it("PCI-DSS control is excluded when the vendor has no payment card data classification", () => {
    const results = resolveApplicableRequirements(baseVendor, sampleControls);
    expect(results.some((r) => r.control.controlId === "PCI-1")).toBe(false);
  });

  it("PCI-DSS control appears once the vendor's data classification triggers it", () => {
    const results = resolveApplicableRequirements(
      { ...baseVendor, dataClassifications: ["PAYMENT_CARD"] },
      sampleControls,
    );
    expect(results.some((r) => r.control.controlId === "PCI-1")).toBe(true);
  });

  it("returns an empty array when given no controls", () => {
    expect(resolveApplicableRequirements(baseVendor, [])).toEqual([]);
  });
});
