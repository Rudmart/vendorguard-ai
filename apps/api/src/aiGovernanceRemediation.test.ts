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
const PREFIX = "s8-test-s12-";
// Spread test traffic across addresses so the global 100 req/min rate limit does not throttle this suite.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.12." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
const REM = { title: "Require approval record", description: "Block final decisions without a recorded human approval", dueDate: "2027-01-31" };

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function findingIn(status: "PENDING_REVIEW" | "OPEN" | "DISMISSED" = "OPEN") {
  const sys = await call("POST", "/ai-systems", adminUserId, "ADMIN", { name: "S12 Test AI System", origin: "INTERNAL" });
  const sysId = sys.body.id as string;
  expect((await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", { status: "APPLICABLE", rationale: "Primary" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", { controlIds: [ctrlA] })).status).toBe(201);
  const recA = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } })).id;
  const doc = await call("POST", `/ai-systems/${sysId}/evidence`, analystUserId, "ANALYST", { displayFilename: "Policy.pdf", documentType: "Policy" });
  const link = await call("POST", `/ai-system-controls/${recA}/evidence`, analystUserId, "ANALYST", { evidenceDocumentId: doc.body.id });
  expect((await call("POST", `/ai-control-evidence/${link.body.id}/review`, adminUserId, "ADMIN", { decision: "ACCEPT", rationale: "Adequate" })).status).toBe(200);
  const test = await call("POST", `/ai-system-controls/${recA}/tests`, reviewerUserId, "REVIEWER", { method: "SAMPLE_TESTING", procedure: "Sample 10 decisions" });
  expect((await call("POST", `/ai-control-tests/${test.body.id}/evidence`, reviewerUserId, "REVIEWER", { evidenceLinkId: link.body.id })).status).toBe(201);
  const draft = { testDate: "2026-09-20", designEffectiveness: "EFFECTIVE", operatingEffectiveness: "PARTIALLY_EFFECTIVE", overallEffectiveness: "PARTIALLY_EFFECTIVE", conclusionRationale: "2 of 10 missing" };
  expect((await call("PATCH", `/ai-control-tests/${test.body.id}`, reviewerUserId, "REVIEWER", draft)).status).toBe(200);
  expect((await call("POST", `/ai-control-tests/${test.body.id}/complete`, reviewerUserId, "REVIEWER", {})).status).toBe(200);
  const finding = await call("POST", `/ai-control-tests/${test.body.id}/findings`, auditorUserId, "AUDITOR", { title: "Approvals missing", description: "2 of 10", severity: "HIGH" });
  expect(finding.status).toBe(201);
  if (status !== "PENDING_REVIEW") {
    const decision = status === "OPEN" ? "CONFIRM" : "DISMISS";
    expect((await call("POST", `/governance-findings/${finding.body.id}/review`, reviewerUserId, "REVIEWER", { decision, rationale: "Reviewed" })).status).toBe(200);
  }
  return { sysId, recA, testId: test.body.id as string, findingId: finding.body.id as string };
}

async function createRem(findingId: string, payload: Record<string, unknown> = { ...REM, ownerUserId: analystUserId }, userId?: string, role = "ANALYST") {
  return call("POST", `/governance-findings/${findingId}/remediation`, userId ?? analystUserId, role, payload);
}

async function toPending(remId: string, ownerId: string, ownerRole: string) {
  expect((await call("PATCH", `/governance-remediations/${remId}`, ownerId, ownerRole, { status: "IN_PROGRESS" })).status).toBe(200);
  expect((await call("POST", `/governance-remediations/${remId}/submit`, ownerId, ownerRole, {})).status).toBe(200);
}

