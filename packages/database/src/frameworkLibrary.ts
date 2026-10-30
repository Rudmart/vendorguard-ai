import type { Prisma } from "@prisma/client";
export type FrameworkLibraryInput = {
  frameworkId: string; frameworkName: string; version: string; sourceUrl: string; licenseNote: string; industries: string[];
  controls: { controlId: string; title: string; summary: string; domain: string; expectedEvidenceTypes: string[]; validationGuidance: string }[];
};
/** Administrative import only. Never called by an unauthenticated/public route. */
export async function syncFrameworkLibraryEntry(tx: Prisma.TransactionClient, input: FrameworkLibraryInput) {
  if (!/^[a-z0-9.-]+$/.test(input.frameworkId) || !input.frameworkName.trim() || !input.version.trim() || !input.licenseNote.trim() || !input.sourceUrl.startsWith("https://")) throw new Error("Invalid framework metadata");
  if (new Set(input.controls.map(c => c.controlId)).size !== input.controls.length) throw new Error("Duplicate source control identifiers");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"framework-library:" + input.frameworkId}, 0))`;
  const existing = await tx.framework.findUnique({ where: { catalogId: input.frameworkId } });
  if (existing?.tenantId) throw new Error("Refusing to overwrite a tenant-private framework");
  const f = await tx.framework.upsert({ where: { catalogId: input.frameworkId }, create: { catalogId: input.frameworkId, tenantId: null, name: input.frameworkName, scope: "VENDOR_ASSESSMENT", industries: input.industries }, update: { name: input.frameworkName, scope: "VENDOR_ASSESSMENT", industries: input.industries } });
  const version = await tx.frameworkVersion.upsert({ where: { frameworkId_version: { frameworkId: f.id, version: input.version } }, create: { frameworkId: f.id, version: input.version, sourceUrl: input.sourceUrl, licenseNote: input.licenseNote, isCurrent: true }, update: { sourceUrl: input.sourceUrl, licenseNote: input.licenseNote } });
  for (const c of input.controls) await tx.control.upsert({ where: { frameworkVersionId_controlId: { frameworkVersionId: version.id, controlId: c.controlId } }, create: { frameworkVersionId: version.id, ...c }, update: c });
  return { frameworkId: f.id, versionId: version.id, controls: input.controls.length };
}
