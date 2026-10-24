import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let tenantId: string, systemId: string;
const users: string[] = [], cookies: string[] = [];
let number = 0;
let failAudit = "";
databaseClient.$use(async (params, next) => {
  if (params.model === "AuditEvent" && params.action === "create" && params.args.data.action === failAudit) throw new Error("Injected lifecycle audit failure");
  return next(params);
});
async function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, actor = 0) {
  return server.inject({ method, url, payload: payload === undefined ? undefined : JSON.stringify(payload), headers: { "content-type": "application/json" }, remoteAddress: `10.211.${Math.floor(++number / 250)}.${number % 250}`, cookies: { vg_session: cookies[actor]! } });
}
beforeAll(async () => {
  await server.ready();
  tenantId = (await prisma.tenant.create({ data: { name: "Lifecycle correction regression" } })).id;
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "READ_ONLY", "AUDITOR"] as const) {
    const key = randomUUID();
    const user = await prisma.user.create({ data: { externalId: key, email: `${key}@lifecycle.example.test`, displayName: role } });
    users.push(user.id);
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role } });
    cookies.push(await issueTestSessionCookie({ userId: user.id, tenantId, role, email: user.email, displayName: role }));
  }
  systemId = (await prisma.aiSystem.create({ data: { tenantId, name: "Lifecycle parent", origin: "INTERNAL", ownerUserId: users[1] } })).id;
});
afterAll(async () => {
  if (tenantId) {
    await prisma.riskAcceptance.deleteMany({ where: { tenantId } });
    await prisma.governanceFinding.deleteMany({ where: { tenantId } });
    await prisma.aiControlTest.deleteMany({ where: { tenantId } });
    await prisma.aiSystemControl.deleteMany({ where: { tenantId } });
    await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
  if (frameworkIds.length) await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});
it("does not let an ordinary inventory update assert APPROVED or PRODUCTION without independent approval", async () => {
  for (const lifecycleStatus of ["APPROVED", "PRODUCTION"]) {
    expect((await call("PATCH", `/ai-systems/${systemId}`, { lifecycleStatus }, 1)).statusCode).toBe(409);
    expect((await prisma.aiSystem.findUniqueOrThrow({ where: { id: systemId } })).lifecycleStatus).toBe("PROPOSED");
  }
});
for (const kind of ["risk", "impact"] as const) {
  it(`${kind} review cannot approve an unsubmitted draft`, async () => {
    const data = { tenantId, aiSystemId: systemId, name: "Unsubmitted draft", version: 1, assessorUserId: users[1]! };
    const row = kind === "risk" ? await prisma.aiRiskAssessment.create({ data }) : await prisma.aiImpactAssessment.create({ data });
    const res = await call("POST", `/ai-${kind}-assessments/${row.id}/review`, { decision: "APPROVED", rationale: "Independent review" }, 2);
    expect(res.statusCode).toBe(409);
    const stored = kind === "risk" ? await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: row.id } }) : await prisma.aiImpactAssessment.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.status).toBe("DRAFT");
  });
}
it("includes independently reviewable use cases and excludes creator, owner, ownerless and nonpending cases", async () => {
  const rows = [];
  for (const [status, creator, owner] of [["PENDING_REVIEW", 1, 0], ["DRAFT", 1, 0], ["APPROVED", 1, 0], ["PENDING_REVIEW", 2, 0], ["PENDING_REVIEW", 1, 2], ["PENDING_REVIEW", 1, -1]] as const) {
    rows.push(await prisma.aiUseCase.create({ data: { tenantId, aiSystemId: systemId, name: "Queue case", businessPurpose: "Independent decision", affectedParties: [], status, createdByUserId: users[creator]!, ownerUserId: owner < 0 ? null : users[owner]! } }));
  }
  try {
    const result = await call("GET", "/reviews/pending", undefined, 2);
    const items = result.json().items.filter((r: { type: string }) => r.type === "AI_USE_CASE_REVIEW");
    expect(items.map((r: { id: string }) => r.id)).toEqual([rows[0]!.id]);
    expect(items[0].href).toBe(`/ai-use-cases/${rows[0]!.id}`);
    for (const actor of [1, 3, 4]) expect((await call("GET", "/reviews/pending", undefined, actor)).json().items.filter((r: { type: string }) => r.type === "AI_USE_CASE_REVIEW")).toEqual([]);
  } finally { await prisma.aiUseCase.deleteMany({ where: { id: { in: rows.map(r => r.id) } } }); }
});

