import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let tenant: string, foreign: string, vendor: string, assessment: string;
const users: string[] = [], cookies: string[] = [];
let ip = 0, failAction = "";
let pauseAudit: { entered: () => void; wait: Promise<void> } | null = null;
databaseClient.$use(async (params, next) => {
  if (params.model === "AuditEvent" && params.action === "create" && params.args.data.action === failAction) throw new Error("Injected vendor governance audit failure");
  if (params.model === "AuditEvent" && params.action === "create" && params.args.data.action === "vendor.risk_acceptance_decided" && pauseAudit) { pauseAudit.entered(); await pauseAudit.wait; }
  return next(params);
});
const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: object, actor = 1) => server.inject({ method, url, payload, cookies: { vg_session: cookies[actor]! }, remoteAddress: `10.214.${Math.floor(++ip / 250)}.${ip % 250}` });
const acceptance = () => ({ assessmentId: assessment, justification: "Business need with explicit conditions", residualRiskStatement: "Residual service interruption remains", expiresAt: new Date(Date.now() + 86400000).toISOString() });
beforeAll(async () => {
  await server.ready();
  tenant = (await prisma.tenant.create({ data: { name: "Pre-polish vendor governance regression" } })).id;
  foreign = (await prisma.tenant.create({ data: { name: "Foreign vendor governance regression" } })).id;
  for (const [index, role] of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "ADMIN"].entries()) {
    const user = await prisma.user.create({ data: { externalId: randomUUID(), email: `${randomUUID()}@vendor-governance.example.test`, displayName: role } }); users.push(user.id);
    const tenantId = index === 5 ? foreign : tenant;
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: role as never } });
    cookies.push(await issueTestSessionCookie({ tenantId, userId: user.id, role, email: user.email, displayName: role }));
  }
  vendor = (await prisma.vendor.create({ data: { tenantId: tenant, legalName: "Disposable governance vendor", serviceDescription: "Test", serviceCategory: "Cloud/SaaS", criticality: "HIGH" } })).id;
  assessment = (await prisma.assessment.create({ data: { tenantId: tenant, vendorId: vendor, scoringModelVersion: "risk-model-2025.1", startedByUserId: users[1]!, residualScore: 30, riskBand: "MODERATE" } })).id;
});
afterAll(async () => {
  if (tenant) await prisma.riskAcceptance.deleteMany({ where: { tenantId: tenant } });
  if (tenant && await prisma.$queryRawUnsafe<Array<{ name: string | null }>>("SELECT to_regclass('vendor_reassessments')::text AS name").then(r => r[0]?.name)) await prisma.$executeRawUnsafe('DELETE FROM vendor_reassessments WHERE "tenantId" = $1', tenant);
  for (const id of [tenant, foreign].filter(Boolean)) await prisma.tenant.delete({ where: { id } });
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});
it("creates a pending request with an authoritative snapshot and no automatic vendor/finding approval", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance());
  expect(r.statusCode).toBe(201);
  expect(r.json().riskAcceptance).toMatchObject({ status: "PENDING_REVIEW", requestedByUserId: users[1], approvedByUserId: null, vendorRiskSnapshot: { assessmentId: assessment, residualScore: 30, riskBand: "MODERATE" } });
  expect((await prisma.assessment.findUniqueOrThrow({ where: { id: assessment } })).status).toBe("DRAFT");
});
it("requires independent authorized decisions, persists attribution and rejects duplicates", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance(), 0); expect(r.statusCode).toBe(201); const id = r.json().riskAcceptance.id;
  const payload = { decision: "APPROVED", rationale: "Independent human decision" };
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, payload, 0)).statusCode).toBe(403);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenant, targetId: id, action: "vendor.risk_acceptance_denied", outcome: "DENIED" } })).toBe(1);
  for (const actor of [1, 3, 4]) expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, payload, actor)).statusCode).toBe(403);
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, payload, 5)).statusCode).toBe(404);
  const decided = await call("POST", `/vendor-risk-acceptances/${id}/decision`, payload, 2); expect(decided.statusCode).toBe(200);
  expect(decided.json().riskAcceptance).toMatchObject({ status: "APPROVED", decidedByUserId: users[2], decisionRationale: payload.rationale, approvedByUserId: users[2] });
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "REJECTED", rationale: "Overwrite" }, 2)).statusCode).toBe(409);
});
it("rejects malformed inputs, expired requests, foreign relationships and unauthorized requests", async () => {
  for (const patch of [{ justification: " " }, { residualRiskStatement: " " }, { expiresAt: "2026-02-30" }, { expiresAt: new Date(0).toISOString() }, { findingId: randomUUID() }, { assessmentId: randomUUID() }]) {
    const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, { ...acceptance(), ...patch }); expect([400, 404]).toContain(r.statusCode);
  }
  for (const actor of [3, 4]) expect((await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance(), actor)).statusCode).toBe(403);
  expect((await call("GET", `/vendors/${vendor}/risk-acceptance`, undefined, 5)).statusCode).toBe(404);
});
it("revalidates source risk and preserves the request snapshot when source data changes", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance()); expect(r.statusCode).toBe(201); const id = r.json().riskAcceptance.id;
  await prisma.assessment.update({ where: { id: assessment }, data: { residualScore: 75 } });
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "APPROVED", rationale: "Stale context" }, 2)).statusCode).toBe(409);
  expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_REVIEW");
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "REJECTED", rationale: "Refresh changed risk" }, 2)).statusCode).toBe(200);
  await prisma.assessment.update({ where: { id: assessment }, data: { residualScore: 30 } });
});
it("allows one concurrent final decision and rolls back decisions when required audit persistence fails", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance()); expect(r.statusCode).toBe(201); const id = r.json().riskAcceptance.id;
  failAction = "vendor.risk_acceptance_decided";
  try { expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "APPROVED", rationale: "Atomic decision" }, 2)).statusCode).toBe(500); } finally { failAction = ""; }
  expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING_REVIEW");
  const responses = await Promise.all([2, 0].map(actor => call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "APPROVED", rationale: "Concurrent challenge" }, actor)));
  expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenant, action: "vendor.risk_acceptance_decided", targetId: id } })).toBe(1);
});
it("starts a linked reassessment without copying scores or changing the prior assessment", async () => {
  const before = await prisma.assessment.findUniqueOrThrow({ where: { id: assessment } });
  const r = await call("POST", `/vendors/${vendor}/reassessments`, { priorAssessmentId: assessment, trigger: "MODEL_SERVICE_CHANGE", rationale: "Service model changed", materialChanges: "Different model and retention terms", targetDate: new Date(Date.now() + 86400000).toISOString() });
  expect(r.statusCode).toBe(201); const cycle = r.json().reassessment;
  expect(cycle).toMatchObject({ vendorId: vendor, priorAssessmentId: assessment, trigger: "MODEL_SERVICE_CHANGE", materialChanges: "Different model and retention terms", status: "IN_PROGRESS" });
  expect(cycle.newAssessmentId).not.toBe(assessment);
  expect((await prisma.assessment.findUniqueOrThrow({ where: { id: cycle.newAssessmentId } })).residualScore).toBeNull();
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: assessment } })).toEqual(before);
  expect((await call("POST", `/vendors/${vendor}/reassessments`, { priorAssessmentId: assessment, trigger: "SCHEDULED_REVIEW", rationale: "Duplicate", materialChanges: "No change recorded" })).statusCode).toBe(409);
  expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Cannot bypass review" }, 2)).statusCode).toBe(409);
  expect((await call("GET", `/vendors/${vendor}/monitoring`, undefined, 5)).statusCode).toBe(404);
});
it("exposes only global/current-tenant seeded framework choices", async () => {
  const r = await call("GET", "/frameworks/available");
  expect(r.statusCode).toBe(200);
  expect(r.json().frameworks.length).toBeGreaterThan(0);
  for (const f of r.json().frameworks) expect(f.controlCount).toBeGreaterThan(0);
});
it("rolls back failed request auditing and preserves historical records without invented attribution", async () => {
  const legacy = await prisma.riskAcceptance.create({ data: { tenantId: tenant, vendorId: vendor, assessmentId: assessment, justification: "Authentic legacy fixture", approvedByUserId: users[0], status: "APPROVED" } });
  const before = await prisma.riskAcceptance.count({ where: { tenantId: tenant } });
  failAction = "vendor.risk_acceptance_requested";
  try { expect((await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance())).statusCode).toBe(500); } finally { failAction = ""; }
  expect(await prisma.riskAcceptance.count({ where: { tenantId: tenant } })).toBe(before);
  expect((await call("POST", `/vendor-risk-acceptances/${legacy.id}/decision`, { decision: "APPROVED", rationale: "Invent historical review" }, 2)).statusCode).toBe(409);
  expect(await prisma.riskAcceptance.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
});
it("rejects malformed decisions without partial attribution or final history mutation", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance()); expect(r.statusCode).toBe(201); const id = r.json().riskAcceptance.id;
  for (const payload of [{ decision: "AUTO_APPROVE", rationale: "No" }, { decision: "APPROVED", rationale: "  " }, { decision: {}, rationale: "No" }]) expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, payload, 2)).statusCode).toBe(400);
  expect((await prisma.riskAcceptance.findUniqueOrThrow({ where: { id } })).decidedByUserId).toBeNull();
  expect((await call("POST", `/vendor-risk-acceptances/${id}/decision`, { decision: "REJECTED", rationale: "Independent rejection" }, 2)).statusCode).toBe(200);
  await expect(prisma.riskAcceptance.update({ where: { id }, data: { justification: "Overwrite final history" } })).rejects.toThrow();
});
it("requires actual human finding review and never closes the accepted underlying finding", async () => {
  const control = await prisma.control.findFirstOrThrow({ where: { frameworkVersion: { framework: { tenantId: null } } } });
  const finding = await prisma.controlFinding.create({ data: { tenantId: tenant, vendorId: vendor, assessmentId: assessment, controlId: control.id, status: "FAIL", proposedStatus: "FAIL", proposedByUserId: users[1], gaps: ["Disposable control gap"], recommendations: [], requiresHumanReview: true } });
  expect((await call("POST", `/vendors/${vendor}/risk-acceptance`, { ...acceptance(), findingId: finding.id })).statusCode).toBe(409);
  const review = await call("POST", `/assessments/${assessment}/findings/${finding.id}/review`, { decision: "ACCEPT", rationale: "Independent confirmation of the gap" }, 2);
  expect(review.statusCode).toBe(200);
  const before = await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } });
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, { ...acceptance(), findingId: finding.id }); expect(r.statusCode).toBe(201);
  expect((await call("POST", `/vendor-risk-acceptances/${r.json().riskAcceptance.id}/decision`, { decision: "APPROVED", rationale: "Explicitly tolerate residual gap" }, 2)).statusCode).toBe(200);
  expect(await prisma.controlFinding.findUniqueOrThrow({ where: { id: finding.id } })).toEqual(before);
});
it("preserves reassessment change history, requires independent reviewed completion, and rolls back audit failure", async () => {
  const cycle = await prisma.vendorReassessment.findFirstOrThrow({ where: { tenantId: tenant, vendorId: vendor, status: "IN_PROGRESS" } });
  const changes = "Updated service terms confirmed during assessment";
  const patch = await call("PATCH", `/vendor-reassessments/${cycle.id}`, { materialChanges: changes }); expect(patch.statusCode).toBe(200);
  expect(patch.json().reassessment.materialChanges).toBe(changes);
  expect((await call("PATCH", `/vendor-reassessments/${cycle.id}`, { materialChanges: " " })).statusCode).toBe(400);
  expect((await call("PATCH", `/vendor-reassessments/${cycle.id}`, { materialChanges: "Foreign change" }, 5)).statusCode).toBe(404);
  const q = await prisma.questionnaire.create({ data: { tenantId: tenant, assessmentId: cycle.newAssessmentId, name: "Reviewed disposable questionnaire", version: "1", status: "APPROVED", submittedByUserId: users[1], reviewedByUserId: users[0], approvedByUserId: users[2] } });
  failAction = "vendor.reassessment_completed";
  try { expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Independent completion" }, 2)).statusCode).toBe(500); } finally { failAction = ""; }
  expect((await prisma.vendorReassessment.findUniqueOrThrow({ where: { id: cycle.id } })).status).toBe("IN_PROGRESS");
  expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Unauthorized completion" }, 1)).statusCode).toBe(403);
  expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Independent completion" }, 2)).statusCode).toBe(200);
  expect((await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("APPROVED");
  expect((await call("PATCH", `/vendor-reassessments/${cycle.id}`, { materialChanges: "Overwrite completed history" })).statusCode).toBe(409);
  expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Repeat" }, 2)).statusCode).toBe(409);
  expect((await prisma.vendorReassessment.findUniqueOrThrow({ where: { id: cycle.id } })).priorSnapshot).toEqual(cycle.priorSnapshot);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenant, action: "vendor.reassessment_updated", targetId: cycle.id } })).toBe(1);
});
it("atomically rolls back failed reassessment creation and serializes concurrent starts", async () => {
  const baseline = await prisma.assessment.count({ where: { tenantId: tenant, vendorId: vendor } });
  const payload = { priorAssessmentId: assessment, trigger: "NEW_EVIDENCE", rationale: "Updated evidence review", materialChanges: "New evidence affects prior conclusions" };
  failAction = "vendor.reassessment_started";
  try { expect((await call("POST", `/vendors/${vendor}/reassessments`, payload)).statusCode).toBe(500); } finally { failAction = ""; }
  expect(await prisma.assessment.count({ where: { tenantId: tenant, vendorId: vendor } })).toBe(baseline);
  const r = await Promise.all([0, 1].map(actor => call("POST", `/vendors/${vendor}/reassessments`, payload, actor)));
  expect(r.map(x => x.statusCode).sort()).toEqual([201, 409]);
  const cycle = r.find(x => x.statusCode === 201)!.json().reassessment;
  const actor = cycle.startedByUserId === users[0] ? 0 : 1;
  if (actor === 0) expect((await call("POST", `/vendor-reassessments/${cycle.id}/complete`, { rationale: "Self completion" }, 0)).statusCode).toBe(409);
});
it("identifies due vendor reviews from stored dates and never returns another tenant's vendors", async () => {
  await prisma.vendor.update({ where: { id: vendor }, data: { contractReviewDate: new Date(Date.now() - 86400000) } });
  const r = await call("GET", "/vendor-monitoring", undefined, 4); expect(r.statusCode).toBe(200);
  expect(r.json().vendors.find((v: { id: string }) => v.id === vendor)).toMatchObject({ reviewDue: true, activeReassessments: 1 });
  expect((await call("GET", "/vendor-monitoring", undefined, 5)).json().vendors).toEqual([]);
});
it("holds current risk inputs stable through the decision and its required audit commit", async () => {
  const r = await call("POST", `/vendors/${vendor}/risk-acceptance`, acceptance()); expect(r.statusCode).toBe(201);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  pauseAudit = { entered, wait: new Promise<void>(resolve => { release = resolve; }) };
  const pending = call("POST", `/vendor-risk-acceptances/${r.json().riskAcceptance.id}/decision`, { decision: "APPROVED", rationale: "Stable source context" }, 2);
  try {
    await ready;
    await expect(prisma.$transaction(tx => tx.$queryRaw`SELECT id FROM assessments WHERE id=${assessment} FOR UPDATE NOWAIT`)).rejects.toThrow();
  } finally { release(); pauseAudit = null; await pending; }
});
