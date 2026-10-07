import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

// Third-Party AI authorization hardening: tenant isolation + RBAC on legacy scoring/rating/analyze routes and vendor creation.
const ROLES = ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"] as const;
type Role = (typeof ROLES)[number];

let tenantAId: string;
let tenantBId: string;
const usersA = {} as Record<Role, string>;
let adminB: string;
let readOnlyClaimAdmin: string;
let assessmentA: string;
let assessmentB: string;
let docA: string;
let docB: string;
const userIds: string[] = [];
const stamp = `${Date.now()}`;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.99." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookie(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Hardening Test", role });
}
async function post(url: string, userId: string, role: string, tenantId: string, payload: Record<string, unknown> = {}) {
  const res = await server.inject({ method: "POST", url, cookies: { vg_session: cookie(userId, role, tenantId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function newUser(label: string, role: string, tenantId: string) {
  const u = await prisma.user.create({ data: { externalId: `hz-${label}-${stamp}`, email: `hz-${label}-${stamp}@example.com`, displayName: `HZ ${label}` } });
  await prisma.tenantMembership.create({ data: { userId: u.id, tenantId, role: role as never } });
  userIds.push(u.id);
  return u.id;
}
async function fixtures(tenantId: string, userId: string, label: string) {
  const vendor = await prisma.vendor.create({ data: { tenantId, legalName: `HZ Vendor ${label}`, serviceDescription: "x", serviceCategory: "x", criticality: "LOW" } });
  const assessment = await prisma.assessment.create({ data: { tenantId, vendorId: vendor.id, status: "DRAFT" as never, scoringModelVersion: "risk-model-2025.1", startedByUserId: userId } });
  const doc = await prisma.evidenceDocument.create({
    data: { tenantId, vendorId: vendor.id, displayFilename: `hz-${label}.pdf`, storageKey: `hz-${label}-${stamp}`, mimeType: "application/pdf", sizeBytes: 10, sha256Hash: `hz-${label}-${stamp}`, documentType: "SOC 2 report", uploadedByUserId: userId },
  });
  return { assessmentId: assessment.id, docId: doc.id };
}

const ROUTES = [
  { name: "ai-risk-score", path: (id: string) => `/assessments/${id}/ai-risk-score`, body: { modelRisk: 50, dataRisk: 50, securityRisk: 50, regulatoryRisk: 50, humanOversightRisk: 50, governanceRisk: 50, controlEffectiveness: 40 } },
  { name: "ai-impact-score", path: (id: string) => `/assessments/${id}/ai-impact-score`, body: { potentialHarmSeverity: 50, individualsAffectedScale: 50, decisionAutonomyLevel: 50, sensitiveDataInvolved: 50, regulatoryExposureLevel: 50, explainabilityLevel: 50 } },
  { name: "risk-rating", path: (id: string) => `/assessments/${id}/risk-rating`, body: { businessCriticality: 50, dataSensitivity: 50, aiAutonomy: 50, regulatoryExposure: 50, securityPosture: 50, modelRisk: 50, vendorMaturity: 50, controlEffectiveness: 40 } },
];

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "HZ Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "HZ Tenant B" } })).id;
  for (const r of ROLES) {
    usersA[r] = await newUser(`a-${r.toLowerCase()}`, r, tenantAId);
  }
  adminB = await newUser("b-admin", "ADMIN", tenantBId);
  readOnlyClaimAdmin = usersA.READ_ONLY;
  const a = await fixtures(tenantAId, usersA.ADMIN, "a");
  const b = await fixtures(tenantBId, adminB, "b");
  assessmentA = a.assessmentId;
  docA = a.docId;
  assessmentB = b.assessmentId;
  docB = b.docId;
});

afterAll(async () => {
  const tenantId = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.findingEvidence.deleteMany({ where: { tenantId } });
  await prisma.controlFinding.deleteMany({ where: { tenantId } });
  await prisma.riskRating.deleteMany({ where: { OR: [{ tenantId }, { assessmentId: { in: [assessmentA, assessmentB] } }] } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId } });
  await prisma.assessment.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

for (const route of ROUTES) {
  describe(`Hardening - POST ${route.name}`, () => {
    it("ADMIN and ANALYST (assessment:create) succeed within their tenant", async () => {
      expect((await post(route.path(assessmentA), usersA.ADMIN, "ADMIN", tenantAId, route.body)).status).toBe(200);
      expect((await post(route.path(assessmentA), usersA.ANALYST, "ANALYST", tenantAId, route.body)).status).toBe(200);
    });

    for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
      it(`${role} is rejected with 403`, async () => {
        expect((await post(route.path(assessmentA), usersA[role], role, tenantAId, route.body)).status).toBe(403);
      });
    }

    it("a cookie claiming ADMIN cannot override the database READ_ONLY role (403)", async () => {
      expect((await post(route.path(assessmentA), readOnlyClaimAdmin, "ADMIN", tenantAId, route.body)).status).toBe(403);
    });

    it("cross-tenant assessment returns 404 and the other tenant's data is unchanged", async () => {
      const before = await prisma.assessment.findUnique({ where: { id: assessmentB } });
      const ratingsBefore = await prisma.riskRating.count({ where: { assessmentId: assessmentB } });
      expect((await post(route.path(assessmentB), usersA.ADMIN, "ADMIN", tenantAId, route.body)).status).toBe(404);
      const after = await prisma.assessment.findUnique({ where: { id: assessmentB } });
      expect(after?.aiInherentScore).toEqual(before?.aiInherentScore);
      expect(after?.impactScore).toEqual(before?.impactScore);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      expect(await prisma.riskRating.count({ where: { assessmentId: assessmentB } })).toBe(ratingsBefore);
    });
  });
}

describe("Hardening - risk-rating record tenant", () => {
  it("a rating is created under the caller's tenant for its own assessment", async () => {
    const res = await post(`/assessments/${assessmentA}/risk-rating`, usersA.ADMIN, "ADMIN", tenantAId, (ROUTES[2]?.body ?? {}));
    expect(res.status).toBe(200);
    const rating = await prisma.riskRating.findUnique({ where: { id: res.body.riskRating.id } });
    expect(rating?.tenantId).toBe(tenantAId);
    expect(rating?.assessmentId).toBe(assessmentA);
  });
});

describe("Hardening - POST /vendors tenant placement", () => {
  it("a Tenant B user creates the vendor (and its audit event) in Tenant B, not the first tenant", async () => {
    const res = await post("/vendors", adminB, "ADMIN", tenantBId, { legalName: `HZ created by B ${stamp}` });
    expect(res.status).toBe(201);
    const vendor = await prisma.vendor.findUnique({ where: { id: res.body.id } });
    expect(vendor?.tenantId).toBe(tenantBId);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "vendor.created", targetId: res.body.id } });
    expect(audit?.tenantId).toBe(tenantBId);
  });

  it("a role without vendor:create is still rejected with 403", async () => {
    expect((await post("/vendors", usersA.READ_ONLY, "READ_ONLY", tenantAId, { legalName: "nope" })).status).toBe(403);
  });
});

