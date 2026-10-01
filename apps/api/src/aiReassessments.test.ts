import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let reviewerUserId: string;
let auditorUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;

// Spread test traffic across addresses so the global 100 req/min rate limit does not throttle this suite.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.14." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}

function cookieFor(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function newSystem(tenantId?: string, userId?: string) {
  const res = await call("POST", "/ai-systems", userId ?? adminUserId, "ADMIN", { name: "S14 Customer Assistant", origin: "INTERNAL" }, tenantId);
  return res.body.id as string;
}

async function newRiskAssessment(sysId: string) {
  const res = await call("POST", `/ai-systems/${sysId}/risk-assessments`, analystUserId, "ANALYST", { name: "Risk assessment" });
  expect(res.status).toBe(201);
  return res.body as { id: string; version: number };
}

async function approve(assessmentId: string) {
  const res = await call("POST", `/ai-risk-assessments/${assessmentId}/review`, reviewerUserId, "REVIEWER", { decision: "APPROVED", rationale: "Reviewed" });
  expect(res.status).toBe(200);
}

async function addRisk(assessmentId: string) {
  return call("POST", `/ai-risk-assessments/${assessmentId}/risks`, analystUserId, "ANALYST", { title: "Wrong guidance", category: "OPERATIONAL", statement: "x", likelihood: 3, impact: 3 });
}

async function start(sysId: string, payload: Record<string, unknown> = {}, userId?: string, role = "ANALYST", tenantId?: string) {
  return call("POST", `/ai-systems/${sysId}/reassessments`, userId ?? analystUserId, role, { reason: "PERIODIC_REVIEW", whatChanged: "Six-month review", ...payload }, tenantId);
}

async function complete(id: string, conclusion: string, rationale: unknown = "Reviewed the governance baseline", userId?: string, role = "ANALYST") {
  return call("POST", `/ai-reassessments/${id}/complete`, userId ?? analystUserId, role, { conclusion, rationale });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S14 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S14 Test Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s14-${labelText}-${stamp}`, email: `s14-${labelText}-${stamp}@example.com`, displayName: `S14 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.aiReassessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.riskAcceptance.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, auditorUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("Risk Assessment integrity repair", () => {
  it("allocates versions 1, 2, 3 per AI system", async () => {
    const sysId = await newSystem();
    expect((await newRiskAssessment(sysId)).version).toBe(1);
    expect((await newRiskAssessment(sysId)).version).toBe(2);
    expect((await newRiskAssessment(sysId)).version).toBe(3);
  });

  it("gives distinct versions when two are created at the same time", async () => {
    const sysId = await newSystem();
    const [a, b] = await Promise.all([
      call("POST", `/ai-systems/${sysId}/risk-assessments`, analystUserId, "ANALYST", { name: "A" }),
      call("POST", `/ai-systems/${sysId}/risk-assessments`, analystUserId, "ANALYST", { name: "B" }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.version, b.body.version].sort()).toEqual([1, 2]);
  });

  it("does not let generic PATCH set COMPLETED", async () => {
    const ra = await newRiskAssessment(await newSystem());
    expect((await call("PATCH", `/ai-risk-assessments/${ra.id}`, analystUserId, "ANALYST", { status: "COMPLETED" })).status).toBe(400);
    expect((await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: ra.id } })).status).not.toBe("COMPLETED");
  });

  it("keeps in-progress assessments and their risks editable", async () => {
    const ra = await newRiskAssessment(await newSystem());
    expect((await call("PATCH", `/ai-risk-assessments/${ra.id}`, analystUserId, "ANALYST", { name: "Renamed", status: "IN_PROGRESS" })).status).toBe(200);
    const risk = await addRisk(ra.id);
    expect(risk.status).toBe(201);
    expect((await call("PATCH", `/ai-risks/${risk.body.id}`, analystUserId, "ANALYST", { likelihood: 4 })).status).toBe(200);
  });

  it("locks a completed assessment and the assessed state of its risks; treatment planning stays editable", async () => {
    const ra = await newRiskAssessment(await newSystem());
    const risk = await addRisk(ra.id);
    await approve(ra.id);
    expect((await call("PATCH", `/ai-risk-assessments/${ra.id}`, analystUserId, "ANALYST", { name: "Rewrite" })).status).toBe(409);
    expect((await call("PATCH", `/ai-risk-assessments/${ra.id}`, analystUserId, "ANALYST", { status: "IN_PROGRESS" })).status).toBe(409);
    expect((await addRisk(ra.id)).status).toBe(409);
    expect((await call("PATCH", `/ai-risks/${risk.body.id}`, analystUserId, "ANALYST", { likelihood: 5 })).status).toBe(409);
    expect((await call("PATCH", `/ai-risks/${risk.body.id}`, analystUserId, "ANALYST", { residualLikelihood: 1, residualImpact: 1 })).status).toBe(409);
    expect((await call("DELETE", `/ai-risks/${risk.body.id}`, analystUserId, "ANALYST")).status).toBe(409);
    expect((await call("PATCH", `/ai-risks/${risk.body.id}`, analystUserId, "ANALYST", { treatment: "MITIGATE", treatmentRationale: "Plan" })).status).toBe(200);
    const stored = await prisma.aiRisk.findUniqueOrThrow({ where: { id: risk.body.id } });
    expect(stored.likelihood).toBe(3);
  });

  it("keeps the completed version unchanged when a new version is created", async () => {
    const sysId = await newSystem();
    const v1 = await newRiskAssessment(sysId);
    await approve(v1.id);
    const before = await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: v1.id } });
    const v2 = await newRiskAssessment(sysId);
    expect(v2.version).toBe(2);
    const after = await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: v1.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.name).toBe(before.name);
    expect(after.reviewDecision).toBe("APPROVED");
  });
});

