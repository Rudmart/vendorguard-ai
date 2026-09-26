import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { deriveAssuranceStatus } from "./aiControlEvidence.js";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let reviewerUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;
let fwId: string;
let ctrlA: string;
let ctrlB: string;

// The "s8-test-" prefix keeps this framework out of aiControlSet.test.ts's library snapshot.
const PREFIX = "s8-test-s9-";

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

async function call(method: "GET" | "POST" | "PUT", url: string, userId: string, role: string, tenantId?: string, payload?: Record<string, unknown>) {
  const res = await server.inject({
    method,
    url,
    cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) },
    payload,
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function makeControl(frameworkVersionId: string, code: string) {
  const control = await prisma.control.create({
    data: { frameworkVersionId, controlId: code, title: `Test control ${code}`, summary: "Test", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "n/a" },
  });
  return control.id;
}

async function setupSystem() {
  const sys = await call("POST", "/ai-systems", adminUserId, "ADMIN", tenantAId, { name: "S9 Test AI System", origin: "INTERNAL" });
  const sysId = sys.body.id as string;
  const applicability = await call("PUT", `/ai-systems/${sysId}/framework-applicability/${fwId}`, analystUserId, "ANALYST", tenantAId, {
    status: "APPLICABLE",
    rationale: "Primary governance framework",
  });
  expect(applicability.status).toBe(201);
  const mapped = await call("POST", `/ai-systems/${sysId}/controls`, analystUserId, "ANALYST", tenantAId, { controlIds: [ctrlA, ctrlB] });
  expect(mapped.status).toBe(201);
  const recA = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlA } } })).id;
  const recB = (await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sysId, controlId: ctrlB } } })).id;
  return { sysId, recA, recB };
}

async function addEvidence(sysId: string, extra: Record<string, unknown> = {}, userId?: string, role = "ANALYST", tenantId?: string) {
  return call("POST", `/ai-systems/${sysId}/evidence`, userId ?? analystUserId, role, tenantId, {
    displayFilename: "Model card.pdf",
    documentType: "Model card",
    ...extra,
  });
}

async function submit(recId: string, docId: string, userId?: string, role = "ANALYST", tenantId?: string) {
  return call("POST", `/ai-system-controls/${recId}/evidence`, userId ?? analystUserId, role, tenantId, { evidenceDocumentId: docId, note: "Please review" });
}

async function review(linkId: string, decision: string, rationale: unknown = "Reviewed and adequate", userId?: string, role = "REVIEWER", tenantId?: string) {
  return call("POST", `/ai-control-evidence/${linkId}/review`, userId ?? reviewerUserId, role, tenantId, { decision, rationale });
}