it("system approval requests fail closed when prerequisite governance records are missing", async () => {
  const response = await call("POST", `/ai-systems/${systemId}/approval-request`, { rationale: "Request formal approval" }, 1);
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toContain("A reviewed risk assessment is required");
});
for (const kind of ["risk", "impact"] as const) it(`${kind} cannot submit an empty assessment without an assessor justification`, async () => {
  const parent = await prisma.aiSystem.create({ data: { tenantId, name: "Empty assessment parent", origin: "INTERNAL" } });
  const data = { tenantId, aiSystemId: parent.id, name: "Empty submission", version: 1, assessorUserId: users[1]! };
  const row = kind === "risk" ? await prisma.aiRiskAssessment.create({ data }) : await prisma.aiImpactAssessment.create({ data });
  expect((await call("PATCH", `/ai-${kind}-assessments/${row.id}`, { status: "READY_FOR_REVIEW" }, 1)).statusCode).toBe(400);
});

async function readySystem() {
  const row = await prisma.aiSystem.create({ data: { tenantId, name: "Ready approval fixture", origin: "INTERNAL", ownerUserId: users[1]!, businessCriticality: "HIGH", decisionRole: "ADVISORY", humanOversight: "REQUIRED", impactLevel: "HIGH", dataSensitivity: "CONFIDENTIAL" } });
  const useCase = await call("POST", `/ai-systems/${row.id}/use-cases`, { name: "Reviewed purpose", businessPurpose: "Human supervised assistance", ownerUserId: users[1], decisionRole: "ADVISORY", humanOversight: "REQUIRED" }, 1);
  expect(useCase.statusCode).toBe(201);
  expect((await call("POST", `/ai-use-cases/${useCase.json().id}/submit`, {}, 1)).statusCode).toBe(200);
  expect((await call("POST", `/ai-use-cases/${useCase.json().id}/review`, { decision: "APPROVED", rationale: "Independent purpose review" }, 2)).statusCode).toBe(200);
  for (const kind of ["risk", "impact"] as const) {
    const created = await call("POST", `/ai-systems/${row.id}/${kind}-assessments`, { name: "Explicit no-items assessment" }, 1);
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await call("PATCH", `/ai-${kind}-assessments/${id}`, { noItemsJustification: "Assessor examined the defined scope; no items were identified", status: "READY_FOR_REVIEW" }, 1)).statusCode).toBe(200);
    expect((await call("POST", `/ai-${kind}-assessments/${id}/review`, { decision: "APPROVED", rationale: "Independent challenge of no-items conclusion" }, 2)).statusCode).toBe(200);
  }
  const framework = await prisma.framework.create({ data: { catalogId: `s8-test-gate-${randomUUID()}`, name: "Gate scope", scope: "TEST", industries: ["GENERAL"] } });
  await prisma.aiSystemFrameworkApplicability.create({ data: { tenantId, aiSystemId: row.id, frameworkId: framework.id, status: "NOT_APPLICABLE", rationale: "Explicit scoped determination", determinedByUserId: users[1], determinedAt: new Date() } });
  frameworkIds.push(framework.id);
  return row.id;
}
const frameworkIds: string[] = [];
let readyId: string, approvalId: string;
it("accepts explicit assessor no-items conclusions only through submission and independent review", async () => { readyId = await readySystem(); });
it("records an approval request, correct queue handoff, and denies requester decisions", async () => {
  const response = await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "All scoped prerequisites reviewed" }, 0);
  expect(response.statusCode).toBe(201); approvalId = response.json().id;
  const items = (await call("GET", "/reviews/pending", undefined, 2)).json().items;
  expect(items.find((r: { id: string }) => r.id === approvalId).href).toBe(`/ai-systems/${readyId}#system-approval`);
  const report = await call("GET", `/reports/ai-governance?aiSystemId=${readyId}`, undefined, 2);
  expect(report.statusCode).toBe(200);
  expect(report.json().metrics.find((m: { key: string }) => m.key === "decisions.pending").value).toBe(1);

  expect((await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "APPROVED", rationale: "Self approval" }, 0)).statusCode).toBe(403);
  expect((await prisma.aiSystemApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING_REVIEW");
});
it("rejects lower-role and foreign-tenant direct approval IDs without changing the pending decision", async () => {
  for (const actor of [1, 3, 4]) expect((await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "APPROVED", rationale: "Unauthorized" }, actor)).statusCode).toBe(403);
  const foreign = await prisma.tenant.create({ data: { name: "Foreign lifecycle probe" } });
  try {
    await prisma.tenantMembership.create({ data: { tenantId: foreign.id, userId: users[2]!, role: "REVIEWER" } });
    const cookie = await issueTestSessionCookie({ tenantId: foreign.id, userId: users[2]!, role: "REVIEWER", email: "foreign@example.test", displayName: "Foreign" });
    const res = await server.inject({ method: "POST", url: `/ai-system-approvals/${approvalId}/decision`, payload: { decision: "APPROVED", rationale: "Foreign decision" }, cookies: { vg_session: cookie } });
    expect(res.statusCode).toBe(404);
    const read = await server.inject({ method: "GET", url: `/ai-systems/${readyId}/approval`, cookies: { vg_session: cookie } });
    expect(read.statusCode).toBe(404);
  } finally { await prisma.tenant.delete({ where: { id: foreign.id } }); }
});
it("rolls back system approval and its lifecycle change when required auditing fails", async () => {
  failAudit = "ai_system.approval_decided";
  try { expect((await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "APPROVED", rationale: "Audited decision" }, 2)).statusCode).toBe(500); }
  finally { failAudit = ""; }
  expect((await prisma.aiSystemApproval.findUniqueOrThrow({ where: { id: approvalId } })).status).toBe("PENDING_REVIEW");
  expect((await prisma.aiSystem.findUniqueOrThrow({ where: { id: readyId } })).lifecycleStatus).toBe("PENDING_APPROVAL");
});
it("rejects stale approval context and allows cancellation and a fresh request", async () => {
  expect((await call("PATCH", `/ai-systems/${readyId}`, { description: "Materially revised business context" }, 1)).statusCode).toBe(200);
  expect((await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "APPROVED", rationale: "Stale approval" }, 2)).statusCode).toBe(409);
  expect((await call("POST", `/ai-system-approvals/${approvalId}/cancel`, { rationale: "Resubmit changed context" }, 0)).statusCode).toBe(200);
  const res = await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "Fresh governance context" }, 0);
  expect(res.statusCode).toBe(201); approvalId = res.json().id;
});
it("preserves one independent final decision, permits production, and rejects repeat decisions", async () => {
  const response = await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "APPROVED", rationale: "Independent system-level governance approval" }, 2);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ decidedByUserId: users[2], status: "APPROVED", decisionRationale: "Independent system-level governance approval" });
  expect((await call("PATCH", `/ai-systems/${readyId}`, { lifecycleStatus: "PRODUCTION" }, 1)).statusCode).toBe(200);
  expect((await call("POST", `/ai-system-approvals/${approvalId}/decision`, { decision: "REJECTED", rationale: "Overwrite" }, 2)).statusCode).toBe(409);
  const audit = await prisma.auditEvent.findFirstOrThrow({ where: { tenantId, action: "ai_system.approval_decided", targetId: approvalId } });
  expect(audit.actorUserId).toBe(users[2]);
  await expect(prisma.aiSystemApproval.update({ where: { id: approvalId }, data: { decisionRationale: "Overwrite" } })).rejects.toThrow();
});
it("blocks production when a previously approved governance context changes", async () => {
  await prisma.aiSystem.update({ where: { id: readyId }, data: { lifecycleStatus: "APPROVED" } }); // already-approved fixture context; no new approval is fabricated
  expect((await call("PATCH", `/ai-systems/${readyId}`, { description: "Changed after approval" }, 1)).statusCode).toBe(200);
  const denied = await call("PATCH", `/ai-systems/${readyId}`, { lifecycleStatus: "PRODUCTION" }, 1);
  expect(denied.statusCode).toBe(409);
  expect(denied.json().error).toContain("current governance context");
});

