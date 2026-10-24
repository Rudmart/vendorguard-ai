import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it as test, expect } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

const tenants: string[] = [], users: string[] = [];
const cookies: Record<string, string> = {};
let vendorId: string, controlId: string, systemId: string, mappedId: string, ip = 0;
let failModel = "";
const pending = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  void p.then(() => pending.delete(p), () => pending.delete(p));
  return p;
}
function it(name: string, body: () => Promise<void>) { test(name, () => track(Promise.resolve().then(body))); }
async function drain() { while (pending.size) await Promise.allSettled([...pending]); }
beforeEach(drain);
afterEach(async () => { await drain(); failModel = ""; });
function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "REVIEWER") {
  return track(Promise.resolve(server.inject({ method, url,
    cookies: role === "NONE" ? {} : { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.196.${Math.floor(++ip / 250)}.${ip % 250}`,
  })));
}
async function legacy(proposer = users[1]!, starter = users[1]!, tenantId = tenants[0]!) {
  const vendor = tenantId === tenants[0] ? vendorId : (await prisma.vendor.create({ data: { tenantId, legalName: "Disposable foreign", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } })).id;
  const assessment = await prisma.assessment.create({ data: { tenantId, vendorId: vendor, scoringModelVersion: "section16", startedByUserId: starter } });
  const finding = await prisma.controlFinding.create({ data: { tenantId, vendorId: vendor, assessmentId: assessment.id, controlId, status: "INSUFFICIENT_EVIDENCE", proposedStatus: "FAIL", proposedByUserId: proposer || null, requiresHumanReview: true } });
  return { finding, url: `/assessments/${assessment.id}/findings/${finding.id}/review` };
}
async function finding(creator = users[1]!) {
  return prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Section16 finding", description: "Disposable", severity: "HIGH", createdByUserId: creator } });
}
async function remediation(owner = users[1]!) {
  const parent = await finding();
  await prisma.governanceFinding.update({ where: { id: parent.id }, data: { status: "OPEN" } });
  const rem = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, governanceFindingId: parent.id, title: "Section16 remediation", description: "Disposable", ownerUserId: owner, status: "PENDING_VERIFICATION" } });
  return { parent, rem };
}
async function evidence() {
  // Queue/decision fixture only: no blob upload, download or legitimate evidence mutation.
  const response = await call("POST", `/ai-systems/${systemId}/evidence`, { displayFilename: "Section16 disposable metadata", documentType: "Policy" }, "ANALYST");
  expect(response.statusCode).toBe(201);
  const link = await call("POST", `/ai-system-controls/${mappedId}/evidence`, { evidenceDocumentId: response.json().id }, "ANALYST");
  expect(link.statusCode).toBe(201);
  return link.json() as { id: string };
}
async function useCase() {
  return prisma.aiUseCase.create({ data: { tenantId: tenants[0]!, aiSystemId: systemId, name: "Section16 review", businessPurpose: "Disposable", affectedParties: [], createdByUserId: users[1]!, ownerUserId: users[1]!, status: "PENDING_REVIEW" } });
}
async function queue(role = "REVIEWER") { const res = await call("GET", "/reviews/pending", undefined, role); expect(res.statusCode).toBe(200); return res.json().items as Array<{ id: string; href: string; type: string }>; }
async function vendorQueue(role = "REVIEWER") { const res = await call("GET", "/reviews/findings", undefined, role); expect(res.statusCode).toBe(200); return res.json().findings as Array<{ id: string; assessment: { id: string } }>; }
beforeAll(async () => {
  for (const label of ["A", "B"]) tenants.push((await prisma.tenant.create({ data: { name: `Section16 reviews ${label}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section16.example.test`, displayName: role } });
    users.push(user.id);
    const tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!;
    const actualRole = role === "FOREIGN" ? "ADMIN" : role;
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, role: actualRole, email: user.email, displayName: role });
  }
  vendorId = (await prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section16 disposable", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } })).id;
  controlId = (await prisma.control.findFirstOrThrow({ where: { frameworkVersion: { isCurrent: true, framework: { tenantId: null } } } })).id;
  systemId = (await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: "Section16 system", origin: "INTERNAL" } })).id;
  const control = await prisma.control.findUniqueOrThrow({ where: { id: controlId }, include: { frameworkVersion: true } });
  const applicability = await prisma.aiSystemFrameworkApplicability.create({ data: { tenantId: tenants[0]!, aiSystemId: systemId, frameworkId: control.frameworkVersion.frameworkId, status: "APPLICABLE", rationale: "Disposable review context", determinedAt: new Date() } });
  mappedId = (await prisma.aiSystemControl.create({ data: { tenantId: tenants[0]!, aiSystemId: systemId, controlId, sourceApplicabilityId: applicability.id, applicability: "APPLICABLE" } })).id;
  databaseClient.$use(async (params, next) => {
    if (failModel && params.model === failModel && params.action === "create" && params.args?.data?.tenantId === tenants[0]) throw new Error("Disposable Section16 persistence failure");
    return next(params);
  });
});
afterAll(async () => {
  await drain(); failModel = "";
  const where = { tenantId: { in: tenants } };
  await prisma.remediationVerification.deleteMany({ where });
  await prisma.remediationAction.deleteMany({ where });
  await prisma.governanceFindingReview.deleteMany({ where });
  await prisma.governanceFinding.deleteMany({ where });
  await prisma.reviewDecision.deleteMany({ where });
  await prisma.controlFinding.deleteMany({ where });
  await prisma.aiControlEvidenceReview.deleteMany({ where });
  await prisma.aiSystemControlEvidence.deleteMany({ where });
  await prisma.evidenceDocument.deleteMany({ where });
  await prisma.riskAcceptance.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

it("requires authentication for both queues", async () => {
  for (const url of ["/reviews/pending", "/reviews/findings"]) expect((await call("GET", url, undefined, "NONE")).statusCode).toBe(401);
});
it("excludes the vendor proposer and assessment initiator from their own queue", async () => {
  const own = await legacy(users[2]!, users[1]!);
  const started = await legacy(users[1]!, users[2]!);
  for (const row of [own, started]) {
    expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Self review" })).statusCode).toBe(403);
    expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
  }
});
it("excludes unattributed legacy records until explicit human reconciliation", async () => {
  const row = await legacy("");
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Unknown proposer" })).statusCode).toBe(409);
  expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
  expect((await call("POST", row.url.replace("/review", "/reconcile"), { proposedStatus: "PARTIAL", rationale: "New attributed proposal only" }, "ANALYST")).statusCode).toBe(200);
  expect((await vendorQueue()).map(x => x.id)).toContain(row.finding.id);
});
it("keeps remediation return actions available when a non-open parent blocks verification", async () => {
  const { parent, rem } = await remediation();
  await prisma.governanceFinding.update({ where: { id: parent.id }, data: { status: "DISMISSED" } });
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale: "Invalid parent" })).statusCode).toBe(409);
  expect((await queue()).map(x => x.id)).toContain(rem.id);
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "REJECTED", rationale: "Return invalid closure for correction" })).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).not.toContain(rem.id);
});
for (const decision of ["ACCEPT", "REJECT", "OVERRIDE", "NOT_APPLICABLE"]) it(`removes finalized vendor ${decision} from the queue and attributes the decision`, async () => {
  const row = await legacy();
  const queued = (await vendorQueue()).find(x => x.id === row.finding.id);
  expect(queued?.assessment.id).toBe(row.finding.assessmentId);
  const start = Date.now();
  expect((await call("POST", row.url, { decision, rationale: `Human ${decision}`, ...(decision === "OVERRIDE" ? { finalStatus: "PARTIAL" } : {}) })).statusCode).toBe(200);
  expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
  const saved = await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id } });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ reviewerUserId: users[2], rationale: `Human ${decision}`, decision });
  expect(saved[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(start);
  expect(saved[0]!.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  expect(await prisma.auditEvent.findFirst({ where: { targetId: row.finding.id, action: "legacy_finding.review_recorded", actorUserId: users[2], correlationId: saved[0]!.correlationId } })).not.toBeNull();
  expect((await call("POST", row.url, { decision: "OVERRIDE", rationale: "Stale screen" }, "ADMIN")).statusCode).toBe(409);
  expect(await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id } })).toEqual(saved);
});
it("keeps returned vendor work pending and preserves both review rationales", async () => {
  const row = await legacy();
  expect((await call("POST", row.url, { decision: "REQUEST_MORE_EVIDENCE", rationale: "Need source evidence" })).statusCode).toBe(200);
  expect((await vendorQueue()).map(x => x.id)).toContain(row.finding.id);
  expect((await call("POST", row.url.replace(/\/findings\/.*$/, "/findings"), { controlId, status: "PARTIAL" }, "ANALYST")).statusCode).toBe(200);
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Revised source reviewed" })).statusCode).toBe(200);
  expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
  expect((await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id }, orderBy: { createdAt: "asc" } })).map(x => x.rationale)).toEqual(["Need source evidence", "Revised source reviewed"]);
});
for (const role of ["ANALYST", "AUDITOR", "READ_ONLY"]) it(`denies vendor decisions and queue access to ${role}`, async () => {
  const row = await legacy();
  expect((await call("GET", "/reviews/findings", undefined, role)).statusCode).toBe(403);
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Forbidden" }, role)).statusCode).toBe(403);
  if (role !== "AUDITOR") expect(await queue(role)).toEqual([]);
  expect(await prisma.reviewDecision.count({ where: { findingId: row.finding.id } })).toBe(0);
});
it("denies foreign direct IDs and ignores forged query tenant/role fields", async () => {
  const row = await legacy(users[5]!, users[5]!, tenants[1]!);
  expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Foreign", tenantId: tenants[1], role: "ADMIN" })).statusCode).toBe(404);
  expect((await call("GET", `/reviews/findings?tenantId=${tenants[1]}&role=ADMIN`)).json().findings.map((x: {id: string}) => x.id)).not.toContain(row.finding.id);
  expect(await prisma.reviewDecision.count({ where: { findingId: row.finding.id } })).toBe(0);
});
for (const body of [null, 42, [], { decision: {} , rationale: "Valid" }, { decision: "INVALID", rationale: "Valid" }, { decision: "ACCEPT", rationale: "  " }, { decision: "ACCEPT", rationale: {} }, { decision: "ACCEPT", rationale: 42 }]) it(`rejects malformed vendor decision ${JSON.stringify(body)} without changing the queue`, async () => {
  const row = await legacy();
  expect((await call("POST", row.url, body)).statusCode).toBe(400);
  expect((await vendorQueue()).map(x => x.id)).toContain(row.finding.id);
  expect(await prisma.controlFinding.findUniqueOrThrow({ where: { id: row.finding.id } })).toEqual(row.finding);
  expect(await prisma.reviewDecision.count({ where: { findingId: row.finding.id } })).toBe(0);
});
it("serializes concurrent final vendor decisions without overwriting the winner", async () => {
  const row = await legacy();
  const responses = await Promise.all([call("POST", row.url, { decision: "ACCEPT", rationale: "First human" }), call("POST", row.url, { decision: "REJECT", rationale: "Second human" }, "ADMIN")]);
  expect(responses.map(x => x.statusCode).sort()).toEqual([200, 409]);
  const history = await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id } });
  expect(history).toHaveLength(1);
  const winner = responses.findIndex(x => x.statusCode === 200);
  expect(history[0]!.reviewerUserId).toBe(users[winner === 0 ? 2 : 0]);
  expect((await vendorQueue()).map(x => x.id)).not.toContain(row.finding.id);
});
for (const model of ["AuditEvent", "ReviewDecision"]) it(`rolls back vendor decisions on ${model} failure and retains queue entry`, async () => {
  const row = await legacy(); failModel = model;
  const result = await call("POST", row.url, { decision: "ACCEPT", rationale: "Must be atomic" }); failModel = "";
  expect(result.statusCode).toBe(500);
  expect(result.body).not.toMatch(/Prisma|stack|Disposable Section16/);
  expect(await prisma.controlFinding.findUniqueOrThrow({ where: { id: row.finding.id } })).toEqual(row.finding);
  expect(await prisma.reviewDecision.count({ where: { findingId: row.finding.id } })).toBe(0);
  expect(await prisma.auditEvent.count({ where: { targetId: row.finding.id, action: "legacy_finding.review_recorded" } })).toBe(0);
  expect((await vendorQueue()).map(x => x.id)).toContain(row.finding.id);
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Safe retry after rollback" })).statusCode).toBe(200);
});
for (const decision of ["CONFIRM", "DISMISS"]) it(`updates AI finding queue only after independent ${decision}`, async () => {
  const row = await finding(users[2]!);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
  const item = (await queue("ADMIN")).find(x => x.id === row.id);
  expect(item).toMatchObject({ href: "/findings", type: "FINDING_REVIEW" });
  expect((await call("GET", `/governance-findings/${row.id}`, undefined, "ADMIN")).json().id).toBe(row.id);
  expect((await call("POST", `/governance-findings/${row.id}/review`, { decision, rationale: "Self" })).statusCode).toBe(403);
  expect((await call("POST", `/governance-findings/${row.id}/review`, { decision, rationale: "Independent" }, "ADMIN")).statusCode).toBe(200);
  expect((await queue("ADMIN")).map(x => x.id)).not.toContain(row.id);
  expect(await prisma.governanceFindingReview.findFirst({ where: { findingId: row.id } })).toMatchObject({ reviewerUserId: users[0], decision, rationale: "Independent" });
});
for (const model of ["AuditEvent", "GovernanceFindingReview"]) it(`keeps failed AI finding decision queued after ${model} failure`, async () => {
  const row = await finding(); failModel = model;
  const res = await call("POST", `/governance-findings/${row.id}/review`, { decision: "CONFIRM", rationale: "Atomic" }); failModel = "";
  expect(res.statusCode).toBe(500);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: row.id } })).toBe(0);
  expect((await queue()).map(x => x.id)).toContain(row.id);
});
it("updates remediation queues through rejection, resubmission and independent completion", async () => {
  const { rem } = await remediation(users[2]!);
  const url = `/governance-remediations/${rem.id}`;
  expect((await queue()).map(x => x.id)).not.toContain(rem.id);
  expect((await queue("AUDITOR")).find(x => x.id === rem.id)).toMatchObject({ href: "/remediation" });
  expect((await call("POST", `${url}/verify`, { decision: "VERIFIED", rationale: "Self" })).statusCode).toBe(403);
  expect((await call("POST", `${url}/verify`, { decision: "REJECTED", rationale: "More work" }, "AUDITOR")).statusCode).toBe(200);
  expect((await queue("AUDITOR")).map(x => x.id)).not.toContain(rem.id);
  expect((await call("POST", `${url}/submit`, undefined, "REVIEWER")).statusCode).toBe(200);
  expect((await queue("AUDITOR")).map(x => x.id)).toContain(rem.id);
  expect((await call("POST", `${url}/verify`, { decision: "VERIFIED", rationale: "Work verified" }, "AUDITOR")).statusCode).toBe(200);
  expect((await queue("AUDITOR")).map(x => x.id)).not.toContain(rem.id);
  expect((await prisma.remediationVerification.findMany({ where: { remediationId: rem.id }, orderBy: { createdAt: "asc" } })).map(x => x.rationale)).toEqual(["More work", "Work verified"]);
});
for (const model of ["AuditEvent", "RemediationVerification"]) it(`retains remediation queue after ${model} failure`, async () => {
  const { rem } = await remediation(); failModel = model;
  const res = await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale: "Atomic" }); failModel = "";
  expect(res.statusCode).toBe(500);
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } })).toEqual(rem);
  expect(await prisma.remediationVerification.count({ where: { remediationId: rem.id } })).toBe(0);
  expect((await queue()).map(x => x.id)).toContain(rem.id);
});
for (const role of ["ANALYST", "AUDITOR", "READ_ONLY", "FOREIGN"]) it(`denies AI finding review by ${role} without losing its queue entry`, async () => {
  const row = await finding();
  expect((await call("POST", `/governance-findings/${row.id}/review`, { decision: "CONFIRM", rationale: "Denied" }, role)).statusCode).toBe(role === "FOREIGN" ? 404 : 403);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  expect((await queue()).map(x => x.id)).toContain(row.id);
  if (role === "FOREIGN") expect((await queue(role)).map(x => x.id)).not.toContain(row.id);
});
it("serializes concurrent AI finding decisions and rejects stale history edits", async () => {
  const row = await finding(), url = `/governance-findings/${row.id}`;
  const responses = await Promise.all([call("POST", `${url}/review`, { decision: "CONFIRM", rationale: "First human" }), call("POST", `${url}/review`, { decision: "DISMISS", rationale: "Second human" }, "ADMIN")]);
  expect(responses.map(x => x.statusCode).sort()).toEqual([200, 409]);
  const history = await prisma.governanceFindingReview.findMany({ where: { findingId: row.id } });
  expect(history).toHaveLength(1);
  for (const method of ["PATCH", "DELETE"] as const) expect((await call(method, `${url}/reviews/${history[0]!.id}`, { rationale: "Overwrite" }, "ADMIN")).statusCode).toBe(404);
  expect((await call("POST", `${url}/review`, { decision: "CONFIRM", rationale: "Stale" }, "ADMIN")).statusCode).toBe(409);
  expect(await prisma.governanceFindingReview.findMany({ where: { findingId: row.id } })).toEqual(history);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
});
for (const body of [null, 42, { decision: "INVALID", rationale: "Valid" }, { decision: "CONFIRM", rationale: "  " }, { decision: "CONFIRM", rationale: {} }]) it(`keeps malformed AI finding decision ${JSON.stringify(body)} queued`, async () => {
  const row = await finding();
  expect((await call("POST", `/governance-findings/${row.id}/review`, body)).statusCode).toBe(400);
  expect((await queue()).map(x => x.id)).toContain(row.id);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: row.id } })).toBe(0);
});
for (const id of ["invalid-id", randomUUID()]) it(`denies nonexistent vendor and AI review IDs ${id}`, async () => {
  expect((await call("POST", `/assessments/${id}/findings/${id}/review`, { decision: "ACCEPT", rationale: "Missing" })).statusCode).toBe(404);
  expect((await call("POST", `/governance-findings/${id}/review`, { decision: "CONFIRM", rationale: "Missing" })).statusCode).toBe(404);
});
it("keeps vendor decision history protected from direct API mutation", async () => {
  const row = await legacy();
  expect((await call("POST", row.url, { decision: "ACCEPT", rationale: "Original" })).statusCode).toBe(200);
  const history = await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id } });
  for (const method of ["PATCH", "DELETE"] as const) expect((await call(method, row.url.replace("/review", `/reviews/${history[0]!.id}`), { rationale: "Overwrite" }, "ADMIN")).statusCode).toBe(404);
  expect(await prisma.reviewDecision.findMany({ where: { findingId: row.finding.id } })).toEqual(history);
});
for (const kind of ["risk", "impact"] as const) it(`tracks ${kind} assessment return, resubmission and final review in the queue`, async () => {
  const data = { tenantId: tenants[0]!, aiSystemId: systemId, noItemsJustification: "Assessor recorded no items in this queue test scope", name: "Section16 queue assessment", version: 1, status: "READY_FOR_REVIEW" as const, assessorUserId: users[1]! };
  const row = kind === "risk" ? await prisma.aiRiskAssessment.create({ data }) : await prisma.aiImpactAssessment.create({ data });
  const url = `/ai-${kind}-assessments/${row.id}`;
  expect((await queue()).find(x => x.id === row.id)).toMatchObject({ href: url });
  expect((await call("GET", url)).json().id).toBe(row.id);
  expect((await call("POST", `${url}/review`, { decision: "APPROVED", rationale: "Self" }, "ANALYST")).statusCode).toBe(403);
  expect((await call("POST", `${url}/review`, { decision: "CHANGES_REQUESTED", rationale: "First independent review" })).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
  expect((await call("PATCH", url, { status: "READY_FOR_REVIEW" }, "ANALYST")).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).toContain(row.id);
  expect((await call("POST", `${url}/review`, { decision: "APPROVED", rationale: "Second independent review" }, "ADMIN")).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
  expect((await call("POST", `${url}/review`, { decision: "REJECTED", rationale: "Stale" })).statusCode).toBe(409);
  const history = await prisma.governanceDecision.findMany({ where: { tenantId: tenants[0], ...(kind === "risk" ? { riskAssessmentId: row.id } : { impactAssessmentId: row.id }) }, orderBy: { createdAt: "asc" } });
  expect(history.map(x => x.rationale)).toEqual(["First independent review", "Second independent review"]);
  expect(history.map(x => x.actorUserId)).toEqual([users[2], users[0]]);
  expect(history.every(x => x.version === 1 && x.correlationId)).toBe(true);
});
for (const [index, model] of ["AuditEvent", "GovernanceDecision"].entries()) for (const kind of ["risk", "impact"] as const) it(`keeps ${kind} assessment queued on ${model} failure`, async () => {
  const data = { tenantId: tenants[0]!, aiSystemId: systemId, noItemsJustification: "Assessor recorded no items in this audit rollback test scope", name: "Section16 atomic decision", version: index + 2, status: "READY_FOR_REVIEW" as const, assessorUserId: users[1]! };
  const row = kind === "risk" ? await prisma.aiRiskAssessment.create({ data }) : await prisma.aiImpactAssessment.create({ data });
  failModel = model;
  const res = await call("POST", `/ai-${kind}-assessments/${row.id}/review`, { decision: "APPROVED", rationale: "Atomic review" }); failModel = "";
  expect(res.statusCode).toBe(500);
  const current = kind === "risk" ? await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: row.id } }) : await prisma.aiImpactAssessment.findUniqueOrThrow({ where: { id: row.id } });
  expect(current).toEqual(row);
  expect((await queue()).map(x => x.id)).toContain(row.id);
  expect(await prisma.governanceDecision.count({ where: { tenantId: tenants[0], ...(kind === "risk" ? { riskAssessmentId: row.id } : { impactAssessmentId: row.id }) } })).toBe(0);
});
for (const decision of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"]) it(`persists independent use-case ${decision} and rejects a stale repeat`, async () => {
  const row = await useCase(), url = `/ai-use-cases/${row.id}/review`;
  expect((await call("POST", url, { decision, rationale: "Own work" }, "ANALYST")).statusCode).toBe(403);
  expect((await call("POST", url, { decision, rationale: "Independent use-case review" })).statusCode).toBe(200);
  expect((await call("POST", url, { decision, rationale: "Stale repeat" }, "ADMIN")).statusCode).toBe(409);
  const saved = await prisma.governanceDecision.findMany({ where: { useCaseId: row.id } });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ actorUserId: users[2], decision, rationale: "Independent use-case review" });
});
for (const model of ["AuditEvent", "GovernanceDecision"]) it(`keeps use-case pending after ${model} failure`, async () => {
  const row = await useCase(); failModel = model;
  const res = await call("POST", `/ai-use-cases/${row.id}/review`, { decision: "APPROVED", rationale: "Atomic review" }); failModel = "";
  expect(res.statusCode).toBe(500);
  expect(await prisma.aiUseCase.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  expect(await prisma.governanceDecision.count({ where: { useCaseId: row.id } })).toBe(0);
});
for (const decision of ["ACCEPT", "REJECT"]) it(`updates evidence queue after independent ${decision} and preserves history`, async () => {
  const row = await evidence(), url = `/ai-control-evidence/${row.id}`;
  expect((await queue()).find(x => x.id === row.id)).toMatchObject({ href: `/ai-system-controls/${mappedId}/evidence` });
  expect((await call("GET", `/ai-system-controls/${mappedId}/evidence`)).statusCode).toBe(200);
  expect((await queue("ANALYST")).map(x => x.id)).not.toContain(row.id);
  expect((await call("POST", `${url}/review`, { decision, rationale: "Independent source review" })).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
  expect((await call("POST", `${url}/review`, { decision, rationale: "Stale repeat" }, "ADMIN")).statusCode).toBe(409);
  const saved = await prisma.aiControlEvidenceReview.findMany({ where: { linkId: row.id } });
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ reviewerUserId: users[2], decision, rationale: "Independent source review" });
  if (decision === "REJECT") {
    expect((await call("POST", `${url}/resubmit`, { submissionNote: "Corrected context" }, "ANALYST")).statusCode).toBe(200);
    expect((await queue()).map(x => x.id)).toContain(row.id);
    expect(await prisma.aiControlEvidenceReview.findMany({ where: { linkId: row.id } })).toEqual(saved);
  }
});
for (const model of ["AuditEvent", "AiControlEvidenceReview"]) it(`retains evidence queue after ${model} failure`, async () => {
  const row = await evidence(); failModel = model;
  const res = await call("POST", `/ai-control-evidence/${row.id}/review`, { decision: "ACCEPT", rationale: "Atomic review" }); failModel = "";
  expect(res.statusCode).toBe(500);
  expect((await queue()).map(x => x.id)).toContain(row.id);
  expect(await prisma.aiControlEvidenceReview.count({ where: { linkId: row.id } })).toBe(0);
});
for (const decision of ["APPROVE", "REJECT"]) it(`removes independently decided risk acceptance ${decision} from the queue`, async () => {
  const assessment = await prisma.aiRiskAssessment.create({ data: { tenantId: tenants[0]!, aiSystemId: systemId, name: "Acceptance queue context", version: decision === "APPROVE" ? 10 : 11, status: "COMPLETED", assessorUserId: users[1]! } });
  const risk = await prisma.aiRisk.create({ data: { tenantId: tenants[0]!, assessmentId: assessment.id, title: "Disposable risk", statement: "Test", category: "OPERATIONAL", likelihood: 2, impact: 2, inherentScore: 4, inherentRating: "LOW" } });
  const row = await prisma.riskAcceptance.create({ data: { tenantId: tenants[0]!, aiRiskId: risk.id, requestedByUserId: users[0]!, justification: "Disposable request", status: "PENDING_REVIEW", expiresAt: new Date(Date.now() + 86400000) } });
  expect((await queue()).find(x => x.id === row.id)).toMatchObject({ href: `/risk-acceptance/${risk.id}` });
  expect((await queue("ADMIN")).map(x => x.id)).not.toContain(row.id);
  expect((await call("POST", `/risk-acceptances/${row.id}/decision`, { decision, rationale: "Self decision" }, "ADMIN")).statusCode).toBe(403);
  expect((await call("POST", `/risk-acceptances/${row.id}/decision`, { decision, rationale: "Independent risk decision" })).statusCode).toBe(200);
  expect((await queue()).map(x => x.id)).not.toContain(row.id);
  expect((await call("POST", `/risk-acceptances/${row.id}/decision`, { decision, rationale: "Stale repeat" })).statusCode).toBe(409);
  expect(await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ decidedByUserId: users[2], decisionRationale: "Independent risk decision" });
});