describe("Hardening - POST /assessments/:id/evidence/:docId/analyze", () => {
  const url = (assessmentId: string, docId: string) => `/assessments/${assessmentId}/evidence/${docId}/analyze`;

  it("ANALYST (finding:propose) can run the advisory analysis within its tenant", async () => {
    const res = await post(url(assessmentA, docA), usersA.ANALYST, "ANALYST", tenantAId);
    expect(res.status).toBe(200);
    for (const finding of res.body.findings as { status: string; requiresHumanReview: boolean }[]) {
      expect(finding.requiresHumanReview).toBe(true);
      expect(finding.status).not.toBe("PASS");
    }
  });

  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
    it(`${role} is rejected with 403 and nothing is written`, async () => {
      const before = await prisma.controlFinding.count({ where: { assessmentId: assessmentA } });
      expect((await post(url(assessmentA, docA), usersA[role], role, tenantAId)).status).toBe(403);
      expect(await prisma.controlFinding.count({ where: { assessmentId: assessmentA } })).toBe(before);
    });
  }

  it("a cross-tenant assessment is rejected and nothing is written for the other tenant", async () => {
    const res = await post(url(assessmentB, docB), usersA.ANALYST, "ANALYST", tenantAId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.controlFinding.count({ where: { assessmentId: assessmentB } })).toBe(0);
  });

  it("cross-tenant evidence is rejected", async () => {
    const res = await post(url(assessmentA, docB), usersA.ANALYST, "ANALYST", tenantAId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});