import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { overallWithinLimit } from "./aiControlTests.js";

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
let ctrlB: string;

// The "s8-test-" prefix keeps this framework out of aiControlSet.test.ts's library snapshot.
const PREFIX = "s8-test-s10-";
// Spread test traffic across addresses so the global 100 req/min rate limit does not throttle this suite.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.10." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
const PROCEDURE = { method: "SAMPLE_TESTING", procedure: "Sample 10 high-impact decisions and verify documented human approval" };
const PARTIAL_DRAFT = {
  testDate: "2026-09-20",
  sampleSize: 10,
  exceptionsFound: 2,
  designEffectiveness: "EFFECTIVE",
  operatingEffectiveness: "PARTIALLY_EFFECTIVE",
  overallEffectiveness: "PARTIALLY_EFFECTIVE",
  conclusionRationale: "8 of 10 sampled decisions had documented human approval",
  nextTestDate: "2027-03-20",
};

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function makeControl(frameworkVersionId: string, code: string) {
  const control = await prisma.control.create({
    data: { frameworkVersionId, controlId: code, title: `Test control ${code}`, summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
  });
  return control.id;
}

async function setupSystem() {
  const sys = await call("POST", "/ai-systems", adminUserId, "ADMIN", { name: "S10 Test AI System", origin: "INTERNAL" });
  const sysId = sys.body.id as string;
  expect((await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", { status: "APPLICABLE", rationale: "Primary" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", { controlIds: [ctrlA, ctrlB] })).status).toBe(201);
  const recA = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } })).id;
  const recB = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlB } } })).id;
  return { sysId, recA, recB };
}

async function submitEvidence(sysId: string, recId: string, uploader?: string, uploaderRole = "ANALYST", submitter?: string, submitterRole = "ANALYST") {
  const doc = await call("POST", `/ai-systems/${sysId}/evidence`, uploader ?? analystUserId, uploaderRole, { displayFilename: "Oversight policy.pdf", documentType: "Policy" });
  expect(doc.status).toBe(201);
  const link = await call("POST", `/ai-system-controls/${recId}/evidence`, submitter ?? analystUserId, submitterRole, { evidenceDocumentId: doc.body.id });
  expect(link.status).toBe(201);
  return link.body.id as string;
}

async function acceptedEvidence(sysId: string, recId: string) {
  const linkId = await submitEvidence(sysId, recId);
  expect((await call("POST", `/ai-control-evidence/${linkId}/review`, adminUserId, "ADMIN", { decision: "ACCEPT", rationale: "Adequate" })).status).toBe(200);
  return linkId;
}

async function startTest(recId: string, userId?: string, role = "REVIEWER", payload: Record<string, unknown> = PROCEDURE) {
  return call("POST", `/ai-system-controls/${recId}/tests`, userId ?? reviewerUserId, role, payload);
}

async function addEvidence(testId: string, linkId: string, userId?: string, role = "REVIEWER") {
  return call("POST", `/ai-control-tests/${testId}/evidence`, userId ?? reviewerUserId, role, { evidenceLinkId: linkId });
}

async function saveAndComplete(testId: string, draft: Record<string, unknown> = PARTIAL_DRAFT, userId?: string, role = "REVIEWER") {
  const saved = await call("PATCH", `/ai-control-tests/${testId}`, userId ?? reviewerUserId, role, draft);
  expect(saved.status).toBe(200);
  return call("POST", `/ai-control-tests/${testId}/complete`, userId ?? reviewerUserId, role, {});
}