async function assurance(sysId: string) {
  return call("GET", `/ai-systems/${sysId}/assurance`, readOnlyUserId, "READ_ONLY");
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "S9 Test Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "S9 Test Tenant B" } })).id;
  const makeUser = async (label: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `s9-${label}-${stamp}`, email: `s9-${label}-${stamp}@example.com`, displayName: `S9 ${label}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");

  const fw = await prisma.framework.create({ data: { catalogId: `${PREFIX}${stamp}`, name: "S9 Test Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlA = await makeControl(version.id, "S9-1");
  ctrlB = await makeControl(version.id, "S9-2");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.aiControlEvidenceReview.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControlEvidence.deleteMany({ where: { tenantId: tenants } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.framework.deleteMany({ where: { id: fwId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("Assurance status derivation", () => {
  it("uses precedence Accepted > Pending > Rejected > No Evidence", () => {
    expect(deriveAssuranceStatus([])).toBe("NO_EVIDENCE");
    expect(deriveAssuranceStatus(["REJECTED"])).toBe("REJECTED");
    expect(deriveAssuranceStatus(["REJECTED", "PENDING_REVIEW"])).toBe("PENDING_REVIEW");
    expect(deriveAssuranceStatus(["PENDING_REVIEW", "ACCEPTED", "REJECTED"])).toBe("ACCEPTED");
  });
});

describe("AI-system evidence records", () => {
  it("creates internal AI-system evidence with no vendor, and audits it", async () => {
    const { sysId } = await setupSystem();
    const res = await addEvidence(sysId);
    expect(res.status).toBe(201);
    expect(res.body.aiSystemId).toBe(sysId);
    expect(res.body.vendorId).toBeNull();
    expect(res.body.uploadedByUserId).toBe(analystUserId);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system_evidence.created", targetId: res.body.id } });
    expect(event).not.toBeNull();
  });

  it("validates required fields and dates", async () => {
    const { sysId } = await setupSystem();
    expect((await addEvidence(sysId, { documentType: "" })).status).toBe(400);
    expect((await addEvidence(sysId, { displayFilename: "   " })).status).toBe(400);
    expect((await addEvidence(sysId, { expirationDate: "not-a-date" })).status).toBe(400);
  });

  it("blocks READ_ONLY and REVIEWER from adding evidence", async () => {
    const { sysId } = await setupSystem();
    expect((await addEvidence(sysId, {}, readOnlyUserId, "READ_ONLY")).status).toBe(403);
    expect((await addEvidence(sysId, {}, reviewerUserId, "REVIEWER")).status).toBe(403);
  });

  it("lists AI-system evidence with source and usability", async () => {
    const { sysId } = await setupSystem();
    await addEvidence(sysId);
    await addEvidence(sysId, { displayFilename: "Old.pdf", expirationDate: "2020-01-01" });
    const res = await call("GET", `/ai-systems/${sysId}/evidence`, readOnlyUserId, "READ_ONLY");
    expect(res.status).toBe(200);
    expect(res.body.evidence).toHaveLength(2);
    const expired = res.body.evidence.find((d: { displayFilename: string }) => d.displayFilename === "Old.pdf");
    expect(expired.source).toBe("AI_SYSTEM");
    expect(expired.usable).toBe(false);
  });

  it("requires login", async () => {
    const res = await server.inject({ method: "GET", url: "/ai-systems/anything/assurance" });
    expect(res.statusCode).toBe(401);
  });
});

describe("Submitting evidence to a mapped control", () => {
  it("starts at No Evidence, then moves to Pending Review with an audit event", async () => {
    const { sysId, recA } = await setupSystem();
    expect((await assurance(sysId)).body.byControl[recA]).toBe("NO_EVIDENCE");
    const doc = await addEvidence(sysId);
    const res = await submit(recA, doc.body.id);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.submittedByUserId).toBe(analystUserId);
    expect((await assurance(sysId)).body.byControl[recA]).toBe("PENDING_REVIEW");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_evidence.submitted", targetId: res.body.id } });
    expect(event).not.toBeNull();
  });

  it("rejects duplicate submission of the same evidence (409)", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    expect((await submit(recA, doc.body.id)).status).toBe(201);
    expect((await submit(recA, doc.body.id)).status).toBe(409);
  });

  it("rejects evidence that belongs to a different AI system", async () => {
    const first = await setupSystem();
    const second = await setupSystem();
    const doc = await addEvidence(second.sysId);
    expect((await submit(first.recA, doc.body.id)).status).toBe(400);
  });

  it("rejects submission to a control marked Not Applicable, and excludes it from assurance scope", async () => {
    const { sysId, recA, recB } = await setupSystem();
    await prisma.aiSystemControl.update({ where: { id: recB }, data: { applicability: "NOT_APPLICABLE", rationale: "Out of scope" } });
    const doc = await addEvidence(sysId);
    expect((await submit(recB, doc.body.id)).status).toBe(400);
    const res = await assurance(sysId);
    expect(res.body.summary.inScopeControls).toBe(1);
    expect(res.body.byControl[recB]).toBeUndefined();
    expect(res.body.byControl[recA]).toBe("NO_EVIDENCE");
  });

  it("rejects expired evidence", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId, { expirationDate: "2020-01-01" });
    expect(doc.status).toBe(201);
    expect((await submit(recA, doc.body.id)).status).toBe(400);
  });

  it("blocks REVIEWER and READ_ONLY from submitting", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    expect((await submit(recA, doc.body.id, reviewerUserId, "REVIEWER")).status).toBe(403);
    expect((await submit(recA, doc.body.id, readOnlyUserId, "READ_ONLY")).status).toBe(403);
  });
});

describe("Human review of control evidence", () => {
  it("accepts with a rationale, records append-only history, and audits it", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    const res = await review(link.body.id, "ACCEPT");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ACCEPTED");
    const rows = await prisma.aiControlEvidenceReview.findMany({ where: { linkId: link.body.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewerUserId).toBe(reviewerUserId);
    expect(rows[0]?.previousStatus).toBe("PENDING_REVIEW");
    expect(rows[0]?.newStatus).toBe("ACCEPTED");
    expect(rows[0]?.rationale).toBe("Reviewed and adequate");
    expect((await assurance(sysId)).body.byControl[recA]).toBe("ACCEPTED");
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_evidence.accepted", targetId: link.body.id } });
    expect(event).not.toBeNull();
  });

  it("requires a valid decision and a rationale", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    expect((await review(link.body.id, "ACCEPT", "")).status).toBe(400);
    expect((await review(link.body.id, "ACCEPT", null)).status).toBe(400);
    expect((await review(link.body.id, "APPROVE")).status).toBe(400);
    expect(await prisma.aiControlEvidenceReview.count({ where: { linkId: link.body.id } })).toBe(0);
  });

  it("blocks ANALYST and READ_ONLY from reviewing", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    expect((await review(link.body.id, "ACCEPT", "ok", analystUserId, "ANALYST")).status).toBe(403);
    expect((await review(link.body.id, "ACCEPT", "ok", readOnlyUserId, "READ_ONLY")).status).toBe(403);
  });

  it("enforces separation of duties for the submitter (fail closed, audited as DENIED)", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId, {}, adminUserId, "ADMIN");
    const link = await submit(recA, doc.body.id, adminUserId, "ADMIN");
    expect((await review(link.body.id, "ACCEPT", "Self approval", adminUserId, "ADMIN")).status).toBe(403);
    const denied = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_evidence.review_denied", targetId: link.body.id, outcome: "DENIED" } });
    expect(denied).not.toBeNull();
    expect((await prisma.aiSystemControlEvidence.findUniqueOrThrow({ where: { id: link.body.id } })).status).toBe("PENDING_REVIEW");
  });

  it("enforces separation of duties for the evidence uploader", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId, {}, adminUserId, "ADMIN");
    const link = await submit(recA, doc.body.id);
    expect((await review(link.body.id, "ACCEPT", "ok", adminUserId, "ADMIN")).status).toBe(403);
    expect((await review(link.body.id, "ACCEPT")).status).toBe(200);
  });

  it("only reviews pending evidence (409 on a second review)", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    expect((await review(link.body.id, "ACCEPT")).status).toBe(200);
    expect((await review(link.body.id, "REJECT", "Changed my mind")).status).toBe(409);
    expect(await prisma.aiControlEvidenceReview.count({ where: { linkId: link.body.id } })).toBe(1);
  });

  it("allows only one decision when two reviewers act at the same time", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    const [r1, r2] = await Promise.all([
      review(link.body.id, "ACCEPT"),
      review(link.body.id, "REJECT", "Not sufficient", adminUserId, "ADMIN"),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.aiControlEvidenceReview.count({ where: { linkId: link.body.id } })).toBe(1);
  });

  it("rejects, resubmits, then accepts - keeping the full history", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    expect((await review(link.body.id, "REJECT", "Missing signature page")).status).toBe(200);
    expect((await assurance(sysId)).body.byControl[recA]).toBe("REJECTED");
    expect((await call("POST", `/ai-control-evidence/${link.body.id}/resubmit`, analystUserId, "ANALYST", tenantAId, { note: "Signed copy" })).status).toBe(200);
    expect((await assurance(sysId)).body.byControl[recA]).toBe("PENDING_REVIEW");
    expect((await review(link.body.id, "ACCEPT")).status).toBe(200);
    const history = await call("GET", `/ai-system-controls/${recA}/evidence`, readOnlyUserId, "READ_ONLY");
    expect(history.body.assuranceStatus).toBe("ACCEPTED");
    expect(history.body.links[0].reviews).toHaveLength(2);
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_control_evidence.resubmitted", targetId: link.body.id } });
    expect(event).not.toBeNull();
  });

  it("only resubmits rejected evidence", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    expect((await call("POST", `/ai-control-evidence/${link.body.id}/resubmit`, analystUserId, "ANALYST", tenantAId, {})).status).toBe(409);
  });

  it("reports Accepted when one item is accepted and another is pending, with correct summary counts", async () => {
    const { sysId, recA } = await setupSystem();
    const doc1 = await addEvidence(sysId);
    const doc2 = await addEvidence(sysId, { displayFilename: "Second.pdf" });
    const link1 = await submit(recA, doc1.body.id);
    await submit(recA, doc2.body.id);
    await review(link1.body.id, "ACCEPT");
    const res = await assurance(sysId);
    expect(res.body.byControl[recA]).toBe("ACCEPTED");
    expect(res.body.summary).toEqual({ inScopeControls: 2, noEvidence: 1, pendingReview: 0, accepted: 1, rejected: 0 });
  });
});

describe("Tenant isolation", () => {
  it("returns 404 to another tenant for every Step 9 route", async () => {
    const { sysId, recA } = await setupSystem();
    const doc = await addEvidence(sysId);
    const link = await submit(recA, doc.body.id);
    const b = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>) => call(method, url, tenantBUserId, "ADMIN", tenantBId, payload);
    expect((await b("GET", `/ai-systems/${sysId}/assurance`)).status).toBe(404);
    expect((await b("GET", `/ai-systems/${sysId}/evidence`)).status).toBe(404);
    expect((await b("POST", `/ai-systems/${sysId}/evidence`, { displayFilename: "x", documentType: "y" })).status).toBe(404);
    expect((await b("GET", `/ai-system-controls/${recA}/evidence`)).status).toBe(404);
    expect((await b("POST", `/ai-system-controls/${recA}/evidence`, { evidenceDocumentId: doc.body.id })).status).toBe(404);
    expect((await b("POST", `/ai-control-evidence/${link.body.id}/review`, { decision: "ACCEPT", rationale: "x" })).status).toBe(404);
    expect((await b("POST", `/ai-control-evidence/${link.body.id}/resubmit`, {})).status).toBe(404);
    expect((await prisma.aiSystemControlEvidence.findUniqueOrThrow({ where: { id: link.body.id } })).status).toBe("PENDING_REVIEW");
  });

  it("cannot link another tenant's evidence document", async () => {
    const { recA } = await setupSystem();
    const sysB = await call("POST", "/ai-systems", tenantBUserId, "ADMIN", tenantBId, { name: "Tenant B System", origin: "INTERNAL" });
    const docB = await addEvidence(sysB.body.id, {}, tenantBUserId, "ADMIN", tenantBId);
    expect(docB.status).toBe(201);
    expect((await submit(recA, docB.body.id)).status).toBe(404);
  });
});