import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let reviewerUserId: string;
let auditorUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;
let fwId: string;
let ctrlA: string;

// The "s8-test-" prefix keeps this framework out of aiControlSet.test.ts's library snapshot.
const PREFIX = "s8-test-s13-";
// Spread test traffic across addresses so the global 100 req/min rate limit does not throttle this suite.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.13." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
const FUTURE = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const REQ = {
  residualRiskStatement: "Some low-impact incorrect responses may still reach customers",
  justification: "Existing controls reduce exposure; further remediation is planned for a later release",
  conditions: "Accepted only while human escalation stays enabled",
  expiresAt: FUTURE,
};

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function newSystem() {
  const sys = await call("POST", "/ai-systems", adminUserId, "ADMIN", { name: "S13 Customer Service AI", origin: "INTERNAL" });
  return sys.body.id as string;
}

async function riskOn(sysId: string, overrides: Record<string, unknown> = {}) {
  const assessment = await prisma.aiRiskAssessment.create({ data: { tenantId: tenantAId, aiSystemId: sysId, name: "S13 Risk Assessment" } });
  const risk = await prisma.aiRisk.create({
    data: {
      tenantId: tenantAId,
      assessmentId: assessment.id,
      title: "Incorrect customer guidance",
      category: "OPERATIONAL" as never,
      statement: "Incorrect AI guidance may cause financial or compliance impact",
      likelihood: 3,
      impact: 3,
      inherentScore: 9,
      inherentRating: "MODERATE" as never,
      residualLikelihood: 2,
      residualImpact: 2,
      residualScore: 4,
      residualRating: "LOW" as never,
      treatment: "ACCEPT" as never,
      treatmentOwnerUserId: analystUserId,
      ...overrides,
    },
  });
  return risk.id;
}