async function readyTest() {
  const sys = await setupSystem();
  const linkId = await acceptedEvidence(sys.sysId, sys.recA);
  const test = await startTest(sys.recA);
  expect(test.status).toBe(201);
  expect((await addEvidence(test.body.id, linkId)).status).toBe(201);
  return { ...sys, linkId, testId: test.body.id as string };
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S10 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S10 Test Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s10-${labelText}-${stamp}`, email: `s10-${labelText}-${stamp}@example.com`, displayName: `S10 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S10 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = await makeControl(version.id, "S10-1");
  ctrlB = await makeControl(version.id, "S10-2");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
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

describe("Overall effectiveness rule", () => {
  it("allows overall equal to or weaker than the weaker of design and operating", () => {
    expect(overallWithinLimit("EFFECTIVE", "PARTIALLY_EFFECTIVE", "PARTIALLY_EFFECTIVE")).toBe(true);
    expect(overallWithinLimit("EFFECTIVE", "PARTIALLY_EFFECTIVE", "INEFFECTIVE")).toBe(true);
    expect(overallWithinLimit("EFFECTIVE", "PARTIALLY_EFFECTIVE", "EFFECTIVE")).toBe(false);
    expect(overallWithinLimit("INEFFECTIVE", "EFFECTIVE", "PARTIALLY_EFFECTIVE")).toBe(false);
  });
});

describe("Creating control tests", () => {
  it("lets a REVIEWER start an IN_PROGRESS test, with an audit event", async () => {
    const { recA } = await setupSystem();
    const res = await startTest(recA);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(res.body.testerUserId).toBe(reviewerUserId);
    expect(res.body.overallEffectiveness).toBe("NOT_ASSESSED");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.created", targetId: res.body.id } })).not.toBeNull();
  });

  it("gives AUDITOR testing authority", async () => {
    const { recA } = await setupSystem();
    expect((await startTest(recA, auditorUserId, "AUDITOR")).status).toBe(201);
  });

  it("denies ANALYST and READ_ONLY", async () => {
    const { recA } = await setupSystem();
    expect((await startTest(recA, analystUserId, "ANALYST")).status).toBe(403);
    expect((await startTest(recA, readOnlyUserId, "READ_ONLY")).status).toBe(403);
  });

  it("validates the test method and procedure", async () => {
    const { recA } = await setupSystem();
    expect((await startTest(recA, undefined, "REVIEWER", { method: "PEN_TEST", procedure: "x" })).status).toBe(400);
    expect((await startTest(recA, undefined, "REVIEWER", { method: "INTERVIEW", procedure: "" })).status).toBe(400);
    expect((await startTest(recA, undefined, "REVIEWER", { method: "INTERVIEW" })).status).toBe(400);
    expect((await startTest(recA, undefined, "REVIEWER", { ...PROCEDURE, sampleSize: 5, exceptionsFound: 6 })).status).toBe(400);
  });

  it("blocks the control owner from testing their own control (audited as DENIED)", async () => {
    const { recA } = await setupSystem();
    await prisma.aiSystemControl.update({ where: { id: recA }, data: { ownerUserId: reviewerUserId } });
    expect((await startTest(recA)).status).toBe(403);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.denied", targetId: recA, outcome: "DENIED" } })).not.toBeNull();
    expect((await startTest(recA, auditorUserId, "AUDITOR")).status).toBe(201);
  });

  it("returns 404 for an unknown mapped control and 400 for a Not Applicable control", async () => {
    const { recB } = await setupSystem();
    expect((await startTest("00000000-0000-0000-0000-000000000000")).status).toBe(404);
    await prisma.aiSystemControl.update({ where: { id: recB }, data: { applicability: "NOT_APPLICABLE", rationale: "Out of scope" } });
    expect((await startTest(recB)).status).toBe(400);
  });
});

describe("Evidence considered in a test", () => {
  it("associates a Step 9 evidence link and rejects duplicates", async () => {
    const { sysId, recA } = await setupSystem();
    const linkId = await acceptedEvidence(sysId, recA);
    const test = await startTest(recA);
    const res = await addEvidence(test.body.id, linkId);
    expect(res.status).toBe(201);
    expect(res.body.evidence).toHaveLength(1);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.evidence_associated", targetId: test.body.id } })).not.toBeNull();
    expect((await addEvidence(test.body.id, linkId)).status).toBe(409);
  });

  it("rejects evidence from another mapped control and unknown evidence", async () => {
    const { sysId, recA, recB } = await setupSystem();
    const otherLink = await acceptedEvidence(sysId, recB);
    const test = await startTest(recA);
    expect((await addEvidence(test.body.id, otherLink)).status).toBe(400);
    expect((await addEvidence(test.body.id, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("blocks a tester who submitted the evidence", async () => {
    const { sysId, recA } = await setupSystem();
    const linkId = await submitEvidence(sysId, recA, adminUserId, "ADMIN", adminUserId, "ADMIN");
    const test = await startTest(recA, adminUserId, "ADMIN");
    expect((await addEvidence(test.body.id, linkId, adminUserId, "ADMIN")).status).toBe(403);
  });

  it("blocks a tester who uploaded the evidence", async () => {
    const { sysId, recA } = await setupSystem();
    const linkId = await submitEvidence(sysId, recA, adminUserId, "ADMIN");
    const test = await startTest(recA, adminUserId, "ADMIN");
    expect((await addEvidence(test.body.id, linkId, adminUserId, "ADMIN")).status).toBe(403);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.denied", targetId: test.body.id } })).not.toBeNull();
  });
});

describe("Completing control tests", () => {
  it("records design, operating and overall conclusions and locks the test", async () => {
    const { sysId, testId } = await readyTest();
    const res = await saveAndComplete(testId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.designEffectiveness).toBe("EFFECTIVE");
    expect(res.body.operatingEffectiveness).toBe("PARTIALLY_EFFECTIVE");
    expect(res.body.overallEffectiveness).toBe("PARTIALLY_EFFECTIVE");
    expect(res.body.sampleSize).toBe(10);
    expect(res.body.exceptionsFound).toBe(2);
    expect(res.body.completedAt).toBeTruthy();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.completed", targetId: testId } })).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.effectiveness_determined", targetId: testId } })).not.toBeNull();
    // Step 9 regression: evidence assurance stays ACCEPTED - a separate decision.
    const assurance = await call("GET", `/ai-systems/${sysId}/assurance`, readOnlyUserId, "READ_ONLY");
    expect(Object.values(assurance.body.byControl)).toContain("ACCEPTED");
  });

  it("allows an INEFFECTIVE conclusion even with accepted evidence (accepted evidence is not an effective control)", async () => {
    const { testId } = await readyTest();
    const res = await saveAndComplete(testId, {
      ...PARTIAL_DRAFT,
      designEffectiveness: "INEFFECTIVE",
      operatingEffectiveness: "INEFFECTIVE",
      overallEffectiveness: "INEFFECTIVE",
      conclusionRationale: "Policy exists but no approvals were performed",
    });
    expect(res.status).toBe(200);
    expect(res.body.overallEffectiveness).toBe("INEFFECTIVE");
  });

  it("requires at least one ACCEPTED evidence item - Pending does not count", async () => {
    const { sysId, recA } = await setupSystem();
    const pendingLink = await submitEvidence(sysId, recA);
    const test = await startTest(recA);
    expect((await addEvidence(test.body.id, pendingLink)).status).toBe(201);
    expect((await saveAndComplete(test.body.id)).status).toBe(400);
    expect((await call("POST", `/ai-control-evidence/${pendingLink}/review`, adminUserId, "ADMIN", { decision: "ACCEPT", rationale: "Now adequate" })).status).toBe(200);
    expect((await call("POST", `/ai-control-tests/${test.body.id}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(200);
  });

  it("requires at least one ACCEPTED evidence item - Rejected does not count, and no evidence fails", async () => {
    const { sysId, recA } = await setupSystem();
    const rejectedLink = await submitEvidence(sysId, recA);
    expect((await call("POST", `/ai-control-evidence/${rejectedLink}/review`, adminUserId, "ADMIN", { decision: "REJECT", rationale: "Unsigned" })).status).toBe(200);
    const empty = await startTest(recA);
    expect((await saveAndComplete(empty.body.id)).status).toBe(400);
    expect((await addEvidence(empty.body.id, rejectedLink)).status).toBe(201);
    expect((await call("POST", `/ai-control-tests/${empty.body.id}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(400);
  });

  it("requires all conclusions, a test date and a rationale", async () => {
    const { testId } = await readyTest();
    expect((await call("POST", `/ai-control-tests/${testId}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(400);
    expect((await saveAndComplete(testId, { ...PARTIAL_DRAFT, conclusionRationale: null })).status).toBe(400);
  });

  it("rejects an overall conclusion stronger than the weaker underlying conclusion, without changing it", async () => {
    const { testId } = await readyTest();
    const res = await saveAndComplete(testId, { ...PARTIAL_DRAFT, overallEffectiveness: "EFFECTIVE" });
    expect(res.status).toBe(400);
    const stored = await prisma.aiControlTest.findUniqueOrThrow({ where: { id: testId } });
    expect(stored.status).toBe("IN_PROGRESS");
    expect(stored.overallEffectiveness).toBe("EFFECTIVE");
  });

  it("rejects invalid effectiveness values and exceptions above the sample size", async () => {
    const { testId } = await readyTest();
    expect((await call("PATCH", `/ai-control-tests/${testId}`, reviewerUserId, "REVIEWER", { designEffectiveness: "GREAT" })).status).toBe(400);
    expect((await call("PATCH", `/ai-control-tests/${testId}`, reviewerUserId, "REVIEWER", { sampleSize: 5, exceptionsFound: 9 })).status).toBe(400);
  });

  it("makes completed tests immutable", async () => {
    const { testId, linkId } = await readyTest();
    expect((await saveAndComplete(testId)).status).toBe(200);
    expect((await call("PATCH", `/ai-control-tests/${testId}`, reviewerUserId, "REVIEWER", { overallEffectiveness: "INEFFECTIVE" })).status).toBe(409);
    expect((await addEvidence(testId, linkId)).status).toBe(409);
    expect((await call("POST", `/ai-control-tests/${testId}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(409);
    expect((await prisma.aiControlTest.findUniqueOrThrow({ where: { id: testId } })).overallEffectiveness).toBe("PARTIALLY_EFFECTIVE");
  });

  it("lets only the original tester edit or complete an in-progress test", async () => {
    const { testId } = await readyTest();
    expect((await call("PATCH", `/ai-control-tests/${testId}`, auditorUserId, "AUDITOR", PARTIAL_DRAFT)).status).toBe(403);
    expect((await call("POST", `/ai-control-tests/${testId}/complete`, auditorUserId, "AUDITOR", {})).status).toBe(403);
  });

  it("allows only one completion when two requests race", async () => {
    const { testId } = await readyTest();
    expect((await call("PATCH", `/ai-control-tests/${testId}`, reviewerUserId, "REVIEWER", PARTIAL_DRAFT)).status).toBe(200);
    const [r1, r2] = await Promise.all([
      call("POST", `/ai-control-tests/${testId}/complete`, reviewerUserId, "REVIEWER", {}),
      call("POST", `/ai-control-tests/${testId}/complete`, reviewerUserId, "REVIEWER", {}),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.auditEvent.count({ where: { tenantId: tenantAId, action: "ai_control_test.completed", targetId: testId } })).toBe(1);
  });
});

describe("Retesting and history", () => {
  it("creates a new record for a retest and preserves the earlier result", async () => {
    const { recA, linkId, testId } = await readyTest();
    expect((await saveAndComplete(testId, { ...PARTIAL_DRAFT, operatingEffectiveness: "INEFFECTIVE", overallEffectiveness: "INEFFECTIVE" })).status).toBe(200);
    const retest = await startTest(recA);
    expect(retest.status).toBe(201);
    expect(retest.body.id).not.toBe(testId);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_test.retest_recorded", targetId: retest.body.id } })).not.toBeNull();
    expect((await addEvidence(retest.body.id, linkId)).status).toBe(201);
    expect((await saveAndComplete(retest.body.id, { ...PARTIAL_DRAFT, operatingEffectiveness: "EFFECTIVE", overallEffectiveness: "EFFECTIVE" })).status).toBe(200);
    const history = await call("GET", `/ai-system-controls/${recA}/tests`, readOnlyUserId, "READ_ONLY");
    expect(history.status).toBe(200);
    expect(history.body.tests).toHaveLength(2);
    expect(history.body.latestCompleted.id).toBe(retest.body.id);
    expect(history.body.latestCompleted.overallEffectiveness).toBe("EFFECTIVE");
    expect(history.body.tests.find((t: { id: string }) => t.id === testId).overallEffectiveness).toBe("INEFFECTIVE");
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every control-test route", async () => {
    const { recA, linkId, testId } = await readyTest();
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("GET", `/ai-system-controls/${recA}/tests`)).status).toBe(404);
    expect((await b("POST", `/ai-system-controls/${recA}/tests`, PROCEDURE)).status).toBe(404);
    expect((await b("GET", `/ai-control-tests/${testId}`)).status).toBe(404);
    expect((await b("PATCH", `/ai-control-tests/${testId}`, PARTIAL_DRAFT)).status).toBe(404);
    expect((await b("POST", `/ai-control-tests/${testId}/evidence`, { evidenceLinkId: linkId })).status).toBe(404);
    expect((await b("POST", `/ai-control-tests/${testId}/complete`, {})).status).toBe(404);
    expect((await prisma.aiControlTest.findUniqueOrThrow({ where: { id: testId } })).status).toBe("IN_PROGRESS");
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/ai-control-tests/anything", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});