it("does not accept a missing or blank no-items justification or one recorded by a different actor", async () => {
  const parent = await prisma.aiSystem.create({ data: { tenantId, name: "Justification input fixture", origin: "INTERNAL" } });
  for (const kind of ["risk", "impact"] as const) {
    const data = { tenantId, aiSystemId: parent.id, name: "Empty assessment", version: 1, assessorUserId: users[1]! };
    const row = kind === "risk" ? await prisma.aiRiskAssessment.create({ data }) : await prisma.aiImpactAssessment.create({ data });
    const url = `/ai-${kind}-assessments/${row.id}`;
    expect((await call("PATCH", url, { noItemsJustification: "Independent actor cannot invent assessor conclusion", status: "READY_FOR_REVIEW" }, 0)).statusCode).toBe(403);
    for (const value of ["   ", {}, [], 42]) expect((await call("PATCH", url, { noItemsJustification: value, status: "READY_FOR_REVIEW" }, 1)).statusCode).toBe(400);
    expect(await prisma.governanceDecision.count({ where: { tenantId, ...(kind === "risk" ? { riskAssessmentId: row.id } : { impactAssessmentId: row.id }) } })).toBe(0);
  }
});
it("requires effective control testing or an explicit active accepted exception before system approval", async () => {
  const framework = await prisma.framework.findUniqueOrThrow({ where: { id: frameworkIds[0]! } });
  const applicability = await prisma.aiSystemFrameworkApplicability.findFirstOrThrow({ where: { tenantId, aiSystemId: readyId, frameworkId: framework.id } });
  await prisma.aiSystemFrameworkApplicability.update({ where: { id: applicability.id }, data: { status: "APPLICABLE" } });
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: framework.id, version: "1" } });
  const control = await prisma.control.create({ data: { frameworkVersionId: version.id, controlId: "APPROVAL-1", title: "Assurance fixture", summary: "Fixture", domain: "Governance", expectedEvidenceTypes: [], validationGuidance: "Fixture" } });
  const mapped = await prisma.aiSystemControl.create({ data: { tenantId, aiSystemId: readyId, controlId: control.id, sourceApplicabilityId: applicability.id, applicability: "APPLICABLE", ownerUserId: users[1] } });
  let response = await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "Missing test challenge" }, 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toContain("effective completed tests");
  const test = await prisma.aiControlTest.create({ data: { tenantId, aiSystemControlId: mapped.id, testerUserId: users[2]!, status: "COMPLETED", method: "DOCUMENT_REVIEW", procedure: "Disposable control test procedure", overallEffectiveness: "INEFFECTIVE", completedAt: new Date() } });
  const finding = await prisma.governanceFinding.create({ data: { tenantId, aiControlTestId: test.id, title: "Known control exception", description: "Fixture", severity: "HIGH", status: "OPEN", createdByUserId: users[2]! } });
  response = await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "Unaccepted exception challenge" }, 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().error).toContain("HIGH/CRITICAL");
  const riskAssessment = await prisma.aiRiskAssessment.findFirstOrThrow({ where: { tenantId, aiSystemId: readyId } });
  const risk = await prisma.aiRisk.create({ data: { tenantId, assessmentId: riskAssessment.id, title: "Exception residual risk", category: "OPERATIONAL", statement: "Fixture", likelihood: 2, impact: 2, inherentScore: 4, inherentRating: "LOW", residualScore: 4, residualRating: "LOW" } });
  const acceptance = await prisma.riskAcceptance.create({ data: { tenantId, aiRiskId: risk.id, governanceFindingId: finding.id, status: "APPROVED", justification: "Explicit test exception", requestedByUserId: users[1], decidedByUserId: users[2], expiresAt: new Date(Date.now() + 86400000) } });
  response = await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "Review active explicit exception" }, 0);
  expect(response.statusCode).toBe(201);
  expect((await call("POST", `/ai-system-approvals/${response.json().id}/cancel`, { rationale: "Dispose exception fixture" }, 0)).statusCode).toBe(200);
  await prisma.riskAcceptance.update({ where: { id: acceptance.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await call("POST", `/ai-systems/${readyId}/approval-request`, { rationale: "Expired exceptions cannot authorize progression" }, 0)).statusCode).toBe(409);
});