async function openFindingOn() {
  const sysId = await newSystem();
  expect((await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", { status: "APPLICABLE", rationale: "Primary" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", { controlIds: [ctrlA] })).status).toBe(201);
  const recA = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } })).id;
  const doc = await call("POST", `/ai-systems/${sysId}/evidence`, analystUserId, "ANALYST", { displayFilename: "Policy.pdf", documentType: "Policy" });
  const link = await call("POST", `/ai-system-controls/${recA}/evidence`, analystUserId, "ANALYST", { evidenceDocumentId: doc.body.id });
  expect((await call("POST", `/ai-control-evidence/${link.body.id}/review`, adminUserId, "ADMIN", { decision: "ACCEPT", rationale: "Adequate" })).status).toBe(200);
  const test = await call("POST", `/ai-system-controls/${recA}/tests`, reviewerUserId, "REVIEWER", { method: "SAMPLE_TESTING", procedure: "Sample 10" });
  expect((await call("POST", `/ai-control-tests/${test.body.id}/evidence`, reviewerUserId, "REVIEWER", { evidenceLinkId: link.body.id })).status).toBe(201);
  const draft = { testDate: "2026-09-20", designEffectiveness: "EFFECTIVE", operatingEffectiveness: "PARTIALLY_EFFECTIVE", overallEffectiveness: "PARTIALLY_EFFECTIVE", conclusionRationale: "2 of 10" };
  expect((await call("PATCH", `/ai-control-tests/${test.body.id}`, reviewerUserId, "REVIEWER", draft)).status).toBe(200);
  expect((await call("POST", `/ai-control-tests/${test.body.id}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(200);
  const finding = await call("POST", `/ai-control-tests/${test.body.id}/findings`, auditorUserId, "AUDITOR", { title: "Approvals missing", description: "2 of 10", severity: "HIGH" });
  expect((await call("POST", `/governance-findings/${finding.body.id}/review`, reviewerUserId, "REVIEWER", { decision: "CONFIRM", rationale: "Real" })).status).toBe(200);
  return { sysId, recA, findingId: finding.body.id as string };
}

async function requestOn(riskId: string, payload: Record<string, unknown> = REQ, userId?: string, role = "ANALYST") {
  return call("POST", `/ai-risks/${riskId}/risk-acceptance`, userId ?? analystUserId, role, payload);
}

async function decide(id: string, decision: string, rationale: unknown = "Reviewed residual risk and conditions", userId?: string, role = "REVIEWER") {
  return call("POST", `/risk-acceptances/${id}/decision`, userId ?? reviewerUserId, role, { decision, rationale });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S13 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S13 Test Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s13-${labelText}-${stamp}`, email: `s13-${labelText}-${stamp}@example.com`, displayName: `S13 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S13 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = (
    await prisma.control.create({
      data: { frameworkVersionId: version.id, controlId: "S13-1", title: "Test control S13-1", summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
    })
  ).id;
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.riskAcceptance.deleteMany({ where: { tenantId: tenants } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.governanceFindingReview.deleteMany({ where: { tenantId: tenants } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlTestEvidence.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlTest.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlEvidenceReview.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControlEvidence.deleteMany({ where: { tenantId: tenants } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.framework.deleteMany({ where: { id: fwId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, auditorUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("Derived state", () => {
  it("derives ACTIVE / EXPIRED only from APPROVED + expiresAt", () => {
    const now = Date.now();
    expect(deriveAcceptanceState("PENDING_REVIEW", new Date(now + 1000), now)).toBe("PENDING_REVIEW");
    expect(deriveAcceptanceState("REJECTED", new Date(now + 1000), now)).toBe("REJECTED");
    expect(deriveAcceptanceState("APPROVED", new Date(now + 1000), now)).toBe("ACTIVE");
    expect(deriveAcceptanceState("APPROVED", new Date(now - 1000), now)).toBe("EXPIRED");
  });
});

describe("Requesting Risk Acceptance", () => {
  it("creates a PENDING_REVIEW request with a residual-risk snapshot, requestor and audit event", async () => {
    const riskId = await riskOn(await newSystem());
    const res = await requestOn(riskId);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.state).toBe("PENDING_REVIEW");
    expect(res.body.requestedBy.id).toBe(analystUserId);
    expect(res.body.residualScoreAtRequest).toBe(4);
    expect(res.body.residualRatingAtRequest).toBe("LOW");
    expect(res.body.vendorId).toBeNull();
    expect(res.body.approvedByUserId).toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "risk_acceptance.requested", targetId: res.body.id } })).not.toBeNull();
  });

  it("requires a treatment owner, assessed residual risk, justification, statement and a future expiry", async () => {
    const sysId = await newSystem();
    expect((await requestOn(await riskOn(sysId, { treatmentOwnerUserId: null }))).status).toBe(400);
    expect((await requestOn(await riskOn(sysId, { residualLikelihood: null, residualImpact: null, residualScore: null, residualRating: null }))).status).toBe(400);
    const riskId = await riskOn(sysId);
    expect((await requestOn(riskId, { ...REQ, justification: "" })).status).toBe(400);
    expect((await requestOn(riskId, { ...REQ, residualRiskStatement: " " })).status).toBe(400);
    expect((await requestOn(riskId, { ...REQ, expiresAt: undefined })).status).toBe(400);
    expect((await requestOn(riskId, { ...REQ, expiresAt: "2020-01-01" })).status).toBe(400);
  });

  it("lets ADMIN and ANALYST request; denies REVIEWER, AUDITOR and READ_ONLY", async () => {
    const riskId = await riskOn(await newSystem());
    expect((await requestOn(riskId, REQ, reviewerUserId, "REVIEWER")).status).toBe(403);
    expect((await requestOn(riskId, REQ, auditorUserId, "AUDITOR")).status).toBe(403);
    expect((await requestOn(riskId, REQ, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    expect((await requestOn(riskId, REQ, adminUserId, "ADMIN")).status).toBe(201);
  });

  it("allows only one pending request per risk", async () => {
    const riskId = await riskOn(await newSystem());
    expect((await requestOn(riskId)).status).toBe(201);
    expect((await requestOn(riskId)).status).toBe(409);
  });
});

describe("Independent decision", () => {
  it("blocks the requestor from deciding their own request (audited as DENIED)", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId, REQ, adminUserId, "ADMIN");
    expect((await decide(req.body.id, "APPROVE", "Self", adminUserId, "ADMIN")).status).toBe(403);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "risk_acceptance.denied", targetId: req.body.id, outcome: "DENIED" } })).not.toBeNull();
    expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: req.body.id } })).status).toBe("PENDING_REVIEW");
  });

  it("denies ANALYST and AUDITOR from deciding", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId, REQ, adminUserId, "ADMIN");
    expect((await decide(req.body.id, "APPROVE", "x", analystUserId, "ANALYST")).status).toBe(403);
    expect((await decide(req.body.id, "APPROVE", "x", auditorUserId, "AUDITOR")).status).toBe(403);
  });

  it("REJECT requires a rationale, preserves the decision, and allows a new request afterwards", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    expect((await decide(req.body.id, "REJECT", "")).status).toBe(400);
    expect((await decide(req.body.id, "MAYBE")).status).toBe(400);
    const res = await decide(req.body.id, "REJECT", "Conditions too vague");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(res.body.decidedBy.id).toBe(reviewerUserId);
    expect(res.body.approvedByUserId).toBeNull();
    expect(res.body.decisionRationale).toBe("Conditions too vague");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "risk_acceptance.rejected", targetId: req.body.id } })).not.toBeNull();
    expect((await requestOn(riskId)).status).toBe(201);
  });

  it("APPROVE makes it ACTIVE without changing the risk, and blocks a second active acceptance", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    const res = await decide(req.body.id, "APPROVE", "Residual risk is tolerable under the conditions");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.state).toBe("ACTIVE");
    expect(res.body.approvedByUserId).toBe(reviewerUserId);
    const risk = await prisma.aiRisk.findUniqueOrThrow({ where: { id: riskId } });
    expect(risk.residualScore).toBe(4);
    expect(risk.treatment).toBe("ACCEPT");
    expect(await prisma.remediationAction.count({ where: { aiRiskId: riskId } })).toBe(0);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "risk_acceptance.approved", targetId: req.body.id } })).not.toBeNull();
    expect((await requestOn(riskId)).status).toBe(409);
  });

  it("shows EXPIRED once the date passes (derived, no mutation) and then allows a new request", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    expect((await decide(req.body.id, "APPROVE")).status).toBe(200);
    await prisma.riskAcceptance.update({ where: { id: req.body.id }, data: { expiresAt: new Date(Date.now() - 24 * 3600 * 1000) } });
    const view = await call("GET", `/ai-risks/${riskId}/risk-acceptance`, readOnlyUserId, "READ_ONLY");
    expect(view.body.acceptances[0].state).toBe("EXPIRED");
    expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: req.body.id } })).status).toBe("APPROVED");
    expect((await requestOn(riskId)).status).toBe(201);
  });

  it("keeps decided records immutable and lets only the requestor edit while pending", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    expect((await call("PATCH", `/risk-acceptances/${req.body.id}`, adminUserId, "ADMIN", { conditions: "Other" })).status).toBe(403);
    expect((await call("PATCH", `/risk-acceptances/${req.body.id}`, analystUserId, "ANALYST", { conditions: "Revised condition" })).status).toBe(200);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "risk_acceptance.updated", targetId: req.body.id } })).not.toBeNull();
    expect((await decide(req.body.id, "APPROVE")).status).toBe(200);
    expect((await call("PATCH", `/risk-acceptances/${req.body.id}`, analystUserId, "ANALYST", { justification: "Rewrite" })).status).toBe(409);
    expect((await decide(req.body.id, "REJECT", "Too late", adminUserId, "ADMIN")).status).toBe(409);
  });

  it("allows only one decision when two reviewers act at the same time", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    const [r1, r2] = await Promise.all([decide(req.body.id, "APPROVE"), decide(req.body.id, "REJECT", "No", adminUserId, "ADMIN")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
  });
});

describe("Finding context", () => {
  it("links an OPEN Finding of the same AI system as context - the Finding stays OPEN after approval", async () => {
    const { sysId, recA, findingId } = await openFindingOn();
    const riskId = await riskOn(sysId);
    const req = await requestOn(riskId, { ...REQ, governanceFindingId: findingId });
    expect(req.status).toBe(201);
    expect((await decide(req.body.id, "APPROVE")).status).toBe(200);
    const finding = await prisma.governanceFinding.findUniqueOrThrow({ where: { id: findingId } });
    expect(finding.status).toBe("OPEN");
    const list = await call("GET", `/ai-system-controls/${recA}/findings`, readOnlyUserId, "READ_ONLY");
    expect(list.body.findings[0].status).toBe("OPEN");
    expect(list.body.findings[0].riskAcceptances).toHaveLength(1);
    expect(await prisma.remediationAction.count({ where: { governanceFindingId: findingId } })).toBe(0);
  });

  it("rejects a Finding from another AI system", async () => {
    const { findingId } = await openFindingOn();
    const otherRisk = await riskOn(await newSystem());
    expect((await requestOn(otherRisk, { ...REQ, governanceFindingId: findingId })).status).toBe(400);
  });
});

describe("Integrity guards and regression", () => {
  it("returns 409 when deleting a risk with acceptance history; deletes normally otherwise", async () => {
    const sysId = await newSystem();
    const withHistory = await riskOn(sysId);
    expect((await requestOn(withHistory)).status).toBe(201);
    expect((await call("DELETE", `/ai-risks/${withHistory}`, analystUserId, "ANALYST")).status).toBe(409);
    const plain = await riskOn(sysId);
    expect((await call("DELETE", `/ai-risks/${plain}`, analystUserId, "ANALYST")).status).toBe(204);
  });

  it("lists AI Risk Acceptance with derived state", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    const res = await call("GET", "/risk-acceptances", readOnlyUserId, "READ_ONLY");
    expect(res.status).toBe(200);
    const row = res.body.riskAcceptances.find((r: { id: string }) => r.id === req.body.id);
    expect(row.state).toBe("PENDING_REVIEW");
    expect(row.aiRisk.title).toBe("Incorrect customer guidance");
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every Risk Acceptance route", async () => {
    const riskId = await riskOn(await newSystem());
    const req = await requestOn(riskId);
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("GET", `/ai-risks/${riskId}/risk-acceptance`)).status).toBe(404);
    expect((await b("POST", `/ai-risks/${riskId}/risk-acceptance`, REQ)).status).toBe(404);
    expect((await b("PATCH", `/risk-acceptances/${req.body.id}`, { conditions: "x" })).status).toBe(404);
    expect((await b("POST", `/risk-acceptances/${req.body.id}/decision`, { decision: "APPROVE", rationale: "x" })).status).toBe(404);
    const list = await b("GET", "/risk-acceptances");
    expect(list.body.riskAcceptances).toHaveLength(0);
    expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: req.body.id } })).status).toBe("PENDING_REVIEW");
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/risk-acceptances", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});