describe("Initiating a reassessment", () => {
  it("captures the prior completed baseline, a classification snapshot and an audit event", async () => {
    const sysId = await newSystem();
    const v1 = await newRiskAssessment(sysId);
    await approve(v1.id);
    const res = await start(sysId, { reason: "MATERIAL_CHANGE", whatChanged: "Now customer-facing", materialChange: true, materialChangeDescription: "External users affected" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.priorRiskAssessmentId).toBe(v1.id);
    expect(res.body.priorImpactAssessmentId).toBeNull();
    expect(res.body.snapshotAtStart.lifecycleStatus).toBe("PROPOSED");
    expect(Object.keys(res.body.snapshotAtStart)).toHaveLength(13);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_reassessment.initiated", targetId: res.body.id } })).not.toBeNull();
  });

  it("handles an AI system with no completed assessments explicitly", async () => {
    const res = await start(await newSystem());
    expect(res.status).toBe(201);
    expect(res.body.priorRiskAssessmentId).toBeNull();
  });

  it("validates reason, what changed and the material-change description", async () => {
    const sysId = await newSystem();
    expect((await start(sysId, { reason: "INCIDENT" })).status).toBe(400);
    expect((await start(sysId, { whatChanged: "" })).status).toBe(400);
    expect((await start(sysId, { materialChange: true })).status).toBe(400);
    expect((await start(sysId, { targetDate: "not-a-date" })).status).toBe(400);
  });

  it("allows only one reassessment in progress per AI system, even under concurrency", async () => {
    const sysId = await newSystem();
    const [a, b] = await Promise.all([start(sysId), start(sysId)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await start(sysId)).status).toBe(409);
  });

  it("lets ADMIN and ANALYST initiate; denies REVIEWER, AUDITOR and READ_ONLY; READ_ONLY can view", async () => {
    const sysId = await newSystem();
    expect((await start(sysId, {}, reviewerUserId, "REVIEWER")).status).toBe(403);
    expect((await start(sysId, {}, auditorUserId, "AUDITOR")).status).toBe(403);
    expect((await start(sysId, {}, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    const res = await start(sysId, {}, adminUserId, "ADMIN");
    expect(res.status).toBe(201);
    expect((await call("GET", `/ai-reassessments/${res.body.id}`, readOnlyUserId, "READ_ONLY")).status).toBe(200);
    expect((await call("GET", `/ai-systems/${sysId}/reassessments`, readOnlyUserId, "READ_ONLY")).body.reassessments).toHaveLength(1);
  });
});

describe("Linking new assessments", () => {
  it("rejects an assessment created before the reassessment or from another AI system; accepts a new one", async () => {
    const sysId = await newSystem();
    const old = await newRiskAssessment(sysId);
    const r = await start(sysId);
    expect((await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { newRiskAssessmentId: old.id })).status).toBe(400);
    const other = await newRiskAssessment(await newSystem());
    expect((await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { newRiskAssessmentId: other.id })).status).toBe(400);
    const fresh = await newRiskAssessment(sysId);
    const res = await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { newRiskAssessmentId: fresh.id });
    expect(res.status).toBe(200);
    expect(res.body.newRiskAssessmentId).toBe(fresh.id);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_reassessment.updated", targetId: r.body.id } })).not.toBeNull();
  });
});

describe("Completing a reassessment", () => {
  it("GOVERNANCE_UPDATED requires a linked NEW assessment that is COMPLETED", async () => {
    const sysId = await newSystem();
    const r = await start(sysId, { reason: "MATERIAL_CHANGE", materialChange: true, materialChangeDescription: "Customer-facing" });
    expect((await complete(r.body.id, "GOVERNANCE_UPDATED")).status).toBe(400);
    const fresh = await newRiskAssessment(sysId);
    await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { newRiskAssessmentId: fresh.id });
    expect((await complete(r.body.id, "GOVERNANCE_UPDATED")).status).toBe(400);
    await approve(fresh.id);
    const res = await complete(r.body.id, "GOVERNANCE_UPDATED", "New risk assessment v1 approved for the customer-facing use");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.snapshotAtCompletion).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_reassessment.completed", targetId: r.body.id } })).not.toBeNull();
  });

  it("completes with NO_MATERIAL_CHANGE and FOLLOW_UP_REQUIRED, requires a rationale, and allows a later cycle", async () => {
    const sysId = await newSystem();
    const first = await start(sysId);
    expect((await complete(first.body.id, "NO_MATERIAL_CHANGE", "")).status).toBe(400);
    expect((await complete(first.body.id, "CLOSED")).status).toBe(400);
    expect((await complete(first.body.id, "NO_MATERIAL_CHANGE")).status).toBe(200);
    const second = await start(sysId, { reason: "REGULATORY_CHANGE", whatChanged: "New AI regulation" });
    expect(second.status).toBe(201);
    expect((await complete(second.body.id, "FOLLOW_UP_REQUIRED", "Control testing needed")).status).toBe(200);
    expect((await call("GET", `/ai-systems/${sysId}/reassessments`, readOnlyUserId, "READ_ONLY")).body.reassessments).toHaveLength(2);
  });

  it("is immutable once completed", async () => {
    const r = await start(await newSystem());
    expect((await complete(r.body.id, "NO_MATERIAL_CHANGE")).status).toBe(200);
    expect((await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { whatChanged: "Rewrite" })).status).toBe(409);
    expect((await complete(r.body.id, "FOLLOW_UP_REQUIRED", "Again")).status).toBe(409);
  });

  it("allows only one completion when two users complete at the same time", async () => {
    const r = await start(await newSystem());
    const [a, b] = await Promise.all([complete(r.body.id, "NO_MATERIAL_CHANGE"), complete(r.body.id, "FOLLOW_UP_REQUIRED", "Other", adminUserId, "ADMIN")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it("records classification changed during the cycle, and changes nothing else automatically", async () => {
    const sysId = await newSystem();
    const v1 = await newRiskAssessment(sysId);
    await approve(v1.id);
    const r = await start(sysId, { reason: "MATERIAL_CHANGE", materialChange: true, materialChangeDescription: "External users" });
    expect((await call("PATCH", `/ai-systems/${sysId}`, adminUserId, "ADMIN", { externalImpact: true })).status).toBe(200);
    expect((await complete(r.body.id, "FOLLOW_UP_REQUIRED", "Impact assessment needed")).status).toBe(200);
    const detail = await call("GET", `/ai-reassessments/${r.body.id}`, readOnlyUserId, "READ_ONLY");
    expect(detail.body.classificationChanges.map((c: { field: string }) => c.field)).toContain("externalImpact");
    const system = await prisma.aiSystem.findUniqueOrThrow({ where: { id: sysId } });
    expect(system.lifecycleStatus).toBe("PROPOSED");
    expect(system.assessmentStatus).toBe("NOT_ASSESSED");
    expect((await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("COMPLETED");
  });
});

describe("Risk Acceptance review", () => {
  it("links an acceptance of the same AI system as context, shows EXPIRED, and never renews or changes it", async () => {
    const sysId = await newSystem();
    const ra = await newRiskAssessment(sysId);
    const risk = await addRisk(ra.id);
    const acceptance = await prisma.riskAcceptance.create({
      data: {
        tenantId: tenantAId,
        aiRiskId: risk.body.id,
        status: "APPROVED",
        justification: "Tolerable",
        residualRiskStatement: "Low",
        expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
        requestedByUserId: analystUserId,
        decidedByUserId: reviewerUserId,
        approvedByUserId: reviewerUserId,
        decidedAt: new Date(),
        decisionRationale: "OK",
      },
    });
    expect((await start(sysId, { relatedRiskAcceptanceId: acceptance.id })).status).toBe(400);
    const otherAcceptanceSys = await newSystem();
    expect((await start(otherAcceptanceSys, { reason: "RISK_ACCEPTANCE_REVIEW", relatedRiskAcceptanceId: acceptance.id })).status).toBe(400);
    const r = await start(sysId, { reason: "RISK_ACCEPTANCE_REVIEW", whatChanged: "Acceptance reached its review date", relatedRiskAcceptanceId: acceptance.id });
    expect(r.status).toBe(201);
    const detail = await call("GET", `/ai-reassessments/${r.body.id}`, readOnlyUserId, "READ_ONLY");
    expect(detail.body.relatedRiskAcceptance.state).toBe("EXPIRED");
    expect((await complete(r.body.id, "FOLLOW_UP_REQUIRED", "Request a new acceptance if still appropriate")).status).toBe(200);
    const stored = await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: acceptance.id } });
    expect(stored.status).toBe("APPROVED");
    expect(stored.expiresAt?.getTime()).toBe(acceptance.expiresAt?.getTime());
    expect(await prisma.riskAcceptance.count({ where: { aiRiskId: risk.body.id } })).toBe(1);
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every reassessment route", async () => {
    const sysId = await newSystem();
    const r = await start(sysId);
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("POST", `/ai-systems/${sysId}/reassessments`, { reason: "OTHER", whatChanged: "x" })).status).toBe(404);
    expect((await b("GET", `/ai-systems/${sysId}/reassessments`)).status).toBe(404);
    expect((await b("GET", `/ai-reassessments/${r.body.id}`)).status).toBe(404);
    expect((await b("PATCH", `/ai-reassessments/${r.body.id}`, { whatChanged: "x" })).status).toBe(404);
    expect((await b("POST", `/ai-reassessments/${r.body.id}/complete`, { conclusion: "NO_MATERIAL_CHANGE", rationale: "x" })).status).toBe(404);
    const bSys = await newSystem(tenantBId, tenantBUserId);
    const bRa = await call("POST", `/ai-systems/${bSys}/risk-assessments`, tenantBUserId, "ADMIN", { name: "B" }, tenantBId);
    expect((await call("PATCH", `/ai-reassessments/${r.body.id}`, analystUserId, "ANALYST", { newRiskAssessmentId: bRa.body.id })).status).toBe(404);
    expect((await prisma.aiReassessment.findUniqueOrThrow({ where: { id: r.body.id } })).status).toBe("IN_PROGRESS");
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/ai-reassessments/anything", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});