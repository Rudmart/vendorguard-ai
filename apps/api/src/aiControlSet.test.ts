import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let reviewerUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;

let fwId: string;
let fw2Id: string;
let fwBId: string;
let ctrlA: string;
let ctrlB: string;
let ctrlC: string;
let ctrlD: string;
let oldCtrl: string;
let fw2Ctrl: string;
let tenantBCtrl: string;
let librarySnapshotBefore: string;

const TEST_PREFIXES = ["m12-test-", "ra-test-fw-", "s8-test-"];

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

// Snapshot of every framework/version/control that is NOT a temporary test record.
async function librarySnapshot() {
  const frameworks = await prisma.framework.findMany({
    where: { AND: TEST_PREFIXES.map((prefix) => ({ NOT: { catalogId: { startsWith: prefix } } })) },
    orderBy: { catalogId: "asc" },
    include: { versions: { orderBy: { version: "asc" }, include: { controls: { orderBy: { controlId: "asc" } } } } },
  });
  return JSON.stringify(frameworks);
}

async function makeControl(frameworkVersionId: string, code: string) {
  const control = await prisma.control.create({
    data: {
      frameworkVersionId,
      controlId: code,
      title: `Test control ${code}`,
      summary: "Test",
      domain: "Test",
      expectedEvidenceTypes: [],
      validationGuidance: "n/a",
    },
  });
  return control.id;
}

async function createAiSystem(name = "S8 Test AI System") {
  const res = await server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    payload: { name, origin: "INTERNAL" },
  });
  return JSON.parse(res.body).id as string;
}

async function setApplicability(sysId: string, frameworkId: string, status: unknown, rationale: unknown = "Test rationale", role = "ANALYST", userId?: string, tenantId?: string) {
  return server.inject({
    method: "PUT", url: `/ai-systems/${sysId}/framework-applicability/${frameworkId}`,
    cookies: { vg_session: cookieFor(userId ?? analystUserId, role, tenantId ?? tenantAId) },
    payload: { status, rationale },
  });
}

async function mapControls(sysId: string, payload: unknown, role = "ANALYST", userId?: string, tenantId?: string) {
  return server.inject({
    method: "POST", url: `/ai-systems/${sysId}/controls`,
    cookies: { vg_session: cookieFor(userId ?? analystUserId, role, tenantId ?? tenantAId) },
    payload: payload as Record<string, unknown>,
  });
}

async function patchControl(recordId: string, payload: Record<string, unknown>, role = "ANALYST", userId?: string, tenantId?: string) {
  return server.inject({
    method: "PATCH", url: `/ai-system-controls/${recordId}`,
    cookies: { vg_session: cookieFor(userId ?? analystUserId, role, tenantId ?? tenantAId) },
    payload,
  });
}

async function getControlSet(sysId: string) {
  const res = await server.inject({
    method: "GET", url: `/ai-systems/${sysId}/controls`,
    cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

async function mappedRecord(sysId: string, controlId: string) {
  return prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId } } });
}

async function systemWithApplicableFramework() {
  const sysId = await createAiSystem();
  await setApplicability(sysId, fwId, "APPLICABLE", "Primary governance framework for this system");
  return sysId;
}

beforeAll(async () => {
  const stamp = Date.now();
  librarySnapshotBefore = await librarySnapshot();

  tenantAId = (await prisma.tenant.create({ data: { name: "S8 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S8 Test Tenant B" } })).id;

  const makeUser = async (label: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s8-${label}-${stamp}`, email: `s8-${label}-${stamp}@example.com`, displayName: `S8 ${label}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");

  const fw = await prisma.framework.create({ data: { catalogId: `s8-test-fw-${stamp}`, name: "S8 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const oldVersion = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "0.9", isCurrent: false } });
  const currentVersion = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  oldCtrl = await makeControl(oldVersion.id, "S8-OLD-1");
  ctrlA = await makeControl(currentVersion.id, "S8-1");
  ctrlB = await makeControl(currentVersion.id, "S8-2");
  ctrlC = await makeControl(currentVersion.id, "S8-3");
  ctrlD = await makeControl(currentVersion.id, "S8-4");

  const fw2 = await prisma.framework.create({ data: { catalogId: `s8-test-fw2-${stamp}`, name: "S8 Second Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fw2Id = fw2.id;
  const fw2Version = await prisma.frameworkVersion.create({ data: { frameworkId: fw2.id, version: "1.0", isCurrent: true } });
  fw2Ctrl = await makeControl(fw2Version.id, "S8B-1");

  const fwB = await prisma.framework.create({ data: { catalogId: `s8-test-fwb-${stamp}`, tenantId: tenantBId, name: "S8 Tenant B Private Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwBId = fwB.id;
  const fwBVersion = await prisma.frameworkVersion.create({ data: { frameworkId: fwB.id, version: "1.0", isCurrent: true } });
  tenantBCtrl = await makeControl(fwBVersion.id, "S8P-1");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpact.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemVendor.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.framework.deleteMany({ where: { id: { in: [fwId, fw2Id, fwBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("Framework applicability (human governance determination)", () => {
  it("records the status, rationale, who decided, and when, with an audit event", async () => {
    const sysId = await createAiSystem();
    const res = await setApplicability(sysId, fwId, "APPLICABLE", "Primary AI governance framework");
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("APPLICABLE");
    expect(body.rationale).toBe("Primary AI governance framework");
    expect(body.determinedByUserId).toBe(analystUserId);
    expect(body.determinedAt).toBeTruthy();
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_framework.applicability_set", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("requires a rationale for every determination, including NOT_APPLICABLE and PARTIALLY_APPLICABLE", async () => {
    const sysId = await createAiSystem();
    for (const status of ["APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE", "NEEDS_REVIEW"]) {
      expect((await setApplicability(sysId, fwId, status, "")).statusCode).toBe(400);
      expect((await setApplicability(sysId, fwId, status, null)).statusCode).toBe(400);
    }
    expect(await prisma.aiSystemFrameworkApplicability.count({ where: { aiSystemId: sysId } })).toBe(0);
  });

  it("rejects an invalid status", async () => {
    const sysId = await createAiSystem();
    expect((await setApplicability(sysId, fwId, "COMPLIANT")).statusCode).toBe(400);
  });

  it("updates a determination and audits the before and after values", async () => {
    const sysId = await createAiSystem();
    const first = JSON.parse((await setApplicability(sysId, fwId, "APPLICABLE")).body);
    const res = await setApplicability(sysId, fwId, "NEEDS_REVIEW", "Legal review requested");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("NEEDS_REVIEW");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_framework.applicability_changed", targetId: first.id } });
    const meta = event?.metadataJson as { from?: string; to?: string } | null;
    expect(meta?.from).toBe("APPLICABLE");
    expect(meta?.to).toBe("NEEDS_REVIEW");
  });

  it("keeps exactly one record per AI system and framework, enforced by the database", async () => {
    const sysId = await createAiSystem();
    await setApplicability(sysId, fwId, "APPLICABLE");
    await setApplicability(sysId, fwId, "PARTIALLY_APPLICABLE", "Only Govern functions apply");
    expect(await prisma.aiSystemFrameworkApplicability.count({ where: { aiSystemId: sysId, frameworkId: fwId } })).toBe(1);
    await expect(
      prisma.aiSystemFrameworkApplicability.create({
        data: { tenantId: tenantAId, aiSystemId: sysId, frameworkId: fwId, status: "APPLICABLE", rationale: "dup", determinedAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it("lets READ_ONLY read but blocks READ_ONLY and REVIEWER from deciding", async () => {
    const sysId = await createAiSystem();
    expect((await setApplicability(sysId, fwId, "APPLICABLE", "x", "READ_ONLY", readOnlyUserId)).statusCode).toBe(403);
    expect((await setApplicability(sysId, fwId, "APPLICABLE", "x", "REVIEWER", reviewerUserId)).statusCode).toBe(403);
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/framework-applicability`,
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
  });

  it("enforces tenant isolation on reading and deciding (404, no existence leak)", async () => {
    const sysId = await createAiSystem();
    const getRes = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/framework-applicability`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(getRes.statusCode).toBe(404);
    expect((await setApplicability(sysId, fwId, "APPLICABLE", "x", "ADMIN", tenantBUserId, tenantBId)).statusCode).toBe(404);
  });

  it("cannot assign or even list a tenant-specific framework belonging to another tenant", async () => {
    const sysId = await createAiSystem();
    expect((await setApplicability(sysId, fwBId, "APPLICABLE")).statusCode).toBe(404);
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/framework-applicability`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
    });
    const ids = JSON.parse(res.body).frameworks.map((row: { framework: { id: string } }) => row.framework.id);
    expect(ids).not.toContain(fwBId);
    expect(ids).toContain(fwId);
  });

  it("never creates an applicability decision from regulatory relevance context", async () => {
    const sysId = await createAiSystem();
    await prisma.aiSystem.update({ where: { id: sysId }, data: { regulatoryRelevance: ["EU_AI_ACT", "PRIVACY"] } });
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/framework-applicability`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
    });
    const rows = JSON.parse(res.body).frameworks as Array<{ framework: { catalogId: string }; applicability: unknown; regulatoryContext: string | null }>;
    expect(rows.every((row) => row.applicability === null)).toBe(true);
    expect(await prisma.aiSystemFrameworkApplicability.count({ where: { aiSystemId: sysId } })).toBe(0);
    const euRow = rows.find((row) => row.framework.catalogId === "eu-ai-act");
    if (euRow) {
      expect(euRow.regulatoryContext).toContain("not a legal applicability determination");
    }
  });

  it("does not modify the global framework record through the governance API", async () => {
    const sysId = await createAiSystem();
    const before = await prisma.framework.findUniqueOrThrow({ where: { id: fwId } });
    await server.inject({
      method: "PUT", url: `/ai-systems/${sysId}/framework-applicability/${fwId}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { status: "APPLICABLE", rationale: "ok", name: "Hacked", scope: "HACKED", tenantId: tenantBId },
    });
    const after = await prisma.framework.findUniqueOrThrow({ where: { id: fwId } });
    expect(after).toEqual(before);
  });
});

describe("Control mapping", () => {
  it("maps an authoritative control by reference, with defaults and an audit event", async () => {
    const sysId = await systemWithApplicableFramework();
    const controlBefore = await prisma.control.findUniqueOrThrow({ where: { id: ctrlA } });
    const res = await mapControls(sysId, { controlIds: [ctrlA] });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).mapped).toEqual([ctrlA]);
    const record = await mappedRecord(sysId, ctrlA);
    expect(record.applicability).toBe("NOT_ASSESSED");
    expect(record.implementationStatus).toBe("NOT_STARTED");
    expect(record.mappedByUserId).toBe(analystUserId);
    expect(await prisma.control.findUniqueOrThrow({ where: { id: ctrlA } })).toEqual(controlBefore);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_control.mapped", targetId: record.id } });
    expect(event).not.toBeNull();
  });

  it("bulk maps explicitly selected controls and reports duplicates instead of creating them", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const res = await mapControls(sysId, { controlIds: [ctrlA, ctrlB, ctrlC] });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.mapped.sort()).toEqual([ctrlB, ctrlC].sort());
    expect(body.skippedAlreadyMapped).toEqual([ctrlA]);
    const again = await mapControls(sysId, { controlIds: [ctrlA, ctrlB, ctrlC] });
    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body).skippedAlreadyMapped.length).toBe(3);
    expect(await prisma.aiSystemControl.count({ where: { aiSystemId: sysId } })).toBe(3);
  });

  it("enforces AI system + control uniqueness at the database level", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    await expect(
      prisma.aiSystemControl.create({ data: { tenantId: tenantAId, aiSystemId: sysId, controlId: ctrlA, sourceApplicabilityId: record.sourceApplicabilityId } }),
    ).rejects.toThrow();
  });

  it("only maps controls from frameworks marked Applicable or Partially Applicable", async () => {
    const sysId = await createAiSystem();
    expect((await mapControls(sysId, { controlIds: [ctrlA] })).statusCode).toBe(400);
    await setApplicability(sysId, fwId, "NEEDS_REVIEW");
    expect((await mapControls(sysId, { controlIds: [ctrlA] })).statusCode).toBe(400);
    await setApplicability(sysId, fwId, "NOT_APPLICABLE", "Not used for this system");
    expect((await mapControls(sysId, { controlIds: [ctrlA] })).statusCode).toBe(400);
    await setApplicability(sysId, fwId, "PARTIALLY_APPLICABLE", "Only some requirements apply");
    expect((await mapControls(sysId, { controlIds: [ctrlA] })).statusCode).toBe(201);
    expect(await prisma.aiSystemControl.count({ where: { aiSystemId: sysId } })).toBe(1);
  });

  it("checks that a control belongs to a framework decided for this AI system", async () => {
    const sysId = await systemWithApplicableFramework();
    const res = await mapControls(sysId, { controlIds: [fw2Ctrl] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).rejected[0].reason).toContain("not currently marked Applicable");
  });

  it("rejects a control from a non-current framework version", async () => {
    const sysId = await systemWithApplicableFramework();
    const res = await mapControls(sysId, { controlIds: [oldCtrl] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).rejected[0].reason).toContain("current framework version");
  });

  it("rejects a control from another tenant's private framework", async () => {
    const sysId = await systemWithApplicableFramework();
    const res = await mapControls(sysId, { controlIds: [tenantBCtrl] });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).rejected[0].reason).toBe("Control not found");
  });

  it("requires an explicit selection - there is no implicit map-all", async () => {
    const sysId = await systemWithApplicableFramework();
    expect((await mapControls(sysId, {})).statusCode).toBe(400);
    expect((await mapControls(sysId, { controlIds: [] })).statusCode).toBe(400);
    expect((await mapControls(sysId, { controlIds: "all" })).statusCode).toBe(400);
    expect(await prisma.aiSystemControl.count({ where: { aiSystemId: sysId } })).toBe(0);
  });

  it("blocks READ_ONLY and REVIEWER from mapping, and other tenants from reading the set", async () => {
    const sysId = await systemWithApplicableFramework();
    expect((await mapControls(sysId, { controlIds: [ctrlA] }, "READ_ONLY", readOnlyUserId)).statusCode).toBe(403);
    expect((await mapControls(sysId, { controlIds: [ctrlA] }, "REVIEWER", reviewerUserId)).statusCode).toBe(403);
    expect((await mapControls(sysId, { controlIds: [ctrlA] }, "ADMIN", tenantBUserId, tenantBId)).statusCode).toBe(404);
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/controls`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Control applicability, ownership, and implementation claim", () => {
  it("requires a rationale for NOT_APPLICABLE and PARTIALLY_APPLICABLE, but not for APPLICABLE", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA, ctrlB, ctrlC] });
    const a = await mappedRecord(sysId, ctrlA);
    const b = await mappedRecord(sysId, ctrlB);
    const c = await mappedRecord(sysId, ctrlC);
    expect((await patchControl(a.id, { applicability: "NOT_APPLICABLE" })).statusCode).toBe(400);
    expect((await patchControl(a.id, { applicability: "NOT_APPLICABLE", rationale: "Model is not used for this purpose" })).statusCode).toBe(200);
    expect((await patchControl(b.id, { applicability: "PARTIALLY_APPLICABLE" })).statusCode).toBe(400);
    expect((await patchControl(b.id, { applicability: "PARTIALLY_APPLICABLE", rationale: "Only the monitoring portion applies" })).statusCode).toBe(200);
    expect((await patchControl(c.id, { applicability: "APPLICABLE" })).statusCode).toBe(200);
    expect((await patchControl(a.id, { rationale: null })).statusCode).toBe(400);
  });

  it("audits applicability changes with before and after values", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    await patchControl(record.id, { applicability: "APPLICABLE" });
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_control.applicability_changed", targetId: record.id } });
    const meta = event?.metadataJson as { from?: string; to?: string } | null;
    expect(meta?.from).toBe("NOT_ASSESSED");
    expect(meta?.to).toBe("APPLICABLE");
  });

  it("treats NOT_APPLICABLE as a decision - not a finding, deficiency, or remediation", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    await patchControl(record.id, { applicability: "NOT_APPLICABLE", rationale: "Out of scope for this system" });
    expect(await prisma.controlFinding.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(await prisma.remediationAction.count({ where: { tenantId: tenantAId } })).toBe(0);
  });

  it("assigns a same-tenant owner with an audit event, and rejects a cross-tenant owner", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    expect((await patchControl(record.id, { ownerUserId: reviewerUserId })).statusCode).toBe(200);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_control.owner_changed", targetId: record.id } });
    expect(event).not.toBeNull();
    expect((await patchControl(record.id, { ownerUserId: tenantBUserId })).statusCode).toBe(400);
    expect((await mappedRecord(sysId, ctrlA)).ownerUserId).toBe(reviewerUserId);
  });

  it("records IMPLEMENTED as a claim only - no finding, assessment, score, or assurance result", async () => {
    const sysId = await systemWithApplicableFramework();
    const systemBefore = await prisma.aiSystem.findUniqueOrThrow({ where: { id: sysId } });
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    const res = await patchControl(record.id, { implementationStatus: "IMPLEMENTED" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).applicability).toBe("NOT_ASSESSED");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_control.implementation_status_changed", targetId: record.id } });
    expect(event).not.toBeNull();
    expect(await prisma.controlFinding.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(await prisma.assessment.count({ where: { tenantId: tenantAId } })).toBe(0);
    expect(await prisma.remediationAction.count({ where: { tenantId: tenantAId } })).toBe(0);
    const systemAfter = await prisma.aiSystem.findUniqueOrThrow({ where: { id: sysId } });
    expect(systemAfter.riskTier).toBe(systemBefore.riskTier);
    expect(systemAfter.assessmentStatus).toBe(systemBefore.assessmentStatus);
    const summary = (await getControlSet(sysId)).body.summary;
    expect(JSON.stringify(summary).toLowerCase()).not.toMatch(/percent|compliance|score|effective/);
  });

  it("rejects invalid applicability and implementation values", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    expect((await patchControl(record.id, { applicability: "FAILED" })).statusCode).toBe(400);
    expect((await patchControl(record.id, { implementationStatus: "VERIFIED" })).statusCode).toBe(400);
    expect((await patchControl(record.id, { implementationStatus: "NOT_APPLICABLE" })).statusCode).toBe(400);
  });

  it("cannot modify the global Control record or re-point the mapping", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    const controlBefore = await prisma.control.findUniqueOrThrow({ where: { id: ctrlA } });
    expect((await patchControl(record.id, { title: "Hacked", controlId: ctrlB, summary: "Hacked" })).statusCode).toBe(400);
    expect((await patchControl(record.id, { implementationStatus: "PLANNED", title: "Hacked", controlId: ctrlB })).statusCode).toBe(200);
    expect(await prisma.control.findUniqueOrThrow({ where: { id: ctrlA } })).toEqual(controlBefore);
    expect((await prisma.aiSystemControl.findUniqueOrThrow({ where: { id: record.id } })).controlId).toBe(ctrlA);
  });

  it("blocks REVIEWER updates and cross-tenant updates (404, unchanged)", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    expect((await patchControl(record.id, { applicability: "APPLICABLE" }, "REVIEWER", reviewerUserId)).statusCode).toBe(403);
    expect((await patchControl(record.id, { applicability: "APPLICABLE" }, "ADMIN", tenantBUserId, tenantBId)).statusCode).toBe(404);
    expect((await mappedRecord(sysId, ctrlA)).applicability).toBe("NOT_ASSESSED");
  });

  it("offers no unmapping endpoint - mapped controls are preserved", async () => {
    const sysId = await systemWithApplicableFramework();
    await mapControls(sysId, { controlIds: [ctrlA] });
    const record = await mappedRecord(sysId, ctrlA);
    const res = await server.inject({
      method: "DELETE", url: `/ai-system-controls/${record.id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.aiSystemControl.findUnique({ where: { id: record.id } })).not.toBeNull();
  });
});

describe("History when framework applicability changes", () => {
  for (const newStatus of ["NOT_APPLICABLE", "NEEDS_REVIEW"]) {
    it(`changing the framework to ${newStatus} preserves mapped controls and their decisions`, async () => {
      const sysId = await systemWithApplicableFramework();
      await mapControls(sysId, { controlIds: [ctrlA, ctrlB] });
      const a = await mappedRecord(sysId, ctrlA);
      await patchControl(a.id, { applicability: "APPLICABLE", ownerUserId: reviewerUserId, implementationStatus: "PLANNED" });
      const res = await setApplicability(sysId, fwId, newStatus, "Governance decision revisited");
      expect(res.statusCode).toBe(200);
      expect(await prisma.aiSystemControl.count({ where: { aiSystemId: sysId } })).toBe(2);
      const after = await mappedRecord(sysId, ctrlA);
      expect(after.applicability).toBe("APPLICABLE");
      expect(after.ownerUserId).toBe(reviewerUserId);
      expect(after.implementationStatus).toBe("PLANNED");
      const set = await getControlSet(sysId);
      expect(set.body.controls.every((row: { frameworkCurrentlyApplicable: boolean }) => row.frameworkCurrentlyApplicable === false)).toBe(true);
      expect(set.body.summary.controlsFromFrameworksNoLongerApplicable).toBe(2);
    });
  }
});

describe("AI Control Set summary and relationships", () => {
  it("summarizes counts only", async () => {
    const sysId = await systemWithApplicableFramework();
    await setApplicability(sysId, fw2Id, "NEEDS_REVIEW", "Awaiting legal review");
    await mapControls(sysId, { controlIds: [ctrlA, ctrlB, ctrlC, ctrlD] });
    const a = await mappedRecord(sysId, ctrlA);
    const b = await mappedRecord(sysId, ctrlB);
    const c = await mappedRecord(sysId, ctrlC);
    await patchControl(a.id, { applicability: "APPLICABLE", ownerUserId: adminUserId, implementationStatus: "IMPLEMENTED" });
    await patchControl(b.id, { applicability: "PARTIALLY_APPLICABLE", rationale: "Only logging applies", implementationStatus: "PLANNED" });
    await patchControl(c.id, { applicability: "NOT_APPLICABLE", rationale: "Not used" });
    const { status, body } = await getControlSet(sysId);
    expect(status).toBe(200);
    expect(body.summary).toEqual({
      applicableFrameworks: 1,
      needsReviewFrameworks: 1,
      notApplicableFrameworks: 0,
      mappedControls: 4,
      applicableControls: 2,
      notAssessedControls: 1,
      notApplicableControls: 1,
      controlsWithoutOwner: 2,
      controlsFromFrameworksNoLongerApplicable: 0,
      implementationReported: { notStarted: 2, planned: 1, implemented: 1 },
    });
  });

  it("shows an existing Step 6 AI risk link read-only, without changing the risk", async () => {
    const sysId = await systemWithApplicableFramework();
    const raRes = await server.inject({
      method: "POST", url: `/ai-systems/${sysId}/risk-assessments`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { name: "S8 Linked Risk Assessment" },
    });
    expect(raRes.statusCode).toBe(201);
    const risk = await prisma.aiRisk.create({
      data: {
        tenantId: tenantAId,
        assessmentId: JSON.parse(raRes.body).id,
        title: "Biased credit decisions",
        category: "FAIRNESS",
        statement: "Test risk",
        likelihood: 3,
        impact: 3,
        inherentScore: 9,
        inherentRating: "MODERATE",
        controlId: ctrlA,
      },
    });
    await mapControls(sysId, { controlIds: [ctrlA, ctrlB] });
    const { body } = await getControlSet(sysId);
    const rowA = body.controls.find((row: { controlId: string }) => row.controlId === ctrlA);
    const rowB = body.controls.find((row: { controlId: string }) => row.controlId === ctrlB);
    expect(rowA.linkedRisks.map((r: { title: string }) => r.title)).toEqual(["Biased credit decisions"]);
    expect(rowB.linkedRisks).toEqual([]);
    const riskAfter = await prisma.aiRisk.findUniqueOrThrow({ where: { id: risk.id } });
    expect(riskAfter.controlId).toBe(ctrlA);
    expect(await prisma.aiRisk.count({ where: { tenantId: tenantAId } })).toBe(1);
  });
});

describe("Regression - existing workflows still work", () => {
  it("Step 7 AI Impact Assessment can still be created", async () => {
    const sysId = await createAiSystem();
    const res = await server.inject({
      method: "POST", url: `/ai-systems/${sysId}/impact-assessments`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
  });

  it("Framework Explorer and Vendor/TPRM list endpoints still respond", async () => {
    const frameworks = await server.inject({
      method: "GET", url: "/frameworks",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(frameworks.statusCode).toBe(200);
    const assessments = await server.inject({
      method: "GET", url: "/assessments",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(assessments.statusCode).toBe(200);
  });

  it("leaves the authoritative framework and control library unchanged", async () => {
    expect(await librarySnapshot()).toBe(librarySnapshotBefore);
  });
});