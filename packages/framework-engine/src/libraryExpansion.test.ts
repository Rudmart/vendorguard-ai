import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { FRAMEWORK_CATALOG, getFrameworkCatalogEntry } from "./catalog.js";
import { resolveApplicableFrameworks } from "./applicability.js";
const ids = ["nist-800-53", "cis-controls-v8", "soc2-tsc", "pci-dss", "gdpr", "sox-icfr", "nist-800-218a"];
it("has one catalog entry and source-linked scoped library content for every approved addition", () => {
  for (const id of ids) {
    expect(FRAMEWORK_CATALOG.filter(f => f.id === id)).toHaveLength(1);
    const f = getFrameworkCatalogEntry(id)!;
    expect(f.scope).toBe("VENDOR_ASSESSMENT");
    expect(f.status).toBe("CONDITIONAL");
    const content = JSON.parse(readFileSync(resolve('../../frameworks', id, 'controls.json'), 'utf8'));
    expect(content.frameworkId).toBe(id);
    expect(content.controls.length).toBe(f.seededControlCount);
    expect(content.sourceUrl).toMatch(/^https:\/\//);
    expect(content.demonstrationSubsetDisclaimer).toMatch(/not.*compliance/i);
    expect(new Set(content.controls.map((c: {controlId: string}) => c.controlId)).size).toBe(content.controls.length);
  }
});
it("keeps generative AI secure-development content conditional rather than universally applicable", () => {
  const entries = (vendor: object) => resolveApplicableFrameworks(vendor as never).map(f => f.framework.id);
  expect(entries({ aiFunctionality: false, aiProductType: "NONE" })).not.toContain("nist-800-218a");
  expect(entries({ aiFunctionality: true, aiProductType: "PREDICTIVE" })).not.toContain("nist-800-218a");
  expect(entries({ aiFunctionality: true, aiProductType: "GENERATIVE" })).toContain("nist-800-218a");
});
it("retains conditional payment-card and SOX applicability without declaring compliance", () => {
  expect(getFrameworkCatalogEntry('pci-dss')?.status).toBe('CONDITIONAL');
  expect(getFrameworkCatalogEntry('sox-icfr')?.status).toBe('CONDITIONAL');
  const normal = resolveApplicableFrameworks({dataClassifications: [], aiFunctionality: false, aiProductType: 'NONE', processingLocations: [], servesGovernmentCustomers: false, processesSwiftMessaging: false, affectsFinancialReporting: false, processesMedicareMedicaidClaims: false});
  expect(normal.map(f=>f.framework.id)).not.toContain('pci-dss');
});
