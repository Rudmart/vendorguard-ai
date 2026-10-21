import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

const tenants: string[] = [], users: string[] = [];
const cookies: Record<string, string> = {};
let vendorId: string, foreignVendor: string, foreignFinding: string, otherFinding: string, ownFinding: string, riskId: string;
let failAudit = false, failVerification = false, ip = 0;
async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ANALYST") {
  return server.inject({ method, url, cookies: { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.198.${Math.floor(++ip / 250)}.${ip % 250}` });
}
async function governed(status: "OPEN" | "IN_PROGRESS" | "PENDING_VERIFICATION" = "OPEN", owner = users[1]!) {
  const finding = await prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Disposable remediation finding", description: "Test", severity: "HIGH", status: "OPEN", createdByUserId: users[0]! } });
  const remediation = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, governanceFindingId: finding.id, title: "Corrective action", description: "Test corrective action", ownerUserId: owner, status } });
  return { finding, remediation };
}
beforeAll(async () => {
  for (const label of ["A", "B"]) tenants.push((await prisma.tenant.create({ data: { name: `Section15 remediation ${label}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section15.example.test`, displayName: role } });
    users.push(user.id);
    const tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!;
    const actualRole = role === "FOREIGN" ? "ADMIN" : role;
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, role: actualRole, email: user.email, displayName: role });
  }
  async function vendor(tenantId: string, name: string) { return prisma.vendor.create({ data: { tenantId, legalName: name, serviceDescription: "Disposable", serviceCategory: "Test", criticality: "LOW" } }); }
  vendorId = (await vendor(tenants[0]!, "Own vendor")).id;
  foreignVendor = (await vendor(tenants[1]!, "Foreign vendor")).id;
  const otherVendor = await vendor(tenants[0]!, "Other same-tenant vendor");
  const control = await prisma.control.findFirstOrThrow({ where: { frameworkVersion: { isCurrent: true, framework: { tenantId: null } } } });
  async function finding(tenantId: string, vendorId: string, userId: string) {
    const assessment = await prisma.assessment.create({ data: { tenantId, vendorId, startedByUserId: userId, scoringModelVersion: "section15" } });
    return prisma.controlFinding.create({ data: { tenantId, vendorId, assessmentId: assessment.id, controlId: control.id, status: "FAIL" } });
  }
  ownFinding = (await finding(tenants[0]!, vendorId, users[1]!)).id;
  foreignFinding = (await finding(tenants[1]!, foreignVendor, users[5]!)).id;
  otherFinding = (await finding(tenants[0]!, otherVendor.id, users[1]!)).id;
  const system = await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: "Section15 fixture", origin: "INTERNAL" } });
  const assessment = await prisma.aiRiskAssessment.create({ data: { tenantId: tenants[0]!, aiSystemId: system.id, name: "Fixture", version: 1 } });
  riskId = (await prisma.aiRisk.create({ data: { tenantId: tenants[0]!, assessmentId: assessment.id, title: "Fixture risk", category: "OPERATIONAL", statement: "Test", likelihood: 1, impact: 1, inherentScore: 1, inherentRating: "LOW" } })).id;
  databaseClient.$use(async (params, next) => {
    if (params.action === "create" && params.args?.data?.tenantId === tenants[0] && ((failAudit && params.model === "AuditEvent") || (failVerification && params.model === "RemediationVerification"))) throw new Error("Disposable remediation persistence failure");
    return next(params);
  });
});
afterEach(() => { failAudit = false; failVerification = false; });
afterAll(async () => {
  await prisma.remediationVerification.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
it.each([null, { title: " ", description: "Test" }, { title: {}, description: "Test" }, { title: "Test", description: "Test", dueDate: "bad-date" }])("rejects malformed vendor remediation %j", async body => {
  const before = await prisma.remediationAction.count({ where: { tenantId: tenants[0] } });
  expect((await call("POST", `/vendors/${vendorId}/remediations`, body)).statusCode).toBe(400);
  expect(await prisma.remediationAction.count({ where: { tenantId: tenants[0] } })).toBe(before);
});
it.each([null, { title: " ", description: "Test" }, { title: "Test", description: {} }, { title: "Test", description: "Test", dueDate: "bad-date" }, { title: "Test", description: "Test", ownerUserId: {} }])("rejects malformed AI-risk remediation %j", async body => {
  expect((await call("POST", `/ai-risks/${riskId}/remediation`, body)).statusCode).toBe(400);
});
it("denies a foreign AI-risk remediation owner without writing a relationship", async () => {
  expect((await call("POST", `/ai-risks/${riskId}/remediation`, { title: "Test", description: "Test", ownerUserId: users[5] })).statusCode).toBe(400);
});
it.each(["foreign", "other-vendor", "missing"])("denies vendor remediation linked to %s finding", async kind => {
  const findingId = kind === "foreign" ? foreignFinding : kind === "other-vendor" ? otherFinding : randomUUID();
  const before = await prisma.remediationAction.count({ where: { tenantId: tenants[0] } });
  expect((await call("POST", `/vendors/${vendorId}/remediations`, { title: "Test", description: "Test", findingId })).statusCode).toBe(404);
  expect(await prisma.remediationAction.count({ where: { tenantId: tenants[0] } })).toBe(before);
});
it.each([42, "text", true])("rejects primitive governance update %j", async body => {
  const { remediation } = await governed();
  expect((await call("PATCH", `/governance-remediations/${remediation.id}`, body)).statusCode).toBe(400);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).toEqual(remediation);
});
it("rejects a null generic update", async () => {
  const { remediation } = await governed();
  expect((await call("PATCH", `/remediations/${remediation.id}`, null, "ADMIN")).statusCode).toBe(400);
});
it("audits vendor creation and generic status updates", async () => {
  const created = await call("POST", `/vendors/${vendorId}/remediations`, { title: "Corrective action", description: "Test", findingId: ownFinding });
  expect(created.statusCode).toBe(201);
  const id = created.json().id;
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], targetId: id, action: "remediation.created" } })).toBe(1);
  expect((await call("PATCH", `/remediations/${id}`, { status: "IN_PROGRESS" }, "ADMIN")).statusCode).toBe(200);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], targetId: id, action: "remediation.status_changed" } })).toBe(1);
});
it.each(["create", "update", "submit", "verify", "verification-row", "vendor-create"])("rolls back partial state on injected %s persistence/audit failure", async operation => {
  const { finding, remediation } = await governed(operation === "verify" || operation === "verification-row" ? "PENDING_VERIFICATION" : "IN_PROGRESS");
  const creationFinding = operation === "create" ? await prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Unremediated fixture", description: "Test", severity: "HIGH", status: "OPEN", createdByUserId: users[0]! } }) : finding;
  const total = await prisma.remediationAction.count({ where: { tenantId: tenants[0] } });
  failAudit = operation !== "verification-row";
  failVerification = operation === "verification-row";
  let response;
  try {
    response = operation === "create" ? await call("POST", `/governance-findings/${creationFinding.id}/remediation`, { title: "Test", description: "Test", ownerUserId: users[1] }) : operation === "vendor-create" ? await call("POST", `/vendors/${vendorId}/remediations`, { title: "Test", description: "Test" }) : operation === "update" ? await call("PATCH", `/governance-remediations/${remediation.id}`, { title: "Changed" }) : operation === "submit" ? await call("POST", `/governance-remediations/${remediation.id}/submit`, {}) : await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "VERIFIED", rationale: "Injected rollback" }, "REVIEWER");
  } finally { failAudit = false; failVerification = false; }
  expect(response.statusCode).toBe(500);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).toEqual(remediation);
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
  expect(await prisma.remediationVerification.count({ where: { remediationId: remediation.id } })).toBe(0);
  expect(await prisma.remediationAction.count({ where: { tenantId: tenants[0] } })).toBe(total);
});
it("does not overwrite closure attribution on a repeated generic close", async () => {
  const rem = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, vendorId, title: "Repeat close", description: "Test" } });
  expect((await call("PATCH", `/remediations/${rem.id}`, { status: "CLOSED" }, "ADMIN")).statusCode).toBe(200);
  const before = await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } });
  expect((await call("PATCH", `/remediations/${rem.id}`, { status: "CLOSED" }, "REVIEWER")).statusCode).toBe(200);
  const after = await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } });
  expect(after).toEqual(before);
});
it.each([{}, [], 42, ""])("rejects malformed vendor finding reference %j without partial state", async findingId => {
  const before = await prisma.remediationAction.count({ where: { tenantId: tenants[0] } });
  expect((await call("POST", `/vendors/${vendorId}/remediations`, { title: "Test", description: "Test", findingId })).statusCode).toBe(400);
  expect(await prisma.remediationAction.count({ where: { tenantId: tenants[0] } })).toBe(before);
});
it.each([{ dueDate: {} }, { dueDate: 42 }, { title: " " }, { description: [] }, { ownerUserId: "" }, { status: "CLOSED" }, { status: "PENDING_VERIFICATION" }])("rejects invalid governed changes %j", async body => {
  const { remediation } = await governed();
  expect((await call("PATCH", `/governance-remediations/${remediation.id}`, body, "ADMIN")).statusCode).toBe(400);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).toEqual(remediation);
});
it("supports valid AI-risk ownership/due date and verifies persisted values through reads", async () => {
  const created = await call("POST", `/ai-risks/${riskId}/remediation`, { title: "Owned action", description: "Persisted correction", ownerUserId: users[1], dueDate: "2026-01-01" });
  expect(created.statusCode).toBe(201);
  const saved = await prisma.remediationAction.findUniqueOrThrow({ where: { id: created.json().id } });
  expect(saved).toMatchObject({ aiRiskId: riskId, ownerUserId: users[1], title: "Owned action" });
  expect(saved.dueDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  const list = await call("GET", "/remediations");
  expect(list.statusCode).toBe(200);
  expect(list.json().remediations.some((row: { id: string }) => row.id === saved.id)).toBe(true);
});
it("recomputes overdue after due-date clearing and rejects a foreign reassignment", async () => {
  const { remediation } = await governed();
  expect((await call("PATCH", `/governance-remediations/${remediation.id}`, { dueDate: "2026-01-01" })).statusCode).toBe(200);
  expect((await call("GET", `/governance-remediations/${remediation.id}`)).json().overdue).toBe(true);
  expect((await call("PATCH", `/governance-remediations/${remediation.id}`, { dueDate: null })).statusCode).toBe(200);
  expect((await call("GET", `/governance-remediations/${remediation.id}`)).json()).toMatchObject({ dueDate: null, overdue: false });
  expect((await call("PATCH", `/governance-remediations/${remediation.id}`, { ownerUserId: users[5] }, "ADMIN")).statusCode).toBe(400);
  expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).ownerUserId).toBe(users[1]);
});
it("allows one concurrent create, submit and verification while preserving protected history", async () => {
  const finding = await prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Concurrent correction", description: "Test", severity: "HIGH", status: "OPEN", createdByUserId: users[0]! } });
  const body = { title: "Concurrent", description: "Test", ownerUserId: users[1] };
  const creates = await Promise.all([call("POST", `/governance-findings/${finding.id}/remediation`, body), call("POST", `/governance-findings/${finding.id}/remediation`, body)]);
  expect(creates.map(r => r.statusCode).sort()).toEqual([201, 409]);
  const id = creates.find(r => r.statusCode === 201)!.json().id;
  expect((await call("POST", `/governance-remediations/${id}/submit`, {})).statusCode).toBe(409);
  expect((await call("PATCH", `/governance-remediations/${id}`, { status: "IN_PROGRESS" })).statusCode).toBe(200);
  const submits = await Promise.all([call("POST", `/governance-remediations/${id}/submit`, {}), call("POST", `/governance-remediations/${id}/submit`, {})]);
  expect(submits.map(r => r.statusCode).sort()).toEqual([200, 409]);
  expect((await call("PATCH", `/governance-remediations/${id}`, { ownerUserId: users[2] }, "ADMIN")).statusCode).toBe(409);
  const verifies = await Promise.all([call("POST", `/governance-remediations/${id}/verify`, { decision: "VERIFIED", rationale: "Reviewer verified" }, "REVIEWER"), call("POST", `/governance-remediations/${id}/verify`, { decision: "VERIFIED", rationale: "Auditor verified" }, "AUDITOR")]);
  expect(verifies.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const history = await prisma.remediationVerification.findMany({ where: { remediationId: id } });
  expect(history).toHaveLength(1);
  expect((await call("PATCH", `/governance-remediations/${id}`, { status: "IN_PROGRESS" }, "ADMIN")).statusCode).toBe(409);
  expect((await call("PATCH", `/remediations/${id}`, { status: "OPEN" }, "ADMIN")).statusCode).toBe(409);
  expect((await call("PATCH", `/remediation-verifications/${history[0]!.id}`, { rationale: "Overwrite" }, "ADMIN")).statusCode).toBe(404);
  expect((await call("DELETE", `/remediation-verifications/${history[0]!.id}`, undefined, "ADMIN")).statusCode).toBe(404);
  expect(await prisma.remediationVerification.findMany({ where: { remediationId: id } })).toEqual(history);
});
it("preserves rejected/returned history through resubmission and independent closure", async () => {
  const { finding, remediation } = await governed("PENDING_VERIFICATION");
  expect((await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "REJECTED", rationale: "Return for correction" }, "AUDITOR")).statusCode).toBe(200);
  expect((await call("GET", `/governance-remediations/${remediation.id}`)).json().status).toBe("IN_PROGRESS");
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: finding.id } })).status).toBe("OPEN");
  expect((await call("POST", `/governance-remediations/${remediation.id}/submit`, {})).statusCode).toBe(200);
  expect((await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "VERIFIED", rationale: "Independent recheck" }, "REVIEWER")).statusCode).toBe(200);
  const history = await prisma.remediationVerification.findMany({ where: { remediationId: remediation.id }, orderBy: { createdAt: "asc" } });
  expect(history.map(row => row.rationale)).toEqual(["Return for correction", "Independent recheck"]);
});
it.each(["generic-update", "risk-create"])("rolls back corrected legacy path on audit failure: %s", async operation => {
  const rem = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, vendorId, title: "Atomic legacy action", description: "Test" } });
  const total = await prisma.remediationAction.count({ where: { tenantId: tenants[0] } });
  failAudit = true;
  let response;
  try { response = operation === "generic-update" ? await call("PATCH", `/remediations/${rem.id}`, { status: "CLOSED" }, "ADMIN") : await call("POST", `/ai-risks/${riskId}/remediation`, { title: "Rollback risk action", description: "Test" }); }
  finally { failAudit = false; }
  expect(response.statusCode).toBe(500);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } })).toEqual(rem);
  expect(await prisma.remediationAction.count({ where: { tenantId: tenants[0] } })).toBe(total);
});
it("rolls back closure if the associated finding is no longer OPEN", async () => {
  const { finding, remediation } = await governed("PENDING_VERIFICATION");
  await prisma.governanceFinding.update({ where: { id: finding.id }, data: { status: "DISMISSED" } });
  expect((await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "VERIFIED", rationale: "Not permitted" }, "REVIEWER")).statusCode).toBe(409);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).toEqual(remediation);
  expect(await prisma.remediationVerification.count({ where: { remediationId: remediation.id } })).toBe(0);
});
it.each(["", " ", null, {}, 42])("rejects invalid verification rationale %j without partial state", async rationale => {
  const { remediation } = await governed("PENDING_VERIFICATION");
  expect((await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "VERIFIED", rationale }, "REVIEWER")).statusCode).toBe(400);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: remediation.id } })).toEqual(remediation);
});
it("denies direct foreign/missing IDs and self-verification by an otherwise authorized verifier", async () => {
  const { remediation } = await governed("PENDING_VERIFICATION", users[2]!);
  expect((await call("POST", `/governance-remediations/${remediation.id}/verify`, { decision: "VERIFIED", rationale: "Self" }, "REVIEWER")).statusCode).toBe(403);
  for (const url of [`/governance-remediations/${remediation.id}`, `/governance-remediations/${randomUUID()}`, "/governance-remediations/invalid-id"]) {
    expect((await call("GET", url, undefined, "FOREIGN")).statusCode).toBe(404);
    expect((await call("PATCH", url, { title: "Denied" }, "FOREIGN")).statusCode).toBe(404);
  }
  expect(await prisma.remediationVerification.count({ where: { remediationId: remediation.id } })).toBe(0);
});