async function verify(remId: string, decision: string, rationale: unknown = "Checked the corrective action", userId?: string, role = "REVIEWER") {
  return call("POST", `/governance-remediations/${remId}/verify`, userId ?? reviewerUserId, role, { decision, rationale });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S12 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S12 Test Tenant B" } })).id;
  const makeUser = async (labelText: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s12-${labelText}-${stamp}`, email: `s12-${labelText}-${stamp}@example.com`, displayName: `S12 ${labelText}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S12 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = (
    await prisma.control.create({
      data: { frameworkVersionId: version.id, controlId: "S12-1", title: "Test control S12-1", summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
    })
  ).id;
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.remediationVerification.deleteMany({ where: { tenantId: tenants } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
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

describe("Creating remediation", () => {
  it("creates an OPEN remediation for an OPEN Finding, with owner, due date and an audit event", async () => {
    const { findingId } = await findingIn("OPEN");
    const res = await createRem(findingId);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("OPEN");
    expect(res.body.governanceFindingId).toBe(findingId);
    expect(res.body.owner.id).toBe(analystUserId);
    expect(res.body.dueDate).toBeTruthy();
    expect(res.body.vendorId).toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.created", targetId: res.body.id } })).not.toBeNull();
  });

  it("accepts the owner by email", async () => {
    const { findingId } = await findingIn("OPEN");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: reviewerUserId } })).email;
    const res = await createRem(findingId, { ...REM, ownerEmail: email.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.owner.id).toBe(reviewerUserId);
  });

  it("rejects PENDING_REVIEW and DISMISSED Findings", async () => {
    const pending = await findingIn("PENDING_REVIEW");
    expect((await createRem(pending.findingId)).status).toBe(400);
    const dismissed = await findingIn("DISMISSED");
    expect((await createRem(dismissed.findingId)).status).toBe(400);
  });

  it("allows one remediation per Finding", async () => {
    const { findingId } = await findingIn("OPEN");
    expect((await createRem(findingId)).status).toBe(201);
    expect((await createRem(findingId)).status).toBe(409);
  });

  it("requires an owner who is a member of the tenant", async () => {
    const { findingId } = await findingIn("OPEN");
    expect((await createRem(findingId, { ...REM })).status).toBe(400);
    expect((await createRem(findingId, { ...REM, ownerUserId: tenantBUserId })).status).toBe(400);
    expect((await createRem(findingId, { ...REM, ownerEmail: "nobody@example.com" })).status).toBe(400);
    expect((await createRem(findingId, { ...REM, ownerUserId: analystUserId, dueDate: "not-a-date" })).status).toBe(400);
  });

  it("lets ADMIN and ANALYST create; denies REVIEWER, AUDITOR and READ_ONLY", async () => {
    const f1 = await findingIn("OPEN");
    expect((await createRem(f1.findingId, undefined, reviewerUserId, "REVIEWER")).status).toBe(403);
    expect((await createRem(f1.findingId, undefined, auditorUserId, "AUDITOR")).status).toBe(403);
    expect((await createRem(f1.findingId, undefined, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    expect((await createRem(f1.findingId, undefined, adminUserId, "ADMIN")).status).toBe(201);
  });
});

describe("Progress and submission", () => {
  it("lets the owner move OPEN -> IN_PROGRESS but never set PENDING_VERIFICATION or CLOSED directly", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    expect((await call("PATCH", `/governance-remediations/${id}`, analystUserId, "ANALYST", { status: "CLOSED" })).status).toBe(400);
    expect((await call("PATCH", `/governance-remediations/${id}`, analystUserId, "ANALYST", { status: "PENDING_VERIFICATION" })).status).toBe(400);
    const res = await call("PATCH", `/governance-remediations/${id}`, analystUserId, "ANALYST", { status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.status_changed", targetId: id } })).not.toBeNull();
    expect((await call("PATCH", `/governance-remediations/${id}`, auditorUserId, "AUDITOR", { status: "OPEN" })).status).toBe(403);
  });

  it("only the owner can submit, only from IN_PROGRESS, and the remediation locks while pending", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    expect((await call("POST", `/governance-remediations/${id}/submit`, analystUserId, "ANALYST", {})).status).toBe(409);
    expect((await call("PATCH", `/governance-remediations/${id}`, analystUserId, "ANALYST", { status: "IN_PROGRESS" })).status).toBe(200);
    expect((await call("POST", `/governance-remediations/${id}/submit`, adminUserId, "ADMIN", {})).status).toBe(403);
    const res = await call("POST", `/governance-remediations/${id}/submit`, analystUserId, "ANALYST", {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_VERIFICATION");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.submitted_for_verification", targetId: id } })).not.toBeNull();
    expect((await call("PATCH", `/governance-remediations/${id}`, analystUserId, "ANALYST", { title: "Changed" })).status).toBe(409);
  });

  it("lets a manager reassign the owner, with an audit event", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const res = await call("PATCH", `/governance-remediations/${rem.body.id}`, adminUserId, "ADMIN", { ownerUserId: reviewerUserId });
    expect(res.status).toBe(200);
    expect(res.body.owner.id).toBe(reviewerUserId);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.owner_changed", targetId: rem.body.id } })).not.toBeNull();
  });
});

describe("Independent verification", () => {
  it("VERIFIED closes the remediation and the Finding atomically, with history and audit events", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    await toPending(id, analystUserId, "ANALYST");
    const res = await verify(id, "VERIFIED");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");
    expect(res.body.closedAt).toBeTruthy();
    expect(res.body.closedByUserId).toBe(reviewerUserId);
    expect(res.body.verifications).toHaveLength(1);
    expect(res.body.verifications[0].previousStatus).toBe("PENDING_VERIFICATION");
    expect(res.body.verifications[0].newStatus).toBe("CLOSED");
    expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("CLOSED");
    for (const action of ["governance_remediation.verified", "governance_remediation.closed"]) {
      expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action, targetId: id } })).not.toBeNull();
    }
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_finding.closed", targetId: findingId } })).not.toBeNull();
    expect((await createRem(findingId)).status).toBe(400);
  });

  it("REJECTED requires a rationale, returns remediation to IN_PROGRESS and keeps the Finding OPEN", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    await toPending(id, analystUserId, "ANALYST");
    expect((await verify(id, "REJECTED", "")).status).toBe(400);
    expect((await verify(id, "ACCEPTED_RISK")).status).toBe(400);
    const res = await verify(id, "REJECTED", "No approval records were attached");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
    expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("OPEN");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.rejected", targetId: id } })).not.toBeNull();
  });

  it("keeps both attempts after reject -> resubmit -> verify", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    await toPending(id, analystUserId, "ANALYST");
    expect((await verify(id, "REJECTED", "Insufficient")).status).toBe(200);
    expect((await call("POST", `/governance-remediations/${id}/submit`, analystUserId, "ANALYST", {})).status).toBe(200);
    const res = await verify(id, "VERIFIED", "Now sufficient", auditorUserId, "AUDITOR");
    expect(res.status).toBe(200);
    expect(res.body.verifications).toHaveLength(2);
    expect(res.body.verifications.map((v: { decision: string }) => v.decision).sort()).toEqual(["REJECTED", "VERIFIED"]);
    expect(await prisma.remediationVerification.count({ where: { remediationId: id } })).toBe(2);
  });

  it("blocks the owner from verifying their own remediation (audited as DENIED)", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId, { ...REM, ownerUserId: reviewerUserId }, adminUserId, "ADMIN");
    const id = rem.body.id as string;
    await toPending(id, reviewerUserId, "REVIEWER");
    expect((await verify(id, "VERIFIED", "Self check", reviewerUserId, "REVIEWER")).status).toBe(403);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "governance_remediation.verification_denied", targetId: id, outcome: "DENIED" } })).not.toBeNull();
    expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_VERIFICATION");
  });

  it("denies ANALYST and READ_ONLY from verifying; only verifies pending remediation", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    expect((await verify(id, "VERIFIED")).status).toBe(409);
    await toPending(id, analystUserId, "ANALYST");
    expect((await verify(id, "VERIFIED", "x", analystUserId, "ANALYST")).status).toBe(403);
    expect((await verify(id, "VERIFIED", "x", readOnlyUserId, "READ_ONLY")).status).toBe(403);
  });

  it("allows only one decision when two verifiers act at the same time", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    await toPending(id, analystUserId, "ANALYST");
    const [r1, r2] = await Promise.all([verify(id, "VERIFIED"), verify(id, "REJECTED", "No", auditorUserId, "AUDITOR")]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.remediationVerification.count({ where: { remediationId: id } })).toBe(1);
  });

  it("never closes a Finding directly: Finding PATCH and review cannot set CLOSED", async () => {
    const { findingId } = await findingIn("OPEN");
    expect((await call("PATCH", `/governance-findings/${findingId}`, auditorUserId, "AUDITOR", { status: "CLOSED" })).status).toBe(400);
    expect((await call("POST", `/governance-findings/${findingId}/review`, reviewerUserId, "REVIEWER", { decision: "CONFIRM", rationale: "again" })).status).toBe(409);
    expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe("OPEN");
  });
});

