import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { nextDueDate, dueState } from "./aiMonitoring.js";
import { createSessionCookie } from "@vendorguard/auth";

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

const PREFIX = "s8-test-s15-";
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.15." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookieFor(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}
async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function newSystem(tenantId?: string, userId?: string) {
  return (await call("POST", "/ai-systems", userId ?? adminUserId, "ADMIN", { name: "S15 Loan AI", origin: "INTERNAL" }, tenantId)).body.id as string;
}
const CHECK = {
  title: "Review loan-officer override rate",
  whatToReview: "How often loan officers override AI credit recommendations",
  expectation: "Overrides stay within 5-20%",
  category: "HUMAN_OVERSIGHT",
  cadence: "MONTHLY",
};
async function newCheck(sysId: string, payload: Record<string, unknown> = {}, userId?: string, role = "ANALYST") {
  return call("POST", `/ai-systems/${sysId}/monitoring-checks`, userId ?? analystUserId, role, { ...CHECK, ...payload });
}
async function review(checkId: string, payload: Record<string, unknown> = {}, userId?: string, role = "REVIEWER") {
  return call("POST", `/ai-monitoring-checks/${checkId}/reviews`, userId ?? reviewerUserId, role, { observation: "Override rate reviewed", result: "ACCEPTABLE", rationale: "Within range", ...payload });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S15 Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S15 Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s15-${labelText}-${stamp}`, email: `s15-${labelText}-${stamp}@example.com`, displayName: `S15 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S15 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = (await prisma.control.create({ data: { frameworkVersionId: version.id, controlId: "S15-1", title: "Human oversight control", summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" } })).id;
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.aiMonitoringReview.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiReassessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiMonitoringCheck.deleteMany({ where: { tenantId: tenants } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlTest.deleteMany({ where: { tenantId: tenants } });
  await prisma.riskAcceptance.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
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

describe("Due calculation (derived, never stored)", () => {
  it("adds the cadence to the base date and derives the state", () => {
    const base = new Date("2026-01-15T00:00:00Z");
    expect(nextDueDate(base, "MONTHLY").toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(nextDueDate(base, "QUARTERLY").toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(nextDueDate(base, "SEMIANNUALLY").toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(nextDueDate(base, "ANNUALLY").toISOString().slice(0, 10)).toBe("2027-01-15");
    const now = Date.parse("2026-02-10T00:00:00Z");
    expect(dueState(new Date("2026-02-09T00:00:00Z"), true, now)).toBe("OVERDUE");
    expect(dueState(new Date("2026-02-15T00:00:00Z"), true, now)).toBe("DUE_SOON");
    expect(dueState(new Date("2026-03-15T00:00:00Z"), true, now)).toBe("NOT_DUE");
    expect(dueState(new Date("2026-02-09T00:00:00Z"), false, now)).toBe("INACTIVE");
  });
});

describe("Monitoring checks", () => {
  it("creates a check with owner, category and cadence, audited, due one cadence after creation", async () => {
    const res = await newCheck(await newSystem(), { ownerUserId: reviewerUserId });
    expect(res.status).toBe(201);
    expect(res.body.ownerUserId).toBe(reviewerUserId);
    expect(res.body.dueState).toBe("NOT_DUE");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_check.created", targetId: res.body.id } })).not.toBeNull();
  });

  it("validates owner, category, cadence and required text", async () => {
    const sysId = await newSystem();
    expect((await newCheck(sysId, { ownerUserId: tenantBUserId })).status).toBe(400);
    expect((await newCheck(sysId, { ownerEmail: "nobody@example.com" })).status).toBe(400);
    expect((await newCheck(sysId, { category: "LATENCY" })).status).toBe(400);
    expect((await newCheck(sysId, { cadence: "DAILY" })).status).toBe(400);
    expect((await newCheck(sysId, { expectation: "" })).status).toBe(400);
  });

  it("derives OVERDUE from the last review or creation date", async () => {
    const check = await newCheck(await newSystem());
    await prisma.aiMonitoringCheck.update({ where: { id: check.body.id }, data: { createdAt: new Date(Date.now() - 70 * 24 * 3600 * 1000) } });
    const list = await call("GET", `/ai-systems/${check.body.aiSystemId}/monitoring-checks`, readOnlyUserId, "READ_ONLY");
    expect(list.body.checks[0].dueState).toBe("OVERDUE");
    expect((await review(check.body.id)).status).toBe(201);
    const after = await call("GET", `/ai-systems/${check.body.aiSystemId}/monitoring-checks`, readOnlyUserId, "READ_ONLY");
    expect(after.body.checks[0].dueState).toBe("NOT_DUE");
  });

  it("updates and deactivates (audited); inactive checks accept no reviews; history kept", async () => {
    const check = await newCheck(await newSystem());
    expect((await review(check.body.id)).status).toBe(201);
    expect((await call("PATCH", `/ai-monitoring-checks/${check.body.id}`, adminUserId, "ADMIN", { cadence: "QUARTERLY" })).status).toBe(200);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_check.updated", targetId: check.body.id } })).not.toBeNull();
    const off = await call("PATCH", `/ai-monitoring-checks/${check.body.id}`, analystUserId, "ANALYST", { active: false });
    expect(off.body.active).toBe(false);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_check.deactivated", targetId: check.body.id } })).not.toBeNull();
    expect((await review(check.body.id)).status).toBe(409);
    expect(await prisma.aiMonitoringReview.count({ where: { checkId: check.body.id } })).toBe(1);
    expect((await call("DELETE", `/ai-monitoring-checks/${check.body.id}`, adminUserId, "ADMIN")).status).toBe(404);
  });
});

describe("RBAC matrix", () => {
  it("check administration: ADMIN/ANALYST allowed; REVIEWER/AUDITOR/READ_ONLY denied", async () => {
    const sysId = await newSystem();
    expect((await newCheck(sysId, {}, adminUserId, "ADMIN")).status).toBe(201);
    const check = await newCheck(sysId, {}, analystUserId, "ANALYST");
    expect(check.status).toBe(201);
    for (const [user, role] of [[reviewerUserId, "REVIEWER"], [auditorUserId, "AUDITOR"], [readOnlyUserId, "READ_ONLY"]] as const) {
      expect((await newCheck(sysId, {}, user, role)).status).toBe(403);
      expect((await call("PATCH", `/ai-monitoring-checks/${check.body.id}`, user, role, { active: false })).status).toBe(403);
    }
    expect((await prisma.aiMonitoringCheck.findUniqueOrThrow({ where: { id: check.body.id } })).active).toBe(true);
  });

  it("review recording: ADMIN/ANALYST/REVIEWER allowed; AUDITOR/READ_ONLY denied with no record", async () => {
    const check = await newCheck(await newSystem());
    expect((await review(check.body.id, {}, adminUserId, "ADMIN")).status).toBe(201);
    expect((await review(check.body.id, {}, analystUserId, "ANALYST")).status).toBe(201);
    expect((await review(check.body.id, { result: "REASSESSMENT_REQUIRED" }, reviewerUserId, "REVIEWER")).status).toBe(201);
    expect((await review(check.body.id, {}, auditorUserId, "AUDITOR")).status).toBe(403);
    expect((await review(check.body.id, {}, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    expect(await prisma.aiMonitoringReview.count({ where: { checkId: check.body.id } })).toBe(3);
    expect((await call("GET", `/ai-monitoring-checks/${check.body.id}/reviews`, auditorUserId, "AUDITOR")).status).toBe(200);
  });
});

describe("Monitoring reviews", () => {
  it("records qualitative and quantitative reviews and validates input", async () => {
    const check = await newCheck(await newSystem());
    const qual = await review(check.body.id, { observation: "Oversight procedure operating", periodCovered: "September 2026" });
    expect(qual.status).toBe(201);
    expect(qual.body.observedValue).toBeNull();
    const quant = await review(check.body.id, { observation: "Override rate", observedValue: 2, unit: "% overridden", result: "REASSESSMENT_REQUIRED" });
    expect(quant.body.observedValue).toBe(2);
    expect(quant.body.unit).toBe("% overridden");
    expect((await review(check.body.id, { observation: "" })).status).toBe(400);
    expect((await review(check.body.id, { rationale: " " })).status).toBe(400);
    expect((await review(check.body.id, { result: "FINE" })).status).toBe(400);
    expect((await review(check.body.id, { observedValue: "two" })).status).toBe(400);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_review.recorded", targetId: quant.body.id } })).not.toBeNull();
    const history = await call("GET", `/ai-monitoring-checks/${check.body.id}/reviews`, readOnlyUserId, "READ_ONLY");
    expect(history.body.reviews).toHaveLength(2);
  });

  it("is immutable - there is no edit or delete route", async () => {
    const check = await newCheck(await newSystem());
    const r = await review(check.body.id);
    expect((await call("PATCH", `/ai-monitoring-reviews/${r.body.id}`, adminUserId, "ADMIN", { result: "ATTENTION_REQUIRED" })).status).toBe(404);
    expect((await call("DELETE", `/ai-monitoring-reviews/${r.body.id}`, adminUserId, "ADMIN")).status).toBe(404);
    expect((await prisma.aiMonitoringReview.findUniqueOrThrow({ where: { id: r.body.id } })).result).toBe("ACCEPTABLE");
  });
});

describe("Explicit escalation to Reassessment", () => {
  it("recording REASSESSMENT_REQUIRED creates nothing; REVIEWER/AUDITOR cannot start; ANALYST starts with MONITORING_REVIEW", async () => {
    const sysId = await newSystem();
    const check = await newCheck(sysId);
    const r = await review(check.body.id, { observation: "Override rate dropped", observedValue: 2, unit: "% overridden", result: "REASSESSMENT_REQUIRED" });
    expect(await prisma.aiReassessment.count({ where: { aiSystemId: sysId } })).toBe(0);
    expect((await call("POST", `/ai-monitoring-reviews/${r.body.id}/start-reassessment`, reviewerUserId, "REVIEWER")).status).toBe(403);
    expect((await call("POST", `/ai-monitoring-reviews/${r.body.id}/start-reassessment`, auditorUserId, "AUDITOR")).status).toBe(403);
    expect(await prisma.aiReassessment.count({ where: { aiSystemId: sysId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { tenantId: tenantAId, action: "ai_monitoring_review.reassessment_started", targetId: r.body.id } })).toBe(0);
    const res = await call("POST", `/ai-monitoring-reviews/${r.body.id}/start-reassessment`, analystUserId, "ANALYST");
    expect(res.status).toBe(201);
    expect(res.body.reason).toBe("MONITORING_REVIEW");
    expect(res.body.whatChanged).toContain("Override rate dropped");
    expect(res.body.whatChanged).toContain("2 % overridden");
    expect((await prisma.aiMonitoringReview.findUniqueOrThrow({ where: { id: r.body.id } })).reassessmentId).toBe(res.body.id);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_review.reassessment_started", targetId: r.body.id } })).not.toBeNull();
    expect((await call("POST", `/ai-monitoring-reviews/${r.body.id}/start-reassessment`, analystUserId, "ANALYST")).status).toBe(409);
  });

  it("does not escalate ACCEPTABLE; respects the one-open-reassessment rule; manual MONITORING_REVIEW is rejected", async () => {
    const sysId = await newSystem();
    const check = await newCheck(sysId);
    const ok = await review(check.body.id);
    expect((await call("POST", `/ai-monitoring-reviews/${ok.body.id}/start-reassessment`, adminUserId, "ADMIN")).status).toBe(400);
    expect((await call("POST", `/ai-systems/${sysId}/reassessments`, analystUserId, "ANALYST", { reason: "MONITORING_REVIEW", whatChanged: "x" })).status).toBe(400);
    expect((await call("POST", `/ai-systems/${sysId}/reassessments`, analystUserId, "ANALYST", { reason: "PERIODIC_REVIEW", whatChanged: "Open cycle" })).status).toBe(201);
    const attention = await review(check.body.id, { result: "ATTENTION_REQUIRED" });
    expect((await call("POST", `/ai-monitoring-reviews/${attention.body.id}/start-reassessment`, adminUserId, "ADMIN")).status).toBe(409);
    expect((await prisma.aiMonitoringReview.findUniqueOrThrow({ where: { id: attention.body.id } })).reassessmentId).toBeNull();
  });
});

describe("Derived governance context", () => {
  it("shows facts VendorGuard already knows without storing monitoring records", async () => {
    const sysId = await newSystem();
    expect((await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", { status: "APPLICABLE", rationale: "Primary" })).status).toBe(201);
    expect((await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", { controlIds: [ctrlA] })).status).toBe(201);
    const rec = await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } });
    const past = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const test = await prisma.aiControlTest.create({
      data: {
        tenantId: tenantAId,
        aiSystemControlId: rec.id,
        testerUserId: reviewerUserId,
        status: "COMPLETED" as never,
        method: "SAMPLE_TESTING" as never,
        procedure: "Sample",
        testDate: new Date(Date.now() - 200 * 24 * 3600 * 1000),
        designEffectiveness: "EFFECTIVE" as never,
        operatingEffectiveness: "PARTIALLY_EFFECTIVE" as never,
        overallEffectiveness: "PARTIALLY_EFFECTIVE" as never,
        nextTestDate: past,
      },
    });
    const finding = await prisma.governanceFinding.create({
      data: { tenantId: tenantAId, aiControlTestId: test.id, title: "Approvals missing", description: "x", severity: "HIGH" as never, status: "OPEN" as never, createdByUserId: auditorUserId },
    });
    await prisma.remediationAction.create({
      data: { tenantId: tenantAId, governanceFindingId: finding.id, title: "Fix approvals", description: "x", status: "IN_PROGRESS" as never, dueDate: past, ownerUserId: analystUserId },
    });
    await prisma.evidenceDocument.create({
      data: { tenantId: tenantAId, aiSystemId: sysId, displayFilename: "Old policy.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 1, sha256Hash: "h", version: 1, documentType: "Policy", state: "CLEAN" as never, expirationDate: past, uploadedByUserId: analystUserId },
    });
    const ra = await prisma.aiRiskAssessment.create({ data: { tenantId: tenantAId, aiSystemId: sysId, name: "RA", version: 1 } });
    const risk = await prisma.aiRisk.create({
      data: { tenantId: tenantAId, assessmentId: ra.id, title: "Bias", category: "FAIRNESS" as never, statement: "x", likelihood: 2, impact: 2, inherentScore: 4, inherentRating: "LOW" as never },
    });
    await prisma.riskAcceptance.create({
      data: { tenantId: tenantAId, aiRiskId: risk.id, status: "APPROVED" as never, justification: "x", expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000), requestedByUserId: analystUserId, approvedByUserId: reviewerUserId, decidedByUserId: reviewerUserId },
    });
    await prisma.riskAcceptance.create({
      data: { tenantId: tenantAId, aiRiskId: risk.id, status: "APPROVED" as never, justification: "old", expiresAt: past, requestedByUserId: analystUserId, approvedByUserId: reviewerUserId, decidedByUserId: reviewerUserId },
    });
    expect((await call("POST", `/ai-systems/${sysId}/reassessments`, analystUserId, "ANALYST", { reason: "OTHER", whatChanged: "x", targetDate: past.toISOString() })).status).toBe(201);

    const before = await prisma.aiMonitoringReview.count({ where: { tenantId: tenantAId } });
    const res = await call("GET", `/ai-systems/${sysId}/monitoring`, auditorUserId, "AUDITOR");
    expect(res.status).toBe(200);
    const c = res.body.context;
    expect(c.retestsOverdue).toHaveLength(1);
    expect(c.expiredEvidence).toHaveLength(1);
    expect(c.openFindings[0].title).toBe("Approvals missing");
    expect(c.openFindings[0].ageDays).toBeGreaterThanOrEqual(0);
    expect(c.overdueRemediation).toHaveLength(1);
    const states = c.riskAcceptances.map((a: { state: string; expiringSoon: boolean }) => a.state + ":" + a.expiringSoon).sort();
    expect(states).toEqual(["ACTIVE:true", "EXPIRED:false"]);
    expect(c.reassessmentsInProgress[0].pastTarget).toBe(true);
    expect(await prisma.aiMonitoringReview.count({ where: { tenantId: tenantAId } })).toBe(before);
    expect(await prisma.aiMonitoringCheck.count({ where: { aiSystemId: sysId } })).toBe(0);
  });
});

describe("Lifecycle audit enrichment", () => {
  it("records from/to on lifecycle changes, not on other updates; retirement keeps its own event", async () => {
    const sysId = await newSystem();
    expect((await call("PATCH", `/ai-systems/${sysId}`, adminUserId, "ADMIN", { lifecycleStatus: "PRODUCTION" })).status).toBe(200);
    const lc = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.lifecycle_changed", targetId: sysId } });
    expect(lc?.metadataJson).toEqual({ from: "PROPOSED", to: "PRODUCTION" });
    expect((await call("PATCH", `/ai-systems/${sysId}`, adminUserId, "ADMIN", { name: "Renamed" })).status).toBe(200);
    const upd = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.updated", targetId: sysId } });
    expect(upd).not.toBeNull();
    expect(upd?.metadataJson ?? null).toBeNull();
    expect(await prisma.auditEvent.count({ where: { tenantId: tenantAId, action: "ai_system.lifecycle_changed", targetId: sysId } })).toBe(1);
    expect((await call("PATCH", `/ai-systems/${sysId}`, adminUserId, "ADMIN", { lifecycleStatus: "RETIRED" })).status).toBe(409);
    expect(await prisma.auditEvent.count({ where: { tenantId: tenantAId, action: "ai_system.lifecycle_changed", targetId: sysId } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { tenantId: tenantAId, action: "ai_system.retired", targetId: sysId } })).toBe(0);
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every monitoring route", async () => {
    const sysId = await newSystem();
    const check = await newCheck(sysId);
    const r = await review(check.body.id, { result: "REASSESSMENT_REQUIRED" });
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("GET", `/ai-systems/${sysId}/monitoring`)).status).toBe(404);
    expect((await b("GET", `/ai-systems/${sysId}/monitoring-checks`)).status).toBe(404);
    expect((await b("POST", `/ai-systems/${sysId}/monitoring-checks`, CHECK)).status).toBe(404);
    expect((await b("PATCH", `/ai-monitoring-checks/${check.body.id}`, { active: false })).status).toBe(404);
    expect((await b("GET", `/ai-monitoring-checks/${check.body.id}/reviews`)).status).toBe(404);
    expect((await b("POST", `/ai-monitoring-checks/${check.body.id}/reviews`, { observation: "x", result: "ACCEPTABLE", rationale: "x" })).status).toBe(404);
    expect((await b("POST", `/ai-monitoring-reviews/${r.body.id}/start-reassessment`)).status).toBe(404);
    expect(await prisma.aiReassessment.count({ where: { aiSystemId: sysId } })).toBe(0);
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/ai-monitoring-checks/x/reviews", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});