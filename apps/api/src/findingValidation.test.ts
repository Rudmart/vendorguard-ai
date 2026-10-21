import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";
import { getSessionFromCookie } from "@vendorguard/auth";
import { proposeLegacyFinding } from "./legacyFindingGovernance.js";

const tenants: string[] = [], users: string[] = [];
const cookies: Record<string, string> = {};
let vendorId: string, controlId: string, auditFailure = false, ip = 0;
async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ANALYST") {
  return server.inject({ method, url, cookies: { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.197.${Math.floor(++ip / 250)}.${ip % 250}` });
}
async function assessment() {
  return prisma.assessment.create({ data: { tenantId: tenants[0]!, vendorId, scoringModelVersion: "section14", startedByUserId: users[1]! } });
}
async function proposal() {
  const a = await assessment();
  const response = await call("POST", `/assessments/${a.id}/findings`, { controlId, status: "FAIL" });
  expect(response.statusCode).toBe(200);
  return { assessmentId: a.id, finding: response.json() as { id: string } };
}
async function governanceFinding() {
  return prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Disposable finding", description: "Disposable description", severity: "HIGH", createdByUserId: users[0]! } });
}
beforeAll(async () => {
  for (const name of ["A", "B"]) tenants.push((await prisma.tenant.create({ data: { name: `Section14 findings ${name}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section14.example.test`, displayName: role } });
    users.push(user.id);
    const tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!;
    const actualRole = role === "FOREIGN" ? "ADMIN" : role;
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, role: actualRole, email: user.email, displayName: role });
  }
  vendorId = (await prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section14 disposable", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } })).id;
  controlId = (await prisma.control.findFirstOrThrow({ where: { frameworkVersion: { isCurrent: true, framework: { tenantId: null } } } })).id;
  databaseClient.$use(async (params, next) => {
    if (auditFailure && params.model === "AuditEvent" && params.action === "create" && params.args?.data?.tenantId === tenants[0]) throw new Error("Disposable finding audit failure");
    return next(params);
  });
});
afterEach(() => { auditFailure = false; });
afterAll(async () => {
  await prisma.governanceFindingReview.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.reviewDecision.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.controlFinding.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});
it.each([null, { controlId: {}, status: "FAIL" }, { controlId: 42, status: "FAIL" }])("rejects malformed legacy proposals %j", async body => {
  const a = await assessment();
  const response = await call("POST", `/assessments/${a.id}/findings`, body);
  expect(response.statusCode).toBe(400);
  expect(response.body).not.toMatch(/Prisma|TypeError|stack/);
  expect(await prisma.controlFinding.count({ where: { assessmentId: a.id } })).toBe(0);
});
it.each([null, { decision: "ACCEPT", rationale: "Valid", finalStatus: 0 }, { decision: "ACCEPT", rationale: "Valid", finalStatus: false }, { decision: "ACCEPT", rationale: "Valid", finalStatus: "" }])("rejects malformed legacy review %j without a decision", async body => {
  const { assessmentId, finding } = await proposal();
  const response = await call("POST", `/assessments/${assessmentId}/findings/${finding.id}/review`, body, "REVIEWER");
  expect(response.statusCode).toBe(400);
  expect(await prisma.reviewDecision.count({ where: { findingId: finding.id } })).toBe(0);
  expect((await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } })).requiresHumanReview).toBe(true);
});
it("rejects null legacy reconciliation input", async () => {
  expect((await call("POST", `/assessments/${randomUUID()}/findings/${randomUUID()}/reconcile`, null)).statusCode).toBe(400);
});
it.each([42, "text", true])("rejects primitive governance update %j without writes", async body => {
  const finding = await governanceFinding();
  expect((await call("PATCH", `/governance-findings/${finding.id}`, body, "ADMIN")).statusCode).toBe(400);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: finding.id } })).toEqual(finding);
});
it.each(["ACCEPT", "REJECT", "OVERRIDE", "NOT_APPLICABLE"])("requires an independent human for %s and preserves the final decision", async decision => {
  const { assessmentId, finding } = await proposal();
  const before = await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } });
  expect(before).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", proposedStatus: "FAIL", requiresHumanReview: true });
  const url = `/assessments/${assessmentId}/findings/${finding.id}/review`;
  for (const role of ["ANALYST", "AUDITOR", "READ_ONLY"]) expect((await call("POST", url, { decision, rationale: "Denied" }, role)).statusCode).toBe(403);
  expect((await call("POST", url, { decision, rationale: "Denied" }, "FOREIGN")).statusCode).toBe(404);
  const response = await call("POST", url, { decision, rationale: `Human ${decision}` }, "REVIEWER");
  expect(response.statusCode).toBe(200);
  expect(response.json().finding).toMatchObject({ requiresHumanReview: false, status: decision === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : decision === "REJECT" ? "INSUFFICIENT_EVIDENCE" : "FAIL" });
  expect((await call("POST", url, { decision: "OVERRIDE", rationale: "Overwrite" }, "ADMIN")).statusCode).toBe(409);
  expect((await call("POST", `/assessments/${assessmentId}/findings`, { controlId, status: "PASS" })).statusCode).toBe(409);
  const history = await prisma.reviewDecision.findMany({ where: { findingId: finding.id } });
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ decision, rationale: `Human ${decision}`, reviewerUserId: users[2] });
  expect((await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } })).confidence).toBe(before.confidence);
});
it("retains REQUEST_MORE_EVIDENCE history through a revised proposal and independent final review", async () => {
  const { assessmentId, finding } = await proposal();
  const url = `/assessments/${assessmentId}/findings/${finding.id}/review`;
  expect((await call("POST", url, { decision: "REQUEST_MORE_EVIDENCE", rationale: "Need context" }, "REVIEWER")).json().finding.requiresHumanReview).toBe(true);
  expect((await call("POST", `/assessments/${assessmentId}/findings`, { controlId, status: "PARTIAL" })).statusCode).toBe(200);
  expect((await call("POST", url, { decision: "ACCEPT", rationale: "Context reviewed" }, "REVIEWER")).json().finding.status).toBe("PARTIAL");
  expect((await prisma.reviewDecision.findMany({ where: { findingId: finding.id }, orderBy: { createdAt: "asc" } })).map(row => row.rationale)).toEqual(["Need context", "Context reviewed"]);
});
it.each(["legacy-proposal", "legacy-review", "governance-review", "governance-update"])("rolls back partial governance state on audit failure: %s", async operation => {
  const { assessmentId, finding } = await proposal();
  const governance = await governanceFinding();
  const a = await assessment();
  auditFailure = true;
  let response;
  try {
    response = operation === "legacy-proposal" ? await call("POST", `/assessments/${a.id}/findings`, { controlId, status: "FAIL" }) : operation === "legacy-review" ? await call("POST", `/assessments/${assessmentId}/findings/${finding.id}/review`, { decision: "ACCEPT", rationale: "Rollback" }, "REVIEWER") : operation === "governance-review" ? await call("POST", `/governance-findings/${governance.id}/review`, { decision: "CONFIRM", rationale: "Rollback" }, "REVIEWER") : await call("PATCH", `/governance-findings/${governance.id}`, { title: "Rollback" }, "ADMIN");
  } finally { auditFailure = false; }
  expect(response.statusCode).toBe(500);
  expect(await prisma.controlFinding.count({ where: { assessmentId: a.id } })).toBe(0);
  expect(await prisma.reviewDecision.count({ where: { findingId: finding.id } })).toBe(0);
  expect((await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } })).requiresHumanReview).toBe(true);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: governance.id } })).toEqual(governance);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: governance.id } })).toBe(0);
});
it.each(["", " ", null, {}, 42])("rejects invalid rationale %j without history", async rationale => {
  const { assessmentId, finding } = await proposal();
  expect((await call("POST", `/assessments/${assessmentId}/findings/${finding.id}/review`, { decision: "ACCEPT", rationale }, "REVIEWER")).statusCode).toBe(400);
  expect(await prisma.reviewDecision.count({ where: { findingId: finding.id } })).toBe(0);
});
it.each([false, [], "text", { controlId: ["x"], status: "PASS" }, { controlId: "x", status: {} }])("challenges proposal validation with %j", async body => {
  const a = await assessment();
  expect((await call("POST", `/assessments/${a.id}/findings`, body)).statusCode).toBe(400);
  expect(await prisma.controlFinding.count({ where: { assessmentId: a.id } })).toBe(0);
});
it.each([{}, [], 42])("rejects malformed reconciliation rationale %j", async rationale => {
  expect((await call("POST", `/assessments/${randomUUID()}/findings/${randomUUID()}/reconcile`, { rationale, proposedStatus: "PASS" })).statusCode).toBe(400);
});
it("returns not found for valid reconciliation input referencing missing records", async () => {
  expect((await call("POST", `/assessments/${randomUUID()}/findings/${randomUUID()}/reconcile`, { rationale: "Valid rationale", proposedStatus: "PASS" })).statusCode).toBe(404);
});
it("allows exactly one concurrent independent final review", async () => {
  const { assessmentId, finding } = await proposal();
  const url = `/assessments/${assessmentId}/findings/${finding.id}/review`;
  const responses = await Promise.all([call("POST", url, { decision: "ACCEPT", rationale: "Reviewer decision" }, "REVIEWER"), call("POST", url, { decision: "OVERRIDE", rationale: "Admin decision", finalStatus: "PARTIAL" }, "ADMIN")]);
  expect(responses.map(response => response.statusCode).sort()).toEqual([200, 409]);
  expect(await prisma.reviewDecision.count({ where: { findingId: finding.id } })).toBe(1);
});
it("deduplicates simultaneous proposals and never treats a proposal as a final decision", async () => {
  const a = await assessment();
  const responses = await Promise.all([call("POST", `/assessments/${a.id}/findings`, { controlId, status: "PASS", role: "ADMIN" }), call("POST", `/assessments/${a.id}/findings`, { controlId, status: "FAIL" })]);
  expect(responses.map(response => response.statusCode)).toEqual([200, 200]);
  expect(responses[0]!.json().id).toBe(responses[1]!.json().id);
  expect(await prisma.controlFinding.count({ where: { assessmentId: a.id } })).toBe(1);
  expect(responses[1]!.json()).toMatchObject({ requiresHumanReview: true, status: "INSUFFICIENT_EVIDENCE" });
});
it("keeps later advisory analysis from overwriting a final human decision", async () => {
  const { assessmentId, finding } = await proposal();
  const url = `/assessments/${assessmentId}/findings/${finding.id}/review`;
  expect((await call("POST", url, { decision: "OVERRIDE", rationale: "Human override", finalStatus: "PARTIAL" }, "REVIEWER")).statusCode).toBe(200);
  const before = await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } });
  await expect(proposeLegacyFinding(getSessionFromCookie(cookies.ANALYST)!, assessmentId, controlId, "PASS", undefined, { confidence: 1, gaps: [], recommendations: ["Advisory only"] })).rejects.toMatchObject({ statusCode: 409 });
  expect(await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } })).toEqual(before);
});
it("fails closed for missing/direct foreign IDs and exposes no review-history mutation routes", async () => {
  const finding = await governanceFinding();
  expect((await call("POST", `/governance-findings/${finding.id}/review`, { decision: "CONFIRM", rationale: "Independent" }, "REVIEWER")).statusCode).toBe(200);
  const history = await prisma.governanceFindingReview.findMany({ where: { findingId: finding.id } });
  expect(history).toHaveLength(1);
  expect((await call("GET", `/governance-findings/${finding.id}`, undefined, "FOREIGN")).statusCode).toBe(404);
  expect((await call("PATCH", `/governance-finding-reviews/${history[0]!.id}`, { rationale: "Overwrite" }, "ADMIN")).statusCode).toBe(404);
  expect((await call("DELETE", `/governance-finding-reviews/${history[0]!.id}`, undefined, "ADMIN")).statusCode).toBe(404);
  expect(await prisma.governanceFindingReview.findMany({ where: { findingId: finding.id } })).toEqual(history);
  for (const id of ["invalid-id", randomUUID(), encodeURIComponent("' OR 1=1 --")]) {
    expect((await call("GET", `/governance-findings/${id}`, undefined, "REVIEWER")).statusCode).toBe(404);
    expect((await call("POST", `/governance-findings/${id}/review`, { decision: "CONFIRM", rationale: "Missing" }, "REVIEWER")).statusCode).toBe(404);
  }
});
