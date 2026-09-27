import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

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
const PREFIX = "s8-test-s11-";
// Spread test traffic across addresses so the global 100 req/min rate limit does not throttle this suite.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.11." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
const FINDING = {
  title: "Human approval not consistently documented",
  description: "2 of 10 sampled high-impact decisions lacked documented human approval",
  severity: "HIGH",
};

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({
    method,
    url,
    cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) },
    payload,
    remoteAddress: nextIp(),
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function completedTest(overall = "PARTIALLY_EFFECTIVE", complete = true) {
  const sys = await call("POST", "/ai-systems", adminUserId, "ADMIN", { name: "S11 Test AI System", origin: "INTERNAL" });
  const sysId = sys.body.id as string;
  expect((await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", { status: "APPLICABLE", rationale: "Primary" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", { controlIds: [ctrlA] })).status).toBe(201);
  const recA = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } })).id;
  const doc = await call("POST", `/ai-systems/${sysId}/evidence`, analystUserId, "ANALYST", { displayFilename: "Policy.pdf", documentType: "Policy" });
  const link = await call("POST", `/ai-system-controls/${recA}/evidence`, analystUserId, "ANALYST", { evidenceDocumentId: doc.body.id });
  expect((await call("POST", `/ai-control-evidence/${link.body.id}/review`, adminUserId, "ADMIN", { decision: "ACCEPT", rationale: "Adequate" })).status).toBe(200);
  const test = await call("POST", `/ai-system-controls/${recA}/tests`, reviewerUserId, "REVIEWER", { method: "SAMPLE_TESTING", procedure: "Sample 10 decisions" });
  expect(test.status).toBe(201);
  expect((await call("POST", `/ai-control-tests/${test.body.id}/evidence`, reviewerUserId, "REVIEWER", { evidenceLinkId: link.body.id })).status).toBe(201);
  if (complete) {
    const draft = {
      testDate: "2026-09-20",
      designEffectiveness: "EFFECTIVE",
      operatingEffectiveness: overall,
      overallEffectiveness: overall,
      conclusionRationale: "Sampled 10 decisions",
    };
    expect((await call("PATCH", `/ai-control-tests/${test.body.id}`, reviewerUserId, "REVIEWER", draft)).status).toBe(200);
    expect((await call("POST", `/ai-control-tests/${test.body.id}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(200);
  }
  return { sysId, recA, testId: test.body.id as string };
}

async function createFinding(testId: string, userId?: string, role = "AUDITOR", payload: Record<string, unknown> = FINDING) {
  return call("POST", `/ai-control-tests/${testId}/findings`, userId ?? auditorUserId, role, payload);
}

async function review(findingId: string, decision: string, rationale: unknown = "Deficiency confirmed", userId?: string, role = "REVIEWER") {
  return call("POST", `/governance-findings/${findingId}/review`, userId ?? reviewerUserId, role, { decision, rationale });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S11 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S11 Test Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s11-${labelText}-${stamp}`, email: `s11-${labelText}-${stamp}@example.com`, displayName: `S11 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S11 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = (
    await prisma.control.create({
      data: { frameworkVersionId: version.id, controlId: "S11-1", title: "Test control S11-1", summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
    })
  ).id;
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
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

describe("Creating findings from control tests", () => {
  it("creates a PENDING_REVIEW Finding from a PARTIALLY_EFFECTIVE test, with an audit event", async () => {
    const { testId } = await completedTest("PARTIALLY_EFFECTIVE");
    const res = await createFinding(testId);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.severity).toBe("HIGH");
    expect(res.body.createdByUserId).toBe(auditorUserId);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_finding.created", targetId: res.body.id } })).not.toBeNull();
  });

  it("creates a Finding from an INEFFECTIVE test", async () => {
    const { testId } = await completedTest("INEFFECTIVE");
    expect((await createFinding(testId)).status).toBe(201);
  });

  it("rejects EFFECTIVE and in-progress source tests, and unknown tests", async () => {
    const effective = await completedTest("EFFECTIVE");
    expect((await createFinding(effective.testId)).status).toBe(400);
    const open = await completedTest("PARTIALLY_EFFECTIVE", false);
    expect((await createFinding(open.testId)).status).toBe(400);
    expect((await createFinding("00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("allows only one Finding per control test (enforced by the database)", async () => {
    const { testId } = await completedTest();
    expect((await createFinding(testId)).status).toBe(201);
    expect((await createFinding(testId)).status).toBe(409);
    expect(await prisma.governanceFinding.count({ where: { aiControlTestId: testId } })).toBe(1);
  });

  it("validates title, description, severity and owner", async () => {
    const { testId } = await completedTest();
    expect((await createFinding(testId, undefined, "AUDITOR", { ...FINDING, title: "" })).status).toBe(400);
    expect((await createFinding(testId, undefined, "AUDITOR", { ...FINDING, description: "  " })).status).toBe(400);
    expect((await createFinding(testId, undefined, "AUDITOR", { ...FINDING, severity: "SEVERE" })).status).toBe(400);
    expect((await createFinding(testId, undefined, "AUDITOR", { ...FINDING, ownerUserId: tenantBUserId })).status).toBe(400);
    const ok = await createFinding(testId, undefined, "AUDITOR", { ...FINDING, ownerUserId: analystUserId });
    expect(ok.status).toBe(201);
    expect(ok.body.owner.id).toBe(analystUserId);
  });

  it("lets ADMIN, REVIEWER and AUDITOR create; denies ANALYST and READ_ONLY", async () => {
    const t1 = await completedTest();
    expect((await createFinding(t1.testId, analystUserId, "ANALYST")).status).toBe(403);
    expect((await createFinding(t1.testId, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    expect((await createFinding(t1.testId, reviewerUserId, "REVIEWER")).status).toBe(201);
    const t2 = await completedTest();
    expect((await createFinding(t2.testId, adminUserId, "ADMIN")).status).toBe(201);
  });
});

describe("Traceability", () => {
  it("traces Finding -> control test -> mapped control -> AI system, and lists by system and control", async () => {
    const { sysId, recA, testId } = await completedTest();
    const created = await createFinding(testId);
    const detail = await call("GET", `/governance-findings/${created.body.id}`, readOnlyUserId, "READ_ONLY");
    expect(detail.status).toBe(200);
    expect(detail.body.aiControlTest.id).toBe(testId);
    expect(detail.body.aiControlTest.overallEffectiveness).toBe("PARTIALLY_EFFECTIVE");
    expect(detail.body.aiControlTest.aiSystemControl.id).toBe(recA);
    expect(detail.body.aiControlTest.aiSystemControl.aiSystem.id).toBe(sysId);
    const bySystem = await call("GET", `/ai-systems/${sysId}/findings`, readOnlyUserId, "READ_ONLY");
    expect(bySystem.body.findings.map((f: { id: string }) => f.id)).toContain(created.body.id);
    expect(bySystem.body.summary.pendingReview).toBe(1);
    const byControl = await call("GET", `/ai-system-controls/${recA}/findings`, readOnlyUserId, "READ_ONLY");
    expect(byControl.body.findings).toHaveLength(1);
  });
});

describe("Human review", () => {
  it("CONFIRM moves the Finding to OPEN with append-only history and an audit event", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    const res = await review(created.body.id, "CONFIRM");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OPEN");
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].previousStatus).toBe("PENDING_REVIEW");
    expect(res.body.reviews[0].newStatus).toBe("OPEN");
    expect(res.body.reviews[0].reviewer.id).toBe(reviewerUserId);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_finding.reviewed", targetId: created.body.id } })).not.toBeNull();
  });

  it("DISMISS requires a rationale and moves the Finding to DISMISSED", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    expect((await review(created.body.id, "DISMISS", "")).status).toBe(400);
    expect((await review(created.body.id, "CLOSE")).status).toBe(400);
    const res = await review(created.body.id, "DISMISS", "Sampled decisions were low-impact; not a deficiency");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("DISMISSED");
  });

  it("blocks the creator from reviewing their own Finding (audited as DENIED)", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId, reviewerUserId, "REVIEWER");
    expect((await review(created.body.id, "CONFIRM", "Self review", reviewerUserId, "REVIEWER")).status).toBe(403);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_finding.denied", targetId: created.body.id, outcome: "DENIED" } })).not.toBeNull();
    expect((await review(created.body.id, "CONFIRM", "Independent review", adminUserId, "ADMIN")).status).toBe(200);
  });

  it("denies AUDITOR, ANALYST and READ_ONLY from reviewing", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId, reviewerUserId, "REVIEWER");
    expect((await review(created.body.id, "CONFIRM", "x", auditorUserId, "AUDITOR")).status).toBe(403);
    expect((await review(created.body.id, "CONFIRM", "x", analystUserId, "ANALYST")).status).toBe(403);
    expect((await review(created.body.id, "CONFIRM", "x", readOnlyUserId, "READ_ONLY")).status).toBe(403);
  });

  it("only reviews PENDING_REVIEW Findings and preserves history", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    expect((await review(created.body.id, "CONFIRM")).status).toBe(200);
    expect((await review(created.body.id, "DISMISS", "Changed mind", adminUserId, "ADMIN")).status).toBe(409);
    expect(await prisma.governanceFindingReview.count({ where: { findingId: created.body.id } })).toBe(1);
  });

  it("allows only one decision when two reviewers act at the same time", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    const [r1, r2] = await Promise.all([review(created.body.id, "CONFIRM"), review(created.body.id, "DISMISS", "No", adminUserId, "ADMIN")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.governanceFindingReview.count({ where: { findingId: created.body.id } })).toBe(1);
  });
});

describe("Updating findings", () => {
  it("lets the creator edit content before review, locks content after review, and never changes status directly", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    const id = created.body.id as string;
    expect((await call("PATCH", `/governance-findings/${id}`, auditorUserId, "AUDITOR", { title: "Updated title" })).status).toBe(200);
    expect((await call("PATCH", `/governance-findings/${id}`, reviewerUserId, "REVIEWER", { title: "Not mine" })).status).toBe(403);
    expect((await call("PATCH", `/governance-findings/${id}`, auditorUserId, "AUDITOR", { status: "CLOSED" })).status).toBe(400);
    expect((await review(id, "CONFIRM")).status).toBe(200);
    expect((await call("PATCH", `/governance-findings/${id}`, auditorUserId, "AUDITOR", { severity: "LOW" })).status).toBe(409);
    const owner = await call("PATCH", `/governance-findings/${id}`, auditorUserId, "AUDITOR", { ownerUserId: analystUserId });
    expect(owner.status).toBe(200);
    expect(owner.body.owner.id).toBe(analystUserId);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_finding.owner_changed", targetId: id } })).not.toBeNull();
    const stored = await prisma.governanceFinding.findUniqueOrThrow({ where: { id } });
    expect(stored.status).toBe("OPEN");
    expect(stored.severity).toBe("HIGH");
  });

  it("locks DISMISSED Findings", async () => {
    const { testId } = await completedTest();
    const created = await createFinding(testId);
    expect((await review(created.body.id, "DISMISS", "Not a deficiency")).status).toBe(200);
    expect((await call("PATCH", `/governance-findings/${created.body.id}`, auditorUserId, "AUDITOR", { ownerUserId: analystUserId })).status).toBe(409);
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every Finding route", async () => {
    const { sysId, recA, testId } = await completedTest();
    const created = await createFinding(testId);
    const id = created.body.id as string;
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("POST", `/ai-control-tests/${testId}/findings`, FINDING)).status).toBe(404);
    expect((await b("GET", `/governance-findings/${id}`)).status).toBe(404);
    expect((await b("GET", `/ai-systems/${sysId}/findings`)).status).toBe(404);
    expect((await b("GET", `/ai-system-controls/${recA}/findings`)).status).toBe(404);
    expect((await b("PATCH", `/governance-findings/${id}`, { ownerUserId: null })).status).toBe(404);
    expect((await b("POST", `/governance-findings/${id}/review`, { decision: "CONFIRM", rationale: "x" })).status).toBe(404);
    expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_REVIEW");
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/governance-findings/anything", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});

describe("Regression protection", () => {
  it("does not touch vendor ControlFinding or the vendor review queue, and leaves the Step 10 test locked", async () => {
    const { testId } = await completedTest();
    expect((await createFinding(testId)).status).toBe(201);
    expect(await prisma.controlFinding.count({ where: { tenantId: tenantAId } })).toBe(0);
    const queue = await call("GET", "/reviews/findings", reviewerUserId, "REVIEWER");
    expect(queue.status).toBe(200);
    expect(queue.body.findings).toHaveLength(0);
    const test = await prisma.aiControlTest.findUniqueOrThrow({ where: { id: testId } });
    expect(test.status).toBe("COMPLETED");
    expect(test.overallEffectiveness).toBe("PARTIALLY_EFFECTIVE");
  });
});