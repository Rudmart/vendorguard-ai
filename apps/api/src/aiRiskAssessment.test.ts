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
let controlId: string;
let vendorAId: string;
let raFrameworkId: string;

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function createAiSystem(tenantId: string, role: string, userId: string) {
  const res = await server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: cookieFor(userId, role, tenantId) },
    payload: { name: "Risk Assessment Test System", origin: "INTERNAL" },
  });
  return JSON.parse(res.body).id as string;
}

async function createAssessment(aiSystemId: string, tenantId: string, role: string, userId: string, name = "Test Assessment") {
  const res = await server.inject({
    method: "POST", url: `/ai-systems/${aiSystemId}/risk-assessments`,
    cookies: { vg_session: cookieFor(userId, role, tenantId) },
    payload: { name },
  });
  return JSON.parse(res.body).id as string;
}

beforeAll(async () => {
  const tenantA = await prisma.tenant.create({ data: { name: "Risk Assessment Test Tenant A" } });
  tenantAId = tenantA.id;
  const tenantB = await prisma.tenant.create({ data: { name: "Risk Assessment Test Tenant B" } });
  tenantBId = tenantB.id;

  const admin = await prisma.user.create({ data: { externalId: `ra-admin-${Date.now()}`, email: `ra-admin-${Date.now()}@example.com`, displayName: "RA Admin" } });
  adminUserId = admin.id;
  await prisma.tenantMembership.create({ data: { userId: adminUserId, tenantId: tenantAId, role: "ADMIN" } });

  const analyst = await prisma.user.create({ data: { externalId: `ra-analyst-${Date.now()}`, email: `ra-analyst-${Date.now()}@example.com`, displayName: "RA Analyst" } });
  analystUserId = analyst.id;
  await prisma.tenantMembership.create({ data: { userId: analystUserId, tenantId: tenantAId, role: "ANALYST" } });

  const reviewer = await prisma.user.create({ data: { externalId: `ra-reviewer-${Date.now()}`, email: `ra-reviewer-${Date.now()}@example.com`, displayName: "RA Reviewer" } });
  reviewerUserId = reviewer.id;
  await prisma.tenantMembership.create({ data: { userId: reviewerUserId, tenantId: tenantAId, role: "REVIEWER" } });

  const readOnly = await prisma.user.create({ data: { externalId: `ra-readonly-${Date.now()}`, email: `ra-readonly-${Date.now()}@example.com`, displayName: "RA Read Only" } });
  readOnlyUserId = readOnly.id;
  await prisma.tenantMembership.create({ data: { userId: readOnlyUserId, tenantId: tenantAId, role: "READ_ONLY" } });

  const tenantBUser = await prisma.user.create({ data: { externalId: `ra-tenantb-${Date.now()}`, email: `ra-tenantb-${Date.now()}@example.com`, displayName: "RA Tenant B" } });
  tenantBUserId = tenantBUser.id;
  await prisma.tenantMembership.create({ data: { userId: tenantBUserId, tenantId: tenantBId, role: "ADMIN" } });

  const vendorA = await prisma.vendor.create({
    data: { tenantId: tenantAId, legalName: "RA Test Vendor", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorAId = vendorA.id;

  // Reuse an existing framework/control if one is seeded, otherwise create a minimal one for the test
  const framework = await prisma.framework.create({
    data: { catalogId: `ra-test-fw-${Date.now()}`, name: "RA Test Framework", scope: "TEST", industries: ["GENERAL"] },
  });
  const frameworkVersion = await prisma.frameworkVersion.create({
    data: { frameworkId: framework.id, version: "1.0" },
  });
  const control = await prisma.control.create({
    data: {
      frameworkVersionId: frameworkVersion.id,
      controlId: "RA-1",
      title: "Bias Testing Required",
      summary: "Bias testing is required before deployment.",
      domain: "AI Governance",
      expectedEvidenceTypes: ["DOCUMENT"],
      validationGuidance: "Confirm bias testing was performed.",
    },
  });
  controlId = control.id;
  raFrameworkId = framework.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.framework.delete({ where: { id: raFrameworkId } }); // removes its test version and control too
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystemVendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.vendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.user.delete({ where: { id: analystUserId } });
  await prisma.user.delete({ where: { id: reviewerUserId } });
  await prisma.user.delete({ where: { id: readOnlyUserId } });
  await prisma.user.delete({ where: { id: tenantBUserId } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("AI Risk Assessment - create/retrieve/update", () => {
  it("creates an assessment tied to the correct AiSystem and generates an audit event", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-systems/${sysId}/risk-assessments`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Q3 Assessment", assessorUserId: analystUserId },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.aiSystemId).toBe(sysId);
    expect(body.status).toBe("DRAFT");

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.created", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("retrieves an assessment with its risks included", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "GET", url: `/ai-risk-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).risks).toEqual([]);
  });

  it("enforces tenant isolation on assessment retrieval", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "GET", url: `/ai-risk-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects assessment creation from a user without ai-system:update permission", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-systems/${sysId}/risk-assessments`,
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
      payload: { name: "Unauthorized" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("updates an assessment's status and generates a status-changed audit event", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "PATCH", url: `/ai-risk-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { status: "IN_PROGRESS" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("IN_PROGRESS");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.status_changed", targetId: assessmentId } });
    expect(event).not.toBeNull();
  });
});

describe("AI Risk - create/update/delete and inherent-risk calculation", () => {
  it("rejects a risk with an invalid category", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Bad Category", category: "NOT_REAL", statement: "x", likelihood: 3, impact: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a risk with an out-of-range likelihood", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Bad Likelihood", category: "FAIRNESS", statement: "x", likelihood: 9, impact: 3 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a risk with an out-of-range impact", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Bad Impact", category: "FAIRNESS", statement: "x", likelihood: 3, impact: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("calculates inherent risk correctly: 1x1=1 LOW, 3x3=9 MODERATE, 4x4=16 HIGH, 5x5=25 CRITICAL", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);

    const cases: [number, number, number, string][] = [
      [1, 1, 1, "LOW"],
      [3, 3, 9, "MODERATE"],
      [4, 4, 16, "HIGH"],
      [5, 5, 25, "CRITICAL"],
    ];
    for (const [likelihood, impact, expectedScore, expectedRating] of cases) {
      const res = await server.inject({
        method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
        cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
        payload: { title: `Case ${likelihood}x${impact}`, category: "FAIRNESS", statement: "x", likelihood, impact },
      });
      const body = JSON.parse(res.body);
      expect(body.inherentScore).toBe(expectedScore);
      expect(body.inherentRating).toBe(expectedRating);
    }
  });

  it("ignores a client-submitted inherentScore/inherentRating and always calculates server-side", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Spoof Attempt", category: "SAFETY", statement: "x", likelihood: 1, impact: 1, inherentScore: 25, inherentRating: "CRITICAL" },
    });
    const body = JSON.parse(res.body);
    expect(body.inherentScore).toBe(1);
    expect(body.inherentRating).toBe("LOW");
  });

  it("links an existing control to a risk", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Discriminatory Outcomes", category: "FAIRNESS", statement: "x", likelihood: 3, impact: 4, controlId },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).controlId).toBe(controlId);
  });

  it("rejects a controlId that does not reference an existing control", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Bad Control", category: "FAIRNESS", statement: "x", likelihood: 3, impact: 3, controlId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("sets control effectiveness and generates a control_effectiveness_changed audit event", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Effectiveness Test", category: "FAIRNESS", statement: "x", likelihood: 3, impact: 3 },
    });
    const riskId = JSON.parse(createRes.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { controlEffectiveness: "EFFECTIVE" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).controlEffectiveness).toBe("EFFECTIVE");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.control_effectiveness_changed", targetId: riskId } });
    expect(event).not.toBeNull();
  });

  it("rejects an invalid controlEffectiveness value", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Bad Effectiveness", category: "FAIRNESS", statement: "x", likelihood: 3, impact: 3 },
    });
    const riskId = JSON.parse(createRes.body).id;
    const res = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { controlEffectiveness: "SOMEWHAT" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("calculates residual risk server-side and rejects an out-of-range residual likelihood", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Residual Test", category: "PRIVACY", statement: "x", likelihood: 4, impact: 4 },
    });
    const riskId = JSON.parse(createRes.body).id;

    const badRes = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { residualLikelihood: 6, residualImpact: 2 },
    });
    expect(badRes.statusCode).toBe(400);

    const res = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { residualLikelihood: 2, residualImpact: 2, residualScore: 999, residualRating: "CRITICAL" },
    });
    const body = JSON.parse(res.body);
    expect(body.residualScore).toBe(4);
    expect(body.residualRating).toBe("LOW");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.residual_risk_changed", targetId: riskId } });
    expect(event).not.toBeNull();
  });

  it("accepts a valid treatment decision and rejects an invalid one", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Treatment Test", category: "OPERATIONAL", statement: "x", likelihood: 2, impact: 2 },
    });
    const riskId = JSON.parse(createRes.body).id;

    const invalidRes = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { treatment: "IGNORE" },
    });
    expect(invalidRes.statusCode).toBe(400);

    const res = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { treatment: "MITIGATE", treatmentRationale: "Add bias testing gate" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).treatment).toBe("MITIGATE");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.treatment_changed", targetId: riskId } });
    expect(event).not.toBeNull();
  });

  it("enforces tenant isolation when updating a risk (cross-tenant PATCH is not found)", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Cross Tenant Test", category: "SECURITY", statement: "x", likelihood: 2, impact: 2 },
    });
    const riskId = JSON.parse(createRes.body).id;
    const res = await server.inject({
      method: "PATCH", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
      payload: { likelihood: 5 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("deletes a risk when permitted, and generates an audit event", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Delete Test", category: "OPERATIONAL", statement: "x", likelihood: 1, impact: 1 },
    });
    const riskId = JSON.parse(createRes.body).id;
    const res = await server.inject({
      method: "DELETE", url: `/ai-risks/${riskId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(204);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.deleted", targetId: riskId } });
    expect(event).not.toBeNull();
  });
});

describe("AI Risk Assessment - human review (separation of duties)", () => {
  it("rejects a review from a user without ai-risk-assessment:review permission", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId);
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Looks good" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects the assessor reviewing their own assessment", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId, "Self Review Test");
    await server.inject({
      method: "PATCH", url: `/ai-risk-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { assessorUserId: reviewerUserId },
    });
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Approving my own work" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows a REVIEWER to approve an assessment assessed by someone else, and completes it", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Distinct Reviewer Test");
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Reviewed and approved" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("COMPLETED");
    expect(body.reviewDecision).toBe("APPROVED");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.review_recorded", targetId: assessmentId } });
    expect(event).not.toBeNull();
  });

  it("a REJECTED review does not complete the assessment", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Rejected Review Test");
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "REJECTED", rationale: "Needs more work" },
    });
    expect(JSON.parse(res.body).status).toBe("IN_PROGRESS");
  });

  it("records the creator as the assessor when no assessorUserId is provided", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Default Assessor Test");
    const saved = await prisma.aiRiskAssessment.findUnique({ where: { id: assessmentId } });
    expect(saved?.assessorUserId).toBe(analystUserId);
  });

  it("rejects the creator reviewing their own assessment when no assessor was explicitly set", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId, "Implicit Self Review Test");
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Approving my own work" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("fails closed: rejects any review when no assessor is recorded", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Missing Assessor Test");
    await prisma.aiRiskAssessment.update({ where: { id: assessmentId }, data: { assessorUserId: null } });
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "APPROVED", rationale: "No assessor on record" },
    });
    expect(res.statusCode).toBe(403);
    const after = await prisma.aiRiskAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.status).not.toBe("COMPLETED");
  });

  it("blocks a second review once approved and preserves the original review", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Second Review Test");
    const first = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Original approval" },
    });
    expect(first.statusCode).toBe(200);
    const before = await prisma.aiRiskAssessment.findUnique({ where: { id: assessmentId } });
    const second = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { decision: "REJECTED", rationale: "Attempted overwrite" },
    });
    expect(second.statusCode).toBe(409);
    const after = await prisma.aiRiskAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewerUserId).toBe(reviewerUserId);
    expect(after?.reviewDecision).toBe("APPROVED");
    expect(after?.reviewRationale).toBe("Original approval");
    expect(after?.reviewedAt?.getTime()).toBe(before?.reviewedAt?.getTime());
    expect(after?.status).toBe("COMPLETED");
    const denied = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.review_denied", targetId: assessmentId, outcome: "DENIED" } });
    expect(denied).not.toBeNull();
    expect((denied?.metadataJson as { reason?: string } | null)?.reason).toBe("already_completed");
  });

  it("audits a denied self-review with outcome DENIED and records no decision", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId, "Denied Self Review Audit Test");
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { decision: "APPROVED", rationale: "Self approval attempt" },
    });
    expect(res.statusCode).toBe(403);
    const denied = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.review_denied", targetId: assessmentId, outcome: "DENIED" } });
    expect(denied).not.toBeNull();
    expect((denied?.metadataJson as { reason?: string } | null)?.reason).toBe("self_review");
    const after = await prisma.aiRiskAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewDecision).toBeNull();
  });

  it("audits a review attempt by a user without review permission", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "Denied Permission Audit Test");
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { decision: "APPROVED", rationale: "No permission" },
    });
    expect(res.statusCode).toBe(403);
    const denied = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.review_denied", targetId: assessmentId, outcome: "DENIED" } });
    expect(denied).not.toBeNull();
    expect((denied?.metadataJson as { reason?: string } | null)?.reason).toBe("missing_permission");
  });

  it("explains that no assessor is assigned and audits the denied attempt", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ANALYST", analystUserId, "No Assessor Message Test");
    await prisma.aiRiskAssessment.update({ where: { id: assessmentId }, data: { assessorUserId: null } });
    const res = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/review`,
      cookies: { vg_session: cookieFor(reviewerUserId, "REVIEWER", tenantAId) },
      payload: { decision: "APPROVED", rationale: "No assessor" },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("an assessor has not been assigned");
    const denied = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk_assessment.review_denied", targetId: assessmentId, outcome: "DENIED" } });
    expect(denied).not.toBeNull();
    expect((denied?.metadataJson as { reason?: string } | null)?.reason).toBe("no_assessor_assigned");
  });
});

describe("AiRisk -> RemediationAction (mitigation work)", () => {
  it("creates a remediation action linked to a risk via aiRiskId", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const assessmentId = await createAssessment(sysId, tenantAId, "ADMIN", adminUserId);
    const createRiskRes = await server.inject({
      method: "POST", url: `/ai-risk-assessments/${assessmentId}/risks`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Remediation Test", category: "PRIVACY", statement: "x", likelihood: 4, impact: 4 },
    });
    const riskId = JSON.parse(createRiskRes.body).id;

    const res = await server.inject({
      method: "POST", url: `/ai-risks/${riskId}/remediation`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { title: "Add data minimization control", description: "Implement field-level redaction" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.aiRiskId).toBe(riskId);
    expect(body.vendorId).toBeNull();

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.remediation_created", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("regression: existing vendor-linked remediation records (vendorId set, aiRiskId null) still work after the schema change", async () => {
    const remediation = await prisma.remediationAction.create({
      data: { tenantId: tenantAId, vendorId: vendorAId, title: "Existing Vendor Remediation", description: "Pre-existing vendor flow" },
    });
    expect(remediation.vendorId).toBe(vendorAId);
    expect(remediation.aiRiskId).toBeNull();

    const fetched = await prisma.remediationAction.findUnique({ where: { id: remediation.id }, include: { vendor: true } });
    expect(fetched?.vendor?.id).toBe(vendorAId);

    await prisma.remediationAction.delete({ where: { id: remediation.id } });
  });
});