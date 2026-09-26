import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

let tenantId: string;
let reviewerUserId: string;
let analystUserId: string;
let vendorId: string;
let assessmentId: string;
let controlId: string;
let findingId: string;
let frameworkId: string;

function cookieFor(userId: string, role: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "M12 Test Tenant" } });
  tenantId = tenant.id;

  const reviewer = await prisma.user.create({
    data: { externalId: `m12-reviewer-${Date.now()}`, email: `m12-reviewer-${Date.now()}@example.com`, displayName: "Reviewer" },
  });
  reviewerUserId = reviewer.id;
  await prisma.tenantMembership.create({ data: { userId: reviewer.id, tenantId, role: "REVIEWER" } });

  const analyst = await prisma.user.create({
    data: { externalId: `m12-analyst-${Date.now()}`, email: `m12-analyst-${Date.now()}@example.com`, displayName: "Analyst" },
  });
  analystUserId = analyst.id;
  await prisma.tenantMembership.create({ data: { userId: analyst.id, tenantId, role: "ANALYST" } });

  const vendor = await prisma.vendor.create({
    data: { tenantId, legalName: "M12 Test Vendor", serviceCategory: "Cloud/SaaS", serviceDescription: "Test vendor for M12 tests", criticality: "MEDIUM" },
  });
  vendorId = vendor.id;

  const framework = await prisma.framework.create({ data: { catalogId: `m12-test-${Date.now()}`, name: "M12 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  frameworkId = framework.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: framework.id, version: "1.0" } });
  const control = await prisma.control.create({
    data: { frameworkVersionId: version.id, controlId: "M12-1", title: "Test Control", summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
  });
  controlId = control.id;

  const assessment = await prisma.assessment.create({
    data: { tenantId, vendorId, scoringModelVersion: "test-1", startedByUserId: reviewer.id },
  });
  assessmentId = assessment.id;

  const finding = await prisma.controlFinding.create({
    data: {
      tenantId,
      vendorId,
      assessmentId,
      controlId,
      status: "INSUFFICIENT_EVIDENCE",
      confidence: 0.71,
      gaps: ["Missing SOC 2 evidence"],
      recommendations: ["Request vendor SOC 2 report"],
      requiresHumanReview: true,
    },
  });
  findingId = finding.id;
});

afterAll(async () => {
  await prisma.reviewDecision.deleteMany({ where: { tenantId } });
  await prisma.controlFinding.deleteMany({ where: { tenantId } });
  await prisma.assessment.deleteMany({ where: { tenantId } });
  await prisma.riskAcceptance.deleteMany({ where: { tenantId } });
  await prisma.vendor.deleteMany({ where: { tenantId } });
  await prisma.control.delete({ where: { id: controlId } });
  await prisma.framework.delete({ where: { id: frameworkId } }); // removes its test version too
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: reviewerUserId } });
  await prisma.user.delete({ where: { id: analystUserId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});
describe("POST /assessments/:id/findings/:findingId/review (RBAC)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/assessments/${assessmentId}/findings/${findingId}/review`,
      payload: { decision: "ACCEPT", rationale: "test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an ANALYST, who has finding:propose but not finding:review", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/assessments/${assessmentId}/findings/${findingId}/review`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST") },
      payload: { decision: "ACCEPT", rationale: "test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows a REVIEWER to submit a decision, and preserves the original AI recommendation unchanged", async () => {
    const before = await prisma.controlFinding.findUniqueOrThrow({ where: { id: findingId } });

    const res = await server.inject({
      method: "POST",
      url: `/assessments/${assessmentId}/findings/${findingId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER") },
      payload: { decision: "OVERRIDE", rationale: "Compensating controls validated", finalStatus: "PASS" },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.controlFinding.findUniqueOrThrow({ where: { id: findingId } });
    expect(after.confidence).toBe(before.confidence);
    expect(after.gaps).toEqual(before.gaps);
    expect(after.recommendations).toEqual(before.recommendations);
    expect(after.status).toBe("PASS");
    expect(after.requiresHumanReview).toBe(false);

    const decision = await prisma.reviewDecision.findFirst({ where: { findingId }, orderBy: { createdAt: "desc" } });
    expect(decision?.decision).toBe("OVERRIDE");
    expect(decision?.changedValuesJson).toEqual({ status: { from: "INSUFFICIENT_EVIDENCE", to: "PASS" } });
  });
});

describe("GET /reviews/findings (queue)", () => {
  it("rejects an ANALYST from viewing the review queue", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/reviews/findings",
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST") },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns only findings scoped to the caller's own tenant", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/reviews/findings",
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER") },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    for (const f of body.findings) {
      expect(f.vendor.id).toBeDefined();
    }
  });
});

describe("POST /vendors/:id/risk-acceptance (higher authority bar than finding review)", () => {
  it("rejects a REVIEWER-authorized-but-wrong-permission check correctly, since REVIEWER IS in RISK_ACCEPTANCE_ROLES", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/vendors/${vendorId}/risk-acceptance`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER") },
      payload: { justification: "Compensating controls in place, residual risk accepted for this quarter." },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.riskAcceptance.tenantId).toBe(tenantId);
    expect(body.riskAcceptance.approvedByUserId).toBe(reviewerUserId);
  });

  it("rejects an ANALYST, who is not in RISK_ACCEPTANCE_ROLES even though finding review authority differs", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/vendors/${vendorId}/risk-acceptance`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST") },
      payload: { justification: "test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a risk acceptance with no justification", async () => {
    const res = await server.inject({
      method: "POST",
      url: `/vendors/${vendorId}/risk-acceptance`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER") },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
