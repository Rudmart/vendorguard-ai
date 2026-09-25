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

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function createAiSystem(tenantId: string, role: string, userId: string, name = "Impact Assessment Test System") {
  const res = await server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: cookieFor(userId, role, tenantId) },
    payload: { name, origin: "INTERNAL" },
  });
  return JSON.parse(res.body).id as string;
}

async function createImpactAssessment(aiSystemId: string, tenantId: string, role: string, userId: string, payload: Record<string, unknown> = {}) {
  return server.inject({
    method: "POST", url: `/ai-systems/${aiSystemId}/impact-assessments`,
    cookies: { vg_session: cookieFor(userId, role, tenantId) },
    payload,
  });
}

async function newAssessmentId(assessorRole = "ANALYST", assessorId?: string) {
  const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
  const res = await createImpactAssessment(sysId, tenantAId, assessorRole, assessorId ?? analystUserId);
  return { sysId, assessmentId: JSON.parse(res.body).id as string };
}

const adverseImpact = {
  title: "Disparate lending outcomes",
  category: "FAIRNESS",
  direction: "ADVERSE",
  description: "Applicants may receive materially different outcomes if model performance differs across populations.",
  affectedPopulation: "CUSTOMERS",
  affectedGroupDescription: "Loan applicants",
  severity: 4,
  scale: "BROAD",
  reversibility: "DIFFICULT_TO_REVERSE",
  vulnerablePopulations: false,
  oversightRequirement: "REQUIRED",
  oversightDescription: "A loan officer reviews every declined application.",
  escalationMechanism: "Escalate to the credit risk committee.",
  humanCanOverride: true,
  safeguards: "Quarterly fairness testing across applicant groups.",
};

const beneficialImpact = {
  title: "Faster, more consistent processing",
  category: "OPERATIONAL",
  direction: "BENEFICIAL",
  description: "Automated analysis may reduce processing time and improve consistency.",
  affectedPopulation: "EMPLOYEES",
  severity: 2,
  scale: "MODERATE",
  reversibility: "REVERSIBLE",
};

async function addImpact(assessmentId: string, payload: Record<string, unknown>, role = "ANALYST", userId?: string, tenantId?: string) {
  return server.inject({
    method: "POST", url: `/ai-impact-assessments/${assessmentId}/impacts`,
    cookies: { vg_session: cookieFor(userId ?? analystUserId, role, tenantId ?? tenantAId) },
    payload,
  });
}

async function review(assessmentId: string, userId: string, role: string, decision = "APPROVED", rationale = "Reviewed", tenantId?: string) {
  return server.inject({
    method: "POST", url: `/ai-impact-assessments/${assessmentId}/review`,
    cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) },
    payload: { decision, rationale },
  });
}

async function deniedEvent(assessmentId: string, reason: string) {
  const events = await prisma.auditEvent.findMany({
    where: { tenantId: tenantAId, action: "ai_impact_assessment.review_denied", targetId: assessmentId, outcome: "DENIED" },
  });
  return events.find((e) => (e.metadataJson as { reason?: string } | null)?.reason === reason) ?? null;
}

