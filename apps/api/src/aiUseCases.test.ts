import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";
import { missingForSubmission } from "./aiUseCases.js";

// AI Use Cases V1 - CRUD, validation, tenant isolation, RBAC, lifecycle, human review + SoD, audit, relationships.
let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let reviewerUserId: string;
let reviewer2UserId: string;
let auditorUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.77." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookieFor(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}
async function call(method: "GET" | "POST" | "PATCH", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId?: string) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function newSystem(tenantId?: string, userId?: string) {
  return (await call("POST", "/ai-systems", userId ?? adminUserId, "ADMIN", { name: "UC Loan Underwriting AI", origin: "INTERNAL" }, tenantId)).body.id as string;
}
const BASE = { name: "Consumer loan decision support", businessPurpose: "Help loan officers assess consumer loan applications faster" };
async function create(sysId: string, payload: Record<string, unknown> = {}, userId?: string, role = "ANALYST", tenantId?: string) {
  return call("POST", `/ai-systems/${sysId}/use-cases`, userId ?? analystUserId, role, { ...BASE, ...payload }, tenantId);
}
/** Complete DRAFT created by ANALYST with ADMIN as business owner. */
async function completeDraft(sysId?: string, extra: Record<string, unknown> = {}, creatorId?: string, creatorRole = "ANALYST") {
  const res = await create(sysId ?? (await newSystem()), { ownerUserId: adminUserId, decisionRole: "RECOMMENDS", humanOversight: "REQUIRED", ...extra }, creatorId, creatorRole);
  expect(res.status).toBe(201);
  return res.body.id as string;
}
async function pending(sysId?: string, extra: Record<string, unknown> = {}, creatorId?: string, creatorRole = "ANALYST") {
  const id = await completeDraft(sysId, extra, creatorId, creatorRole);
  const res = await call("POST", `/ai-use-cases/${id}/submit`, creatorId ?? analystUserId, creatorRole);
  expect(res.status).toBe(200);
  return id;
}
async function review(id: string, decision: string, userId?: string, role = "REVIEWER", rationale: string | null = "Purpose and oversight are adequate", tenantId?: string) {
  return call("POST", `/ai-use-cases/${id}/review`, userId ?? reviewerUserId, role, { decision, ...(rationale === null ? {} : { rationale }) }, tenantId);
}
async function auditFor(id: string, action: string, outcome = "SUCCESS") {
  return prisma.auditEvent.findMany({ where: { tenantId: tenantAId, targetType: "AiUseCase", targetId: id, action, outcome } });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "UC Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "UC Tenant B" } })).id;
  const makeUser = async (label: string, tenantId: string, role: string) => {
    const user = await prisma.user.create({ data: { externalId: `uc-${label}-${stamp}`, email: `uc-${label}-${stamp}@example.com`, displayName: `UC ${label}` } });
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
    return user.id;
  };
  adminUserId = await makeUser("admin", tenantAId, "ADMIN");
  analystUserId = await makeUser("analyst", tenantAId, "ANALYST");
  reviewerUserId = await makeUser("reviewer", tenantAId, "REVIEWER");
  reviewer2UserId = await makeUser("reviewer2", tenantAId, "REVIEWER");
  auditorUserId = await makeUser("auditor", tenantAId, "AUDITOR");
  readOnlyUserId = await makeUser("readonly", tenantAId, "READ_ONLY");
  tenantBUserId = await makeUser("tenantb", tenantBId, "ADMIN");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.aiUseCase.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [adminUserId, analystUserId, reviewerUserId, reviewer2UserId, auditorUserId, readOnlyUserId, tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("AI Use Cases - create, read, list, edit", () => {
  it("creates a DRAFT under an AI system; server sets tenant, parent, status and creator (client values ignored)", async () => {
    const sysId = await newSystem();
    const res = await create(sysId, { tenantId: tenantBId, status: "APPROVED", createdByUserId: adminUserId, affectedParties: ["CUSTOMERS", "CUSTOMERS"] });
    expect(res.status).toBe(201);
    expect(res.body.tenantId).toBe(tenantAId);
    expect(res.body.aiSystemId).toBe(sysId);
    expect(res.body.status).toBe("DRAFT");
    expect(res.body.createdByUserId).toBe(analystUserId);
    expect(res.body.affectedParties).toEqual(["CUSTOMERS"]);
    expect(res.body.aiSystem.name).toBe("UC Loan Underwriting AI");
    expect(await auditFor(res.body.id, "ai_use_case.created")).toHaveLength(1);
  });

  it("lists tenant use cases (with status filter), lists by AI system, and returns detail", async () => {
    const sysId = await newSystem();
    const draftId = (await create(sysId)).body.id as string;
    const pendingId = await pending(sysId);
    const all = await call("GET", "/ai-use-cases", readOnlyUserId, "READ_ONLY");
    expect(all.status).toBe(200);
    expect(all.body.useCases.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([draftId, pendingId]));
    const filtered = await call("GET", "/ai-use-cases?status=PENDING_REVIEW", reviewerUserId, "REVIEWER");
    expect(filtered.body.useCases.every((u: { status: string }) => u.status === "PENDING_REVIEW")).toBe(true);
    expect(filtered.body.useCases.map((u: { id: string }) => u.id)).toContain(pendingId);
    expect((await call("GET", "/ai-use-cases?status=NOPE", adminUserId, "ADMIN")).status).toBe(400);
    const bySystem = await call("GET", `/ai-systems/${sysId}/use-cases`, auditorUserId, "AUDITOR");
    expect(bySystem.status).toBe(200);
    expect(bySystem.body.useCases.map((u: { id: string }) => u.id).sort()).toEqual([draftId, pendingId].sort());
    const detail = await call("GET", `/ai-use-cases/${draftId}`, auditorUserId, "AUDITOR");
    expect(detail.status).toBe(200);
    expect(detail.body.aiSystem.id).toBe(sysId);
    expect(detail.body.missingForSubmission).toEqual(["owner", "decisionRole", "humanOversight"]);
  });

  it("edits a DRAFT, audits the update and the owner change separately", async () => {
    const id = (await create(await newSystem())).body.id as string;
    const res = await call("PATCH", `/ai-use-cases/${id}`, analystUserId, "ANALYST", { department: "Retail Lending", decisionRole: "DECIDES", ownerUserId: adminUserId });
    expect(res.status).toBe(200);
    expect(res.body.department).toBe("Retail Lending");
    expect(res.body.decisionRole).toBe("DECIDES");
    expect(res.body.owner.id).toBe(adminUserId);
    expect(await auditFor(id, "ai_use_case.updated")).toHaveLength(1);
    const ownerEvents = await auditFor(id, "ai_use_case.owner_changed");
    expect(ownerEvents).toHaveLength(1);
    expect(ownerEvents[0]?.metadataJson).toMatchObject({ from: null, to: adminUserId });
    const cleared = await call("PATCH", `/ai-use-cases/${id}`, adminUserId, "ADMIN", { department: null });
    expect(cleared.body.department).toBeNull();
  });
});

describe("AI Use Cases - validation", () => {
  it("requires name and business purpose and validates enums, parties and text", async () => {
    const sysId = await newSystem();
    expect((await create(sysId, { name: "" })).status).toBe(400);
    expect((await create(sysId, { businessPurpose: "  " })).status).toBe(400);
    expect((await create(sysId, { decisionRole: "OVERRULES" })).status).toBe(400);
    expect((await create(sysId, { humanOversight: "SOMETIMES" })).status).toBe(400);
    expect((await create(sysId, { dataSensitivity: "TOP_SECRET" })).status).toBe(400);
    expect((await create(sysId, { affectedParties: ["ALIENS"] })).status).toBe(400);
    expect((await create(sysId, { affectedParties: "CUSTOMERS" })).status).toBe(400);
    expect((await create(sysId, { name: "x".repeat(201) })).status).toBe(400);
  });

  it("rejects an owner who is not a member of the tenant (create and edit)", async () => {
    const sysId = await newSystem();
    expect((await create(sysId, { ownerUserId: tenantBUserId })).status).toBe(400);
    expect((await create(sysId, { ownerUserId: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
    const id = (await create(sysId)).body.id as string;
    expect((await call("PATCH", `/ai-use-cases/${id}`, analystUserId, "ANALYST", { ownerUserId: tenantBUserId })).status).toBe(400);
  });

  it("never lets a client PATCH status, review, tenant, parent or creator fields", async () => {
    const id = (await create(await newSystem())).body.id as string;
    for (const field of ["status", "createdByUserId", "reviewerUserId", "reviewDecision", "reviewRationale", "reviewedAt", "submittedAt", "tenantId", "aiSystemId"]) {
      const res = await call("PATCH", `/ai-use-cases/${id}`, adminUserId, "ADMIN", { [field]: field === "status" ? "APPROVED" : "x" });
      expect(res.status, field).toBe(400);
    }
    const after = await prisma.aiUseCase.findUnique({ where: { id } });
    expect(after?.status).toBe("DRAFT");
    expect(after?.reviewDecision).toBeNull();
    expect((await call("PATCH", `/ai-use-cases/${id}`, adminUserId, "ADMIN", {})).status).toBe(400);
  });
});

describe("AI Use Cases - tenant isolation", () => {
  it("another tenant cannot list, read, edit, submit or review, and cannot create under this tenant's system", async () => {
    const sysId = await newSystem();
    const id = await pending(sysId);
    const list = await call("GET", "/ai-use-cases", tenantBUserId, "ADMIN", undefined, tenantBId);
    expect(list.status).toBe(200);
    expect(list.body.useCases.map((u: { id: string }) => u.id)).not.toContain(id);
    expect((await call("GET", `/ai-use-cases/${id}`, tenantBUserId, "ADMIN", undefined, tenantBId)).status).toBe(404);
    expect((await call("PATCH", `/ai-use-cases/${id}`, tenantBUserId, "ADMIN", { department: "x" }, tenantBId)).status).toBe(404);
    expect((await call("POST", `/ai-use-cases/${id}/submit`, tenantBUserId, "ADMIN", undefined, tenantBId)).status).toBe(404);
    expect((await review(id, "APPROVED", tenantBUserId, "ADMIN", "cross-tenant", tenantBId)).status).toBe(404);
    expect((await call("GET", `/ai-systems/${sysId}/use-cases`, tenantBUserId, "ADMIN", undefined, tenantBId)).status).toBe(404);
    expect((await create(sysId, {}, tenantBUserId, "ADMIN", tenantBId)).status).toBe(404);
    const untouched = await prisma.aiUseCase.findUnique({ where: { id } });
    expect(untouched?.status).toBe("PENDING_REVIEW");
    expect(untouched?.reviewDecision).toBeNull();
  });

  it("filters a list by an AI system id from another tenant to nothing", async () => {
    const otherSys = await newSystem(tenantBId, tenantBUserId);
    await create(otherSys, {}, tenantBUserId, "ADMIN", tenantBId);
    const res = await call("GET", `/ai-use-cases?aiSystemId=${otherSys}`, adminUserId, "ADMIN");
    expect(res.body.useCases).toEqual([]);
  });
});

describe("AI Use Cases - RBAC", () => {
  it("REVIEWER, AUDITOR and READ_ONLY cannot create, edit or submit", async () => {
    const sysId = await newSystem();
    const id = await completeDraft(sysId);
    for (const [userId, role] of [[reviewerUserId, "REVIEWER"], [auditorUserId, "AUDITOR"], [readOnlyUserId, "READ_ONLY"]] as const) {
      expect((await create(sysId, {}, userId, role)).status, role).toBe(403);
      expect((await call("PATCH", `/ai-use-cases/${id}`, userId, role, { department: "x" })).status, role).toBe(403);
      expect((await call("POST", `/ai-use-cases/${id}/submit`, userId, role)).status, role).toBe(403);
    }
    expect((await prisma.aiUseCase.findUnique({ where: { id } }))?.status).toBe("DRAFT");
  });

  it("ANALYST, AUDITOR and READ_ONLY cannot review (403, audited as DENIED)", async () => {
    const id = await pending();
    for (const [userId, role] of [[analystUserId, "ANALYST"], [auditorUserId, "AUDITOR"], [readOnlyUserId, "READ_ONLY"]] as const) {
      expect((await review(id, "APPROVED", userId, role)).status, role).toBe(403);
    }
    const denied = await auditFor(id, "ai_use_case.review_denied", "DENIED");
    expect(denied.filter((e) => (e.metadataJson as { reason?: string }).reason === "missing_permission")).toHaveLength(3);
    expect((await prisma.aiUseCase.findUnique({ where: { id } }))?.status).toBe("PENDING_REVIEW");
  });
});

describe("AI Use Cases - lifecycle", () => {
  it("submission requires owner, business purpose, decision role and human oversight", async () => {
    const id = (await create(await newSystem())).body.id as string;
    const res = await call("POST", `/ai-use-cases/${id}/submit`, analystUserId, "ANALYST");
    expect(res.status).toBe(400);
    expect(res.body.missing).toEqual(["owner", "decisionRole", "humanOversight"]);
    expect(missingForSubmission({ ownerUserId: "u", businessPurpose: " ", decisionRole: "ADVISORY", humanOversight: "REQUIRED" })).toEqual(["businessPurpose"]);
  });

  it("DRAFT -> PENDING_REVIEW sets submittedAt and is audited; pending use cases cannot be edited or resubmitted", async () => {
    const id = await completeDraft();
    const res = await call("POST", `/ai-use-cases/${id}/submit`, analystUserId, "ANALYST");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.submittedAt).not.toBeNull();
    expect(await auditFor(id, "ai_use_case.submitted")).toHaveLength(1);
    expect((await call("PATCH", `/ai-use-cases/${id}`, analystUserId, "ANALYST", { department: "x" })).status).toBe(409);
    expect((await call("POST", `/ai-use-cases/${id}/submit`, analystUserId, "ANALYST")).status).toBe(409);
  });

  it("APPROVED is read-only and cannot be re-reviewed", async () => {
    const id = await pending();
    const res = await review(id, "APPROVED");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
    expect(res.body.reviewer.id).toBe(reviewerUserId);
    expect(await auditFor(id, "ai_use_case.review_recorded")).toHaveLength(1);
    expect((await call("PATCH", `/ai-use-cases/${id}`, adminUserId, "ADMIN", { department: "x" })).status).toBe(409);
    expect((await call("POST", `/ai-use-cases/${id}/submit`, analystUserId, "ANALYST")).status).toBe(409);
    expect((await review(id, "REJECTED", reviewer2UserId)).status).toBe(409);
    const after = await prisma.aiUseCase.findUnique({ where: { id } });
    expect(after?.reviewDecision).toBe("APPROVED");
    expect(after?.reviewerUserId).toBe(reviewerUserId);
    const denied = await auditFor(id, "ai_use_case.review_denied", "DENIED");
    expect(denied.some((e) => (e.metadataJson as { reason?: string }).reason === "already_approved")).toBe(true);
  });

  it("REJECTED and CHANGES_REQUESTED return the use case to DRAFT with the decision kept, and it can be resubmitted", async () => {
    for (const decision of ["REJECTED", "CHANGES_REQUESTED"]) {
      const id = await pending();
      const res = await review(id, decision, undefined, "REVIEWER", "Clarify the human oversight step");
      expect(res.status, decision).toBe(200);
      expect(res.body.status).toBe("DRAFT");
      expect(res.body.reviewDecision).toBe(decision);
      expect(res.body.reviewRationale).toBe("Clarify the human oversight step");
      expect((await call("PATCH", `/ai-use-cases/${id}`, analystUserId, "ANALYST", { description: "Loan officer confirms every recommendation" })).status).toBe(200);
      expect((await call("POST", `/ai-use-cases/${id}/submit`, analystUserId, "ANALYST")).body.status).toBe("PENDING_REVIEW");
      expect((await review(id, "APPROVED", reviewer2UserId)).body.status).toBe("APPROVED");
    }
  });

  it("only a pending use case can be reviewed", async () => {
    const id = await completeDraft();
    expect((await review(id, "APPROVED")).status).toBe(409);
  });
});

describe("AI Use Cases - human review and separation of duties", () => {
  it("requires a valid decision and a rationale", async () => {
    const id = await pending();
    expect((await review(id, "MAYBE")).status).toBe(400);
    expect((await review(id, "APPROVED", undefined, "REVIEWER", null)).status).toBe(400);
    expect((await review(id, "APPROVED", undefined, "REVIEWER", "   ")).status).toBe(400);
  });

  it("the creator cannot review their own use case (ADMIN creator)", async () => {
    const id = await pending(undefined, { ownerUserId: reviewerUserId }, adminUserId, "ADMIN");
    const res = await review(id, "APPROVED", adminUserId, "ADMIN");
    expect(res.status).toBe(403);
    const denied = await auditFor(id, "ai_use_case.review_denied", "DENIED");
    expect(denied.map((e) => (e.metadataJson as { reason?: string }).reason)).toContain("self_review");
    expect((await prisma.aiUseCase.findUnique({ where: { id } }))?.status).toBe("PENDING_REVIEW");
  });

  it("the business owner cannot review their own use case", async () => {
    const id = await pending(undefined, { ownerUserId: reviewerUserId });
    const res = await review(id, "APPROVED", reviewerUserId);
    expect(res.status).toBe(403);
    const denied = await auditFor(id, "ai_use_case.review_denied", "DENIED");
    expect(denied.map((e) => (e.metadataJson as { reason?: string }).reason)).toContain("owner_review");
    expect((await review(id, "APPROVED", reviewer2UserId)).status).toBe(200);
  });

  it("fails closed when no business owner is assigned", async () => {
    const id = await pending();
    await prisma.aiUseCase.update({ where: { id }, data: { ownerUserId: null } });
    const res = await review(id, "APPROVED");
    expect(res.status).toBe(403);
    const denied = await auditFor(id, "ai_use_case.review_denied", "DENIED");
    expect(denied.map((e) => (e.metadataJson as { reason?: string }).reason)).toContain("no_owner_assigned");
    expect((await prisma.aiUseCase.findUnique({ where: { id } }))?.status).toBe("PENDING_REVIEW");
  });

  it("an ADMIN who is neither creator nor owner can review", async () => {
    const id = await pending(undefined, { ownerUserId: reviewerUserId });
    const res = await review(id, "APPROVED", adminUserId, "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("APPROVED");
  });
});

describe("AI Use Cases - relationships", () => {
  it("one AI system has many use cases; deleting the AI system removes them", async () => {
    const sysId = await newSystem();
    const a = (await create(sysId, { name: "Use A" })).body.id as string;
    const b = (await create(sysId, { name: "Use B" })).body.id as string;
    expect((await prisma.aiUseCase.findMany({ where: { aiSystemId: sysId } })).map((u) => u.id).sort()).toEqual([a, b].sort());
    await prisma.aiSystem.delete({ where: { id: sysId } });
    expect(await prisma.aiUseCase.count({ where: { id: { in: [a, b] } } })).toBe(0);
  });

  it("use cases never change the AI system's classification or its risk / impact assessments", async () => {
    const sysId = await newSystem();
    const ra = await call("POST", `/ai-systems/${sysId}/risk-assessments`, analystUserId, "ANALYST", { name: "Risk Assessment v1" });
    expect(ra.status).toBe(201);
    const ia = await call("POST", `/ai-systems/${sysId}/impact-assessments`, analystUserId, "ANALYST", { name: "Impact Assessment v1" });
    expect(ia.status).toBe(201);
    const before = await prisma.aiSystem.findUnique({ where: { id: sysId } });
    const riskBefore = await prisma.aiRiskAssessment.findUnique({ where: { id: ra.body.id } });
    const impactBefore = await prisma.aiImpactAssessment.findUnique({ where: { id: ia.body.id } });
    const id = await pending(sysId, { decisionRole: "DECIDES", humanOversight: "NOT_APPLICABLE", dataSensitivity: "RESTRICTED" });
    expect((await review(id, "APPROVED")).status).toBe(200);
    const after = await prisma.aiSystem.findUnique({ where: { id: sysId } });
    expect(after?.decisionRole).toBe(before?.decisionRole ?? null);
    expect(after?.humanOversight).toBe(before?.humanOversight ?? null);
    expect(after?.dataSensitivity).toBe(before?.dataSensitivity ?? null);
    expect(after?.lifecycleStatus).toBe(before?.lifecycleStatus);
    expect(after?.assessmentStatus).toBe(before?.assessmentStatus);
    expect(await prisma.aiRiskAssessment.findUnique({ where: { id: ra.body.id } })).toEqual(riskBefore);
    expect(await prisma.aiImpactAssessment.findUnique({ where: { id: ia.body.id } })).toEqual(impactBefore);
  });
});