describe("Compatibility guards and regression", () => {
  it("Guard A: generic PATCH refuses Finding-linked remediation but still works for other remediation", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    expect((await call("PATCH", `/remediations/${rem.body.id}`, reviewerUserId, "REVIEWER", { status: "CLOSED" })).status).toBe(409);
    expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.body.id } })).status).toBe("OPEN");
    const legacy = await prisma.remediationAction.create({ data: { tenantId: tenantAId, title: "Legacy task", description: "Not linked to a Finding" } });
    const res = await call("PATCH", `/remediations/${legacy.id}`, reviewerUserId, "REVIEWER", { status: "IN_PROGRESS" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IN_PROGRESS");
  });

  it("Guard B: GET /remediations returns Finding context and tolerates remediation without a vendor", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const res = await call("GET", "/remediations", analystUserId, "ANALYST");
    expect(res.status).toBe(200);
    const row = res.body.remediations.find((r: { id: string }) => r.id === rem.body.id);
    expect(row.vendor).toBeNull();
    expect(row.governanceFinding.id).toBe(findingId);
    expect(row.governanceFinding.aiControlTest.aiSystemControl.aiSystem.name).toBe("S12 Test AI System");
  });

  it("leaves Step 10 test and Step 11 review history untouched after closure", async () => {
    const { findingId, testId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    await toPending(rem.body.id, analystUserId, "ANALYST");
    expect((await verify(rem.body.id, "VERIFIED")).status).toBe(200);
    const test = await prisma.aiControlTest.findUniqueOrThrow({ where: { id: testId } });
    expect(test.status).toBe("COMPLETED");
    expect(test.overallEffectiveness).toBe("PARTIALLY_EFFECTIVE");
    expect(await prisma.governanceFindingReview.count({ where: { findingId } })).toBe(1);
    expect(await prisma.controlFinding.count({ where: { tenantId: tenantAId } })).toBe(0);
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant on every remediation route", async () => {
    const { findingId } = await findingIn("OPEN");
    const rem = await createRem(findingId);
    const id = rem.body.id as string;
    const b = (method: "GET" | "POST" | "PATCH", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", payload, tenantBId);
    expect((await b("POST", `/governance-findings/${findingId}/remediation`, { ...REM, ownerUserId: tenantBUserId })).status).toBe(404);
    expect((await b("GET", `/governance-findings/${findingId}/remediation`)).status).toBe(404);
    expect((await b("GET", `/governance-remediations/${id}`)).status).toBe(404);
    expect((await b("PATCH", `/governance-remediations/${id}`, { status: "IN_PROGRESS" })).status).toBe(404);
    expect((await b("POST", `/governance-remediations/${id}/submit`, {})).status).toBe(404);
    expect((await b("POST", `/governance-remediations/${id}/verify`, { decision: "VERIFIED", rationale: "x" })).status).toBe(404);
    expect((await b("PATCH", `/remediations/${id}`, { status: "CLOSED" })).status).toBe(404);
    expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id } })).status).toBe("OPEN");
  });

  it("requires login", async () => {
    expect((await server.inject({ method: "GET", url: "/governance-remediations/anything", remoteAddress: nextIp() })).statusCode).toBe(401);
  });
});