beforeAll(async () => {
  const stamp = Date.now();
  const tenantA = await prisma.tenant.create({ data: { name: "Impact Assessment Test Tenant A" } });
  tenantAId = tenantA.id;
  const tenantB = await prisma.tenant.create({ data: { name: "Impact Assessment Test Tenant B" } });
  tenantBId = tenantB.id;

  const admin = await prisma.user.create({ data: { externalId: `ia-admin-${stamp}`, email: `ia-admin-${stamp}@example.com`, displayName: "IA Admin" } });
  adminUserId = admin.id;
  await prisma.tenantMembership.create({ data: { userId: adminUserId, tenantId: tenantAId, role: "ADMIN" } });

  const analyst = await prisma.user.create({ data: { externalId: `ia-analyst-${stamp}`, email: `ia-analyst-${stamp}@example.com`, displayName: "IA Analyst" } });
  analystUserId = analyst.id;
  await prisma.tenantMembership.create({ data: { userId: analystUserId, tenantId: tenantAId, role: "ANALYST" } });

  const reviewer = await prisma.user.create({ data: { externalId: `ia-reviewer-${stamp}`, email: `ia-reviewer-${stamp}@example.com`, displayName: "IA Reviewer" } });
  reviewerUserId = reviewer.id;
  await prisma.tenantMembership.create({ data: { userId: reviewerUserId, tenantId: tenantAId, role: "REVIEWER" } });

  const readOnly = await prisma.user.create({ data: { externalId: `ia-readonly-${stamp}`, email: `ia-readonly-${stamp}@example.com`, displayName: "IA Read Only" } });
  readOnlyUserId = readOnly.id;
  await prisma.tenantMembership.create({ data: { userId: readOnlyUserId, tenantId: tenantAId, role: "READ_ONLY" } });

  const tenantBUser = await prisma.user.create({ data: { externalId: `ia-tenantb-${stamp}`, email: `ia-tenantb-${stamp}@example.com`, displayName: "IA Tenant B" } });
  tenantBUserId = tenantBUser.id;
  await prisma.tenantMembership.create({ data: { userId: tenantBUserId, tenantId: tenantBId, role: "ADMIN" } });
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpact.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemVendor.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("AI Impact Assessment - create/retrieve/update", () => {
  it("creates version 1 with the creator as assessor and records an audit event", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const res = await createImpactAssessment(sysId, tenantAId, "ANALYST", analystUserId, { name: "Q4 Impact Assessment" });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.version).toBe(1);
    expect(body.status).toBe("DRAFT");
    expect(body.assessorUserId).toBe(analystUserId);
    expect(body.aiSystemId).toBe(sysId);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_impact_assessment.created", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("creates a new version instead of overwriting the previous assessment", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const first = JSON.parse((await createImpactAssessment(sysId, tenantAId, "ANALYST", analystUserId)).body);
    const second = JSON.parse((await createImpactAssessment(sysId, tenantAId, "ANALYST", analystUserId)).body);
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    const stillThere = await prisma.aiImpactAssessment.findUnique({ where: { id: first.id } });
    expect(stillThere?.version).toBe(1);
  });

  it("rejects an assessorUserId that belongs to another tenant", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const res = await createImpactAssessment(sysId, tenantAId, "ADMIN", adminUserId, { assessorUserId: tenantBUserId });
    expect(res.statusCode).toBe(400);
  });

  it("rejects creation by a user without ai-system:update permission", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const res = await createImpactAssessment(sysId, tenantAId, "READ_ONLY", readOnlyUserId);
    expect(res.statusCode).toBe(403);
  });

  it("enforces tenant isolation on creation and retrieval (404, no existence leak)", async () => {
    const { sysId, assessmentId } = await newAssessmentId();
    const createRes = await createImpactAssessment(sysId, tenantBId, "ADMIN", tenantBUserId);
    expect(createRes.statusCode).toBe(404);
    const getRes = await server.inject({
      method: "GET", url: `/ai-impact-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it("lists assessments newest version first with an impact summary", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    await createImpactAssessment(sysId, tenantAId, "ANALYST", analystUserId);
    await createImpactAssessment(sysId, tenantAId, "ANALYST", analystUserId);
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${sysId}/impact-assessments`,
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body);
    expect(list.map((a: { version: number }) => a.version)).toEqual([2, 1]);
    expect(list[0].impactSummary.totalImpacts).toBe(0);
  });

  it("moves status through the workflow with an audit event, but cannot be set to COMPLETED directly", async () => {
    const { assessmentId } = await newAssessmentId();
    const ok = await server.inject({
      method: "PATCH", url: `/ai-impact-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { status: "IN_PROGRESS" },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).status).toBe("IN_PROGRESS");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_impact_assessment.status_changed", targetId: assessmentId } });
    expect(event).not.toBeNull();
    const bad = await server.inject({
      method: "PATCH", url: `/ai-impact-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { status: "COMPLETED" },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("AI Impact - add/update/delete and validation", () => {
  it("adds a beneficial impact and an adverse impact, and audits the addition", async () => {
    const { assessmentId } = await newAssessmentId();
    const good = await addImpact(assessmentId, beneficialImpact);
    expect(good.statusCode).toBe(201);
    expect(JSON.parse(good.body).direction).toBe("BENEFICIAL");
    const bad = await addImpact(assessmentId, adverseImpact);
    expect(bad.statusCode).toBe(201);
    const body = JSON.parse(bad.body);
    expect(body.direction).toBe("ADVERSE");
    expect(body.safeguards).toBe(adverseImpact.safeguards);
    expect(body.oversightRequirement).toBe("REQUIRED");
    expect(body.humanCanOverride).toBe(true);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_impact.added", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("rejects severity values outside the 1-5 whole-number scale", async () => {
    const { assessmentId } = await newAssessmentId();
    for (const severity of [0, 6, 2.5, "3"]) {
      const res = await addImpact(assessmentId, { ...adverseImpact, severity });
      expect(res.statusCode).toBe(400);
    }
  });

  it("rejects an invalid scale", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await addImpact(assessmentId, { ...adverseImpact, scale: "HUGE" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid reversibility value", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await addImpact(assessmentId, { ...adverseImpact, reversibility: "PERMANENT" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid direction, category, and affected population values", async () => {
    const { assessmentId } = await newAssessmentId();
    const variants = [
      { direction: "NEUTRAL" },
      { category: "SECURITY" },
      { category: "FINANCIAL" },
      { affectedPopulation: "EVERYONE" },
    ];
    for (const change of variants) {
      const res = await addImpact(assessmentId, { ...adverseImpact, ...change });
      expect(res.statusCode).toBe(400);
    }
  });

  it("requires an explanation when vulnerable populations may be affected", async () => {
    const { assessmentId } = await newAssessmentId();
    const missing = await addImpact(assessmentId, { ...adverseImpact, vulnerablePopulations: true });
    expect(missing.statusCode).toBe(400);
    const ok = await addImpact(assessmentId, {
      ...adverseImpact,
      vulnerablePopulations: true,
      vulnerablePopulationsExplanation: "Applicants with limited credit history may be disproportionately affected.",
    });
    expect(ok.statusCode).toBe(201);
    expect(JSON.parse(ok.body).vulnerablePopulations).toBe(true);
  });

  it("updates an impact with an audit event, and still enforces the vulnerable-population rule", async () => {
    const { assessmentId } = await newAssessmentId();
    const impact = JSON.parse((await addImpact(assessmentId, adverseImpact)).body);
    const res = await server.inject({
      method: "PATCH", url: `/ai-impacts/${impact.id}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { severity: 5, reversibility: "IRREVERSIBLE" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).severity).toBe(5);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_impact.updated", targetId: impact.id } });
    expect(event).not.toBeNull();
    const bad = await server.inject({
      method: "PATCH", url: `/ai-impacts/${impact.id}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { vulnerablePopulations: true },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("deletes an impact and records an audit event", async () => {
    const { assessmentId } = await newAssessmentId();
    const impact = JSON.parse((await addImpact(assessmentId, beneficialImpact)).body);
    const res = await server.inject({
      method: "DELETE", url: `/ai-impacts/${impact.id}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.aiImpact.findUnique({ where: { id: impact.id } })).toBeNull();
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_impact.deleted", targetId: impact.id } });
    expect(event).not.toBeNull();
  });

  it("blocks READ_ONLY and REVIEWER users from adding impacts", async () => {
    const { assessmentId } = await newAssessmentId();
    expect((await addImpact(assessmentId, beneficialImpact, "READ_ONLY", readOnlyUserId)).statusCode).toBe(403);
    expect((await addImpact(assessmentId, beneficialImpact, "REVIEWER", reviewerUserId)).statusCode).toBe(403);
  });

  it("blocks cross-tenant modification and deletion of an impact (404, unchanged)", async () => {
    const { assessmentId } = await newAssessmentId();
    const impact = JSON.parse((await addImpact(assessmentId, adverseImpact)).body);
    const patchRes = await server.inject({
      method: "PATCH", url: `/ai-impacts/${impact.id}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
      payload: { severity: 1 },
    });
    expect(patchRes.statusCode).toBe(404);
    const deleteRes = await server.inject({
      method: "DELETE", url: `/ai-impacts/${impact.id}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(deleteRes.statusCode).toBe(404);
    const after = await prisma.aiImpact.findUnique({ where: { id: impact.id } });
    expect(after?.severity).toBe(4);
  });
});

describe("AI Impact Assessment - summary", () => {
  it("calculates the governance summary and never changes the AiSystem classification", async () => {
    const { sysId, assessmentId } = await newAssessmentId();
    const before = await prisma.aiSystem.findUnique({ where: { id: sysId } });
    await addImpact(assessmentId, beneficialImpact);
    await addImpact(assessmentId, {
      ...adverseImpact,
      severity: 5,
      reversibility: "IRREVERSIBLE",
      vulnerablePopulations: true,
      vulnerablePopulationsExplanation: "Applicants in financial hardship.",
    });
    await addImpact(assessmentId, { ...adverseImpact, severity: 4, reversibility: "DIFFICULT_TO_REVERSE" });
    await addImpact(assessmentId, { ...adverseImpact, severity: 3, reversibility: "REVERSIBLE" });

    const res = await server.inject({
      method: "GET", url: `/ai-impact-assessments/${assessmentId}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    const summary = JSON.parse(res.body).impactSummary;
    expect(summary).toEqual({
      totalImpacts: 4,
      beneficialImpacts: 1,
      adverseImpacts: 3,
      majorOrSevereAdverseImpacts: 2,
      vulnerablePopulationImpacts: 1,
      difficultOrIrreversibleImpacts: 2,
      highestAdverseSeverity: 5,
    });

    const after = await prisma.aiSystem.findUnique({ where: { id: sysId } });
    expect(after?.impactLevel).toBe(before?.impactLevel);
    expect(after?.humanOversight).toBe(before?.humanOversight);
    expect(after?.riskTier).toBe(before?.riskTier);
    expect(after?.assessmentStatus).toBe(before?.assessmentStatus);
  });
});

describe("AI Impact Assessment - human review (separation of duties)", () => {
  it("rejects and audits a review from a user without ai-impact-assessment:review permission", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await review(assessmentId, analystUserId, "ANALYST");
    expect(res.statusCode).toBe(403);
    expect(await deniedEvent(assessmentId, "missing_permission")).not.toBeNull();
  });

  it("blocks and audits self-review, and records no decision", async () => {
    const { assessmentId } = await newAssessmentId("ADMIN", adminUserId);
    const res = await review(assessmentId, adminUserId, "ADMIN");
    expect(res.statusCode).toBe(403);
    expect(await deniedEvent(assessmentId, "self_review")).not.toBeNull();
    const after = await prisma.aiImpactAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewDecision).toBeNull();
  });

  it("fails closed when no assessor is recorded, with a clear message and an audit event", async () => {
    const { assessmentId } = await newAssessmentId();
    await prisma.aiImpactAssessment.update({ where: { id: assessmentId }, data: { assessorUserId: null } });
    const res = await review(assessmentId, reviewerUserId, "REVIEWER");
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toContain("an assessor has not been assigned");
    expect(await deniedEvent(assessmentId, "no_assessor_assigned")).not.toBeNull();
  });

  it("allows an independent REVIEWER to approve, completes the assessment, and audits it", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await review(assessmentId, reviewerUserId, "REVIEWER", "APPROVED", "Independent review complete");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("COMPLETED");
    expect(body.reviewDecision).toBe("APPROVED");
    expect(body.reviewerUserId).toBe(reviewerUserId);
    expect(body.completedAt).not.toBeNull();
    const event = await prisma.auditEvent.findFirst({
      where: { tenantId: tenantAId, action: "ai_impact_assessment.review_recorded", targetId: assessmentId, outcome: "SUCCESS" },
    });
    expect(event).not.toBeNull();
  });

  it("blocks a second review after approval, preserves the original, and audits the denial", async () => {
    const { assessmentId } = await newAssessmentId();
    await review(assessmentId, reviewerUserId, "REVIEWER", "APPROVED", "Original approval");
    const before = await prisma.aiImpactAssessment.findUnique({ where: { id: assessmentId } });
    const second = await review(assessmentId, adminUserId, "ADMIN", "REJECTED", "Attempted overwrite");
    expect(second.statusCode).toBe(409);
    const after = await prisma.aiImpactAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewerUserId).toBe(reviewerUserId);
    expect(after?.reviewDecision).toBe("APPROVED");
    expect(after?.reviewRationale).toBe("Original approval");
    expect(after?.reviewedAt?.getTime()).toBe(before?.reviewedAt?.getTime());
    expect(await deniedEvent(assessmentId, "already_completed")).not.toBeNull();
  });

  it("allows only one of two simultaneous approvals to succeed", async () => {
    const { assessmentId } = await newAssessmentId();
    const [first, second] = await Promise.all([
      review(assessmentId, reviewerUserId, "REVIEWER", "APPROVED", "Reviewer approval"),
      review(assessmentId, adminUserId, "ADMIN", "APPROVED", "Admin approval"),
    ]);
    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? "Reviewer approval" : "Admin approval";
    const after = await prisma.aiImpactAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewRationale).toBe(winner);
    expect(after?.status).toBe("COMPLETED");
  });

  it("a REJECTED review keeps the assessment editable and not completed", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await review(assessmentId, reviewerUserId, "REVIEWER", "REJECTED", "Needs more detail");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("IN_PROGRESS");
    expect((await addImpact(assessmentId, beneficialImpact)).statusCode).toBe(201);
  });

  it("returns 404 to a reviewer from another tenant and records no decision", async () => {
    const { assessmentId } = await newAssessmentId();
    const res = await review(assessmentId, tenantBUserId, "ADMIN", "APPROVED", "Cross-tenant", tenantBId);
    expect(res.statusCode).toBe(404);
    const after = await prisma.aiImpactAssessment.findUnique({ where: { id: assessmentId } });
    expect(after?.reviewDecision).toBeNull();
  });
});

describe("AI Impact Assessment - immutability after COMPLETED", () => {
  let lockedAssessmentId: string;
  let lockedImpactId: string;
  let snapshotBefore: string;

  async function snapshot(id: string) {
    const record = await prisma.aiImpactAssessment.findUnique({
      where: { id },
      include: { impacts: { orderBy: { createdAt: "asc" } } },
    });
    return JSON.stringify(record);
  }

  beforeAll(async () => {
    const { assessmentId } = await newAssessmentId();
    lockedAssessmentId = assessmentId;
    lockedImpactId = JSON.parse((await addImpact(assessmentId, adverseImpact)).body).id;
    await addImpact(assessmentId, beneficialImpact);
    const approved = await review(assessmentId, reviewerUserId, "REVIEWER", "APPROVED", "Approved before lock test");
    expect(approved.statusCode).toBe(200);
    snapshotBefore = await snapshot(assessmentId);
  });

  it("1. blocks adding an impact to a completed assessment", async () => {
    const res = await addImpact(lockedAssessmentId, beneficialImpact);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain("cannot be changed");
  });

  it("2. blocks editing an impact on a completed assessment", async () => {
    const res = await server.inject({
      method: "PATCH", url: `/ai-impacts/${lockedImpactId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { severity: 1 },
    });
    expect(res.statusCode).toBe(409);
  });

  it("3. blocks deleting an impact on a completed assessment", async () => {
    const res = await server.inject({
      method: "DELETE", url: `/ai-impacts/${lockedImpactId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(409);
  });

  it("4. leaves the persisted completed assessment and its impacts unchanged", async () => {
    const renameRes = await server.inject({
      method: "PATCH", url: `/ai-impact-assessments/${lockedAssessmentId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Renamed after approval" },
    });
    expect(renameRes.statusCode).toBe(409);
    const snapshotAfter = await snapshot(lockedAssessmentId);
    expect(snapshotAfter).toBe(snapshotBefore);
    const impacts = await prisma.aiImpact.count({ where: { assessmentId: lockedAssessmentId } });
    expect(impacts).toBe(2);
  });
});

describe("Regression - existing workflows still work", () => {
  it("Step 6 AI Risk Assessment can still be created and retrieved, and is separate from impact assessments", async () => {
    const sysId = await createAiSystem(tenantAId, "ADMIN", adminUserId);
    const createRes = await server.inject({
      method: "POST", url: `/ai-systems/${sysId}/risk-assessments`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { name: "Regression Risk Assessment" },
    });
    expect(createRes.statusCode).toBe(201);
    const riskAssessmentId = JSON.parse(createRes.body).id;
    const getRes = await server.inject({
      method: "GET", url: `/ai-risk-assessments/${riskAssessmentId}`,
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
    });
    expect(getRes.statusCode).toBe(200);
    expect(await prisma.aiImpactAssessment.count({ where: { aiSystemId: sysId } })).toBe(0);
  });

  it("Vendor/TPRM assessment list endpoint still responds", async () => {
    const res = await server.inject({
      method: "GET", url: "/assessments",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
  });
});