import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prisma, syncFrameworkLibraryEntry } from "@vendorguard/database";
it("imports a scoped framework repeatedly without duplicate versions or controls", async () => {
  const id = `s8-test-library-${randomUUID()}`;
  const input = { frameworkId: id, frameworkName: "Disposable reference library", version: "1", sourceUrl: "https://csrc.nist.gov", licenseNote: "Original disposable fixture", industries: ["GENERAL"], controls: [{ controlId: "REF-1", title: "Reference", summary: "Fixture", domain: "Reference", expectedEvidenceTypes: [], validationGuidance: "Human review required" }] };
  try {
    await prisma.$transaction(tx => syncFrameworkLibraryEntry(tx, input));
    await prisma.$transaction(tx => syncFrameworkLibraryEntry(tx, input));
    const f = await prisma.framework.findUniqueOrThrow({ where: { catalogId: id }, include: { versions: { include: { controls: true } } } });
    expect(f.tenantId).toBeNull(); expect(f.versions).toHaveLength(1); expect(f.versions[0]!.controls).toHaveLength(1);
  } finally { await prisma.framework.deleteMany({ where: { catalogId: id } }); }
});
it("never converts a tenant-private catalog record into a global seed", async () => {
  const tenant = await prisma.tenant.create({ data: { name: "Private library import denial" } });
  const id = `s8-test-private-${randomUUID()}`;
  try {
    const row = await prisma.framework.create({ data: { catalogId: id, tenantId: tenant.id, name: "Private", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
    await expect(prisma.$transaction(tx => syncFrameworkLibraryEntry(tx, { frameworkId: id, frameworkName: "Global attempt", version: "1", sourceUrl: "https://csrc.nist.gov", licenseNote: "Fixture", industries: ["GENERAL"], controls: [] }))).rejects.toThrow();
    expect((await prisma.framework.findUniqueOrThrow({ where: { id: row.id } })).tenantId).toBe(tenant.id);
  } finally { await prisma.tenant.delete({ where: { id: tenant.id } }); }
});
