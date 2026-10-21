import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it as test, expect } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { calculateAIInherentRisk, calculateAIImpactScore, calculateResidualRisk, mapQuestionnaireToRiskFactors } from "@vendorguard/risk-engine";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

const tenants: string[] = [], users: string[] = [], frameworks: string[] = [];
const cookies: Record<string, string> = {};
let vendorId: string, foreignVendor: string, systemId: string, catalogId: string, foreignCatalog: string, ip = 0, failModel = "", failAfter = 1, failureCount = 0;
const pending = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> { pending.add(p); void p.then(() => pending.delete(p), () => pending.delete(p)); return p; }
function it(name: string, body: () => Promise<void>) { test(name, () => track(Promise.resolve().then(body))); }
async function drain() { while (pending.size) await Promise.allSettled([...pending]); }
beforeEach(drain);
afterEach(async () => { await drain(); failModel = ""; failAfter = 1; failureCount = 0; });
function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ANALYST") {
  return track(Promise.resolve(server.inject({ method, url, cookies: role === "NONE" ? {} : { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}), remoteAddress: `10.195.${Math.floor(++ip / 250)}.${ip % 250}` })));
}
async function vendor() { return prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section17 disposable", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } }); }
async function assessment() { return prisma.assessment.create({ data: { tenantId: tenants[0]!, vendorId, scoringModelVersion: "section17", startedByUserId: users[1]! } }); }
async function questionnaire(status: "DRAFT" | "IN_PROGRESS" | "SUBMITTED" | "REVIEWED" | "APPROVED" = "DRAFT") {
  const a = await assessment();
  return prisma.questionnaire.create({ data: { tenantId: tenants[0]!, assessmentId: a.id, name: "Section17 disposable", version: "1.0", status, ...(status !== "DRAFT" && status !== "IN_PROGRESS" ? { submittedByUserId: users[1]! } : {}), ...(status === "REVIEWED" || status === "APPROVED" ? { reviewedByUserId: users[2]! } : {}), ...(status === "APPROVED" ? { approvedByUserId: users[0]! } : {}) } });
}
beforeAll(async () => {
  for (const label of ["A", "B"]) tenants.push((await prisma.tenant.create({ data: { name: `Section17 vendors ${label}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section17.example.test`, displayName: role } }); users.push(user.id);
    const tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!; const actualRole = role === "FOREIGN" ? "ADMIN" : role;
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, role: actualRole, email: user.email, displayName: role });
  }
  vendorId = (await vendor()).id;
  foreignVendor = (await prisma.vendor.create({ data: { tenantId: tenants[1]!, legalName: "Section17 foreign", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" } })).id;
  systemId = (await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: "Section17 system", origin: "INTERNAL" } })).id;
  for (const tenantId of tenants) {
    const fw = await prisma.framework.create({ data: { tenantId, catalogId: `s8-test-section17-${randomUUID()}`, name: "Disposable private framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } }); frameworks.push(fw.id);
    await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
    if (tenantId === tenants[0]) catalogId = fw.catalogId; else foreignCatalog = fw.catalogId;
  }
  databaseClient.$use(async (params, next) => {
    if (failModel && params.model === failModel && params.action === "create" && params.args?.data?.tenantId === tenants[0] && ++failureCount >= failAfter) throw new Error("Disposable Section17 persistence failure");
    return next(params);
  });
});
afterAll(async () => {
  await drain(); failModel = ""; const where = { tenantId: { in: tenants } };
  await prisma.remediationVerification.deleteMany({ where }); await prisma.remediationAction.deleteMany({ where });
  await prisma.governanceFindingReview.deleteMany({ where }); await prisma.governanceFinding.deleteMany({ where });
  await prisma.reviewDecision.deleteMany({ where }); await prisma.controlFinding.deleteMany({ where });
  await prisma.riskAcceptance.deleteMany({ where }); await prisma.auditEvent.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.framework.deleteMany({ where: { id: { in: frameworks } } }); await prisma.user.deleteMany({ where: { id: { in: users } } });
});
for (const body of [null, 42, [], { legalName: " " }, { legalName: {} }, { legalName: "Test", serviceDescription: {} }, { legalName: "Test", dataSensitivity: "50" }, { legalName: "Test", dataSensitivity: 101 }, { legalName: "Test", aiFunctionality: "true" }]) it(`rejects malformed vendor creation ${JSON.stringify(body)} without inserting`, async () => {
  const before = await prisma.vendor.count({ where: { tenantId: tenants[0] } });
  expect((await call("POST", "/vendors", body)).statusCode).toBe(400);
  expect(await prisma.vendor.count({ where: { tenantId: tenants[0] } })).toBe(before);
});
for (const body of [null, [], { legalName: "  " }, { serviceDescription: {} }, { aiProviders: "not-an-array" }, { dataSensitivity: -1 }, { dataSensitivity: 0.5 }]) it(`rejects malformed vendor updates ${JSON.stringify(body)}`, async () => {
  const row = await vendor(); expect((await call("PATCH", `/vendors/${row.id}`, body)).statusCode).toBe(400);
  expect(await prisma.vendor.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
});
for (const body of [null, { frameworkIds: "wrong" }, { frameworkIds: [42] }]) it(`rejects malformed framework selection ${JSON.stringify(body)} without partial assessments`, async () => {
  const before = await prisma.assessment.count({ where: { vendorId } });
  expect((await call("POST", `/vendors/${vendorId}/assessments`, body)).statusCode).toBe(400);
  expect(await prisma.assessment.count({ where: { vendorId } })).toBe(before);
});
it("deduplicates repeated framework selections while preserving permitted links only", async () => {
  const res = await call("POST", `/vendors/${vendorId}/assessments`, { frameworkIds: [catalogId, catalogId, foreignCatalog, "missing-catalog"] });
  expect(res.statusCode).toBe(201);
  const links = await prisma.assessmentFramework.findMany({ where: { assessmentId: res.json().id } });
  expect(links).toHaveLength(1); expect(links[0]!.frameworkId).toBe(frameworks[0]);
});
for (const body of [null, { answers: [] }, { answers: "bad" }, { answers: { customerDataTraining: "yes" } }, { answers: { sensitiveDataCategories: {} } }, { answers: { sensitiveDataCategories: ["PII", "PII"] } }, { answers: { securityTestingStatus: {} } }, { answers: { unknownQuestion: true } }]) it(`rejects malformed questionnaire answers ${JSON.stringify(body)}`, async () => {
  const q = await questionnaire(); expect((await call("PATCH", `/questionnaires/${q.id}/responses`, body)).statusCode).toBe(400);
  expect(await prisma.questionnaireResponse.count({ where: { questionnaireId: q.id } })).toBe(0);
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(q);
});
for (const status of ["SUBMITTED", "REVIEWED", "APPROVED"] as const) it(`does not edit or resubmit protected ${status} questionnaire`, async () => {
  const q = await questionnaire(status);
  expect((await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true } })).statusCode).toBe(409);
  expect((await call("POST", `/questionnaires/${q.id}/submit`)).statusCode).toBe(409);
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(q);
});
for (const [status, action] of [["DRAFT", "review"], ["IN_PROGRESS", "review"], ["DRAFT", "approve"], ["SUBMITTED", "approve"], ["APPROVED", "review"], ["APPROVED", "approve"]] as const) it(`denies invalid ${status} -> ${action} without overwriting attribution`, async () => {
  const q = await questionnaire(status);
  expect((await call("POST", `/questionnaires/${q.id}/${action}`, undefined, "REVIEWER")).statusCode).toBe(409);
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(q);
});
for (const route of ["ai-risk-score", "ai-impact-score", "risk-rating"]) for (const body of [null, { modelRisk: "bad", potentialHarmSeverity: {}, businessCriticality: [] }]) it(`rejects malformed ${route} ${JSON.stringify(body)}`, async () => {
  const a = await assessment(); expect((await call("POST", `/assessments/${a.id}/${route}`, body)).statusCode).toBe(400);
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).toEqual(a);
  expect(await prisma.riskRating.count({ where: { assessmentId: a.id } })).toBe(0);
});
for (const operation of ["vendor-create", "vendor-update", "vendor-delete", "assessment", "questionnaire-create", "answers", "submit", "review", "approve", "ai-risk-score", "ai-impact-score", "risk-rating"]) it(`rolls back ${operation} when audit persistence fails`, async () => {
  const v = await vendor(), a = await assessment(), q = await questionnaire(operation === "review" ? "SUBMITTED" : operation === "approve" ? "REVIEWED" : "DRAFT");
  const oldAssessment = await prisma.assessment.findUniqueOrThrow({ where: { id: q.assessmentId } });
  const count = await prisma.vendor.count({ where: { tenantId: tenants[0] } });
  const assessmentCount = await prisma.assessment.count({ where: { vendorId: v.id } });
  failModel = "AuditEvent";
  const res = operation === "vendor-create" ? await call("POST", "/vendors", { legalName: "Must rollback" }) : operation === "vendor-update" ? await call("PATCH", `/vendors/${v.id}`, { legalName: "Must rollback" }) : operation === "vendor-delete" ? await call("DELETE", `/vendors/${v.id}`, undefined, "ADMIN") : operation === "assessment" ? await call("POST", `/vendors/${v.id}/assessments`, { frameworkIds: [catalogId] }) : operation === "questionnaire-create" ? await call("POST", `/assessments/${a.id}/questionnaire`) : operation === "answers" ? await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true } }) : ["submit", "review", "approve"].includes(operation) ? await call("POST", `/questionnaires/${q.id}/${operation}`, undefined, operation === "submit" ? "ANALYST" : "REVIEWER") : await call("POST", `/assessments/${a.id}/${operation}`, { modelRisk: 40, potentialHarmSeverity: 40, businessCriticality: 40 });
  failModel = ""; expect(res.statusCode).toBe(500);
  expect(await prisma.vendor.count({ where: { tenantId: tenants[0] } })).toBe(count);
  expect(await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).toEqual(v);
  expect(await prisma.assessment.count({ where: { vendorId: v.id } })).toBe(assessmentCount);
  expect(await prisma.questionnaire.count({ where: { assessmentId: a.id } })).toBe(0);
  expect(await prisma.questionnaireResponse.count({ where: { questionnaireId: q.id } })).toBe(0);
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(q);
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).toEqual(a);
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: q.assessmentId } })).toEqual(oldAssessment);
  expect(await prisma.riskRating.count({ where: { assessmentId: a.id } })).toBe(0);
});
it("persists permitted vendor changes and reports only current-tenant records", async () => {
  const created = await call("POST", "/vendors", { legalName: "Section17 API vendor", dataSensitivity: 70, aiFunctionality: true }); expect(created.statusCode).toBe(201);
  const id = created.json().id;
  expect((await call("PATCH", `/vendors/${id}`, { legalName: "Section17 updated", aiProviders: ["Disposable provider"], customerDataTrainingPolicy: true })).statusCode).toBe(200);
  expect((await call("GET", `/vendors/${id}`)).json()).toMatchObject({ legalName: "Section17 updated", dataSensitivity: 70, aiProviders: ["Disposable provider"] });
  expect((await call("GET", "/vendors")).json().vendors.map((v: { id: string }) => v.id)).not.toContain(foreignVendor);
  for (const method of ["GET", "PATCH", "DELETE"] as const) expect((await call(method, `/vendors/${foreignVendor}`, method === "PATCH" ? { legalName: "Attack" } : undefined, "ADMIN")).statusCode).toBe(404);
});
it("keeps implemented questionnaire scoring and independent human approval intact", async () => {
  const q = await questionnaire();
  const answers = { usesGenerativeAI: true, customerDataTraining: false, sensitiveDataCategories: ["PII"], humanOversightLevel: "full review", decisionAutonomyLevel: "advisory" };
  expect((await call("PATCH", `/questionnaires/${q.id}/responses`, { answers })).statusCode).toBe(200);
  const saved = (await call("GET", `/questionnaires/${q.id}`)).json().questionnaire;
  expect(saved.responses).toHaveLength(5);
  const mapped = mapQuestionnaireToRiskFactors(Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { value }])));
  const inherent = calculateAIInherentRisk(mapped.aiRiskFactors), impact = calculateAIImpactScore(mapped.aiImpactFactors);
  const submit = await call("POST", `/questionnaires/${q.id}/submit`); expect(submit.statusCode).toBe(200);
  expect(submit.json().inherent).toEqual(inherent); expect(submit.json().impact).toEqual(impact); expect(submit.json().residual).toEqual(calculateResidualRisk(inherent.score, 0));
  expect((await call("POST", `/questionnaires/${q.id}/review`, undefined, "REVIEWER")).statusCode).toBe(200);
  expect((await call("POST", `/questionnaires/${q.id}/approve`, undefined, "ADMIN")).statusCode).toBe(200);
  expect((await call("GET", `/questionnaires/${q.id}`)).json().questionnaire).toMatchObject({ status: "APPROVED", submittedByUserId: users[1], reviewedByUserId: users[2], approvedByUserId: users[0] });
});
it("reopens the existing questionnaire instead of creating a fresh draft on each page visit", async () => {
  const a = await assessment();
  const first = await call("POST", `/assessments/${a.id}/questionnaire`);
  expect(first.statusCode).toBe(200);
  const again = await call("POST", `/assessments/${a.id}/questionnaire`);
  expect(again.json().questionnaire.id).toBe(first.json().questionnaire.id);
  expect(await prisma.questionnaire.count({ where: { assessmentId: a.id } })).toBe(1);
});
it("preserves original offboarding timestamp across repeated deletion", async () => {
  const v = await vendor();
  expect((await call("DELETE", `/vendors/${v.id}`, undefined, "ADMIN")).statusCode).toBe(204);
  const first = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
  expect((await call("DELETE", `/vendors/${v.id}`, undefined, "ADMIN")).statusCode).toBe(204);
  expect(await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).toEqual(first);
  expect(await prisma.auditEvent.count({ where: { targetId: v.id, action: "vendor.deleted" } })).toBe(1);
});
for (const body of [null, { justification: {} }, { justification: "Valid", expiresAt: "invalid-date" }, { justification: "Valid", assessmentId: {} }]) it(`rejects malformed vendor risk acceptance ${JSON.stringify(body)}`, async () => {
  const count = await prisma.riskAcceptance.count({ where: { vendorId } });
  expect((await call("POST", `/vendors/${vendorId}/risk-acceptance`, body, "REVIEWER")).statusCode).toBe(400);
  expect(await prisma.riskAcceptance.count({ where: { vendorId } })).toBe(count);
});
it("rejects foreign and wrong-vendor assessment relationships on vendor acceptance", async () => {
  const foreign = await prisma.assessment.create({ data: { tenantId: tenants[1]!, vendorId: foreignVendor, scoringModelVersion: "section17", startedByUserId: users[5]! } });
  const ownOtherVendor = await vendor();
  const other = await prisma.assessment.create({ data: { tenantId: tenants[0]!, vendorId: ownOtherVendor.id, scoringModelVersion: "section17", startedByUserId: users[1]! } });
  for (const id of [foreign.id, other.id, randomUUID()]) {
    expect((await call("POST", `/vendors/${vendorId}/risk-acceptance`, { justification: "Wrong relationship", assessmentId: id }, "REVIEWER")).statusCode).toBe(404);
    expect(await prisma.riskAcceptance.count({ where: { vendorId, assessmentId: id } })).toBe(0);
  }
});
it("records legacy vendor acceptance with human attribution and an atomic audit", async () => {
  const a = await assessment();
  failModel = "AuditEvent";
  const failed = await call("POST", `/vendors/${vendorId}/risk-acceptance`, { justification: "Human business decision", assessmentId: a.id }, "REVIEWER"); failModel = "";
  expect(failed.statusCode).toBe(500);
  expect(await prisma.riskAcceptance.count({ where: { assessmentId: a.id } })).toBe(0);
  const good = await call("POST", `/vendors/${vendorId}/risk-acceptance`, { justification: "Human business decision", assessmentId: a.id }, "REVIEWER");
  expect(good.statusCode).toBe(200);
  expect(good.json().riskAcceptance).toMatchObject({ approvedByUserId: users[2], status: "APPROVED" });
  expect(await prisma.auditEvent.findFirst({ where: { targetId: good.json().riskAcceptance.id, actorUserId: users[2], action: "vendor.risk_accepted" } })).not.toBeNull();
});
for (const action of ["submit", "review", "approve"] as const) it(`permits only one concurrent questionnaire ${action} and preserves the winner`, async () => {
  const q = await questionnaire(action === "submit" ? "IN_PROGRESS" : action === "review" ? "SUBMITTED" : "REVIEWED");
  const firstRole = action === "submit" ? "ANALYST" : "REVIEWER", secondRole = "ADMIN";
  const res = await Promise.all([call("POST", `/questionnaires/${q.id}/${action}`, undefined, firstRole), call("POST", `/questionnaires/${q.id}/${action}`, undefined, secondRole)]);
  expect(res.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const field = action === "submit" ? "submittedByUserId" : action === "review" ? "reviewedByUserId" : "approvedByUserId";
  const saved = await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } });
  expect(saved[field]).toBe(res[0]!.statusCode === 200 ? users[action === "submit" ? 1 : 2] : users[0]);
  const audit = await prisma.auditEvent.findMany({ where: { targetId: q.id, action: action === "submit" ? "questionnaire.submitted" : action === "review" ? "questionnaire.reviewed" : "questionnaire.approved" } });
  expect(audit).toHaveLength(1); expect(audit[0]!.actorUserId).toBe(saved[field]);
});
it("serializes concurrent questionnaire opening without duplicate drafts", async () => {
  const a = await assessment();
  const res = await Promise.all([call("POST", `/assessments/${a.id}/questionnaire`), call("POST", `/assessments/${a.id}/questionnaire`)]);
  expect(res.map(r => r.statusCode)).toEqual([200, 200]);
  expect(res[0]!.json().questionnaire.id).toBe(res[1]!.json().questionnaire.id);
  expect(await prisma.questionnaire.count({ where: { assessmentId: a.id } })).toBe(1);
});
it("serializes concurrent answer saves without duplicate question records", async () => {
  const q = await questionnaire();
  const res = await Promise.all([call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true } }), call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: false } }, "ADMIN")]);
  expect(res.map(r => r.statusCode)).toEqual([200, 200]);
  const rows = await prisma.questionnaireResponse.findMany({ where: { questionnaireId: q.id, questionKey: "usesGenerativeAI" } });
  expect(rows).toHaveLength(1); expect([users[1], users[0]]).toContain(rows[0]!.answeredByUserId);
});
it("keeps submitted scores consistent with the committed answers during save/submit races", async () => {
  const q = await questionnaire();
  expect((await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: false } })).statusCode).toBe(200);
  const [saved, submitted] = await Promise.all([call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true } }), call("POST", `/questionnaires/${q.id}/submit`)]);
  expect([200, 409]).toContain(saved.statusCode); expect(submitted.statusCode).toBe(200);
  const rows = await prisma.questionnaireResponse.findMany({ where: { questionnaireId: q.id } });
  const mapped = mapQuestionnaireToRiskFactors(Object.fromEntries(rows.map(r => [r.questionKey, r.answerJson as { value: boolean }])));
  const current = await prisma.assessment.findUniqueOrThrow({ where: { id: q.assessmentId } });
  expect(current.aiInherentScore).toBe(calculateAIInherentRisk(mapped.aiRiskFactors).score);
  expect(current.impactScore).toBe(calculateAIImpactScore(mapped.aiImpactFactors).score);
});
it("rolls back earlier answers when the second response persistence operation fails", async () => {
  const q = await questionnaire(); failModel = "QuestionnaireResponse"; failAfter = 2;
  const res = await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true, usesRAG: true } }); failModel = "";
  expect(res.statusCode).toBe(500);
  expect(await prisma.questionnaireResponse.count({ where: { questionnaireId: q.id } })).toBe(0);
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(q);
  expect(await prisma.auditEvent.count({ where: { targetId: q.id, action: "questionnaire.responses_saved" } })).toBe(0);
});
for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"]) it(`denies vendor and questionnaire writes by ${role} while allowing vendor reads`, async () => {
  const q = await questionnaire();
  expect((await call("GET", `/vendors/${vendorId}`, undefined, role)).statusCode).toBe(200);
  expect((await call("POST", "/vendors", { legalName: "Denied" }, role)).statusCode).toBe(403);
  expect((await call("PATCH", `/vendors/${vendorId}`, { legalName: "Denied" }, role)).statusCode).toBe(403);
  expect((await call("DELETE", `/vendors/${vendorId}`, undefined, role)).statusCode).toBe(403);
  expect((await call("POST", `/vendors/${vendorId}/assessments`, { frameworkIds: [] }, role)).statusCode).toBe(403);
  expect((await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: {} }, role)).statusCode).toBe(403);
  expect((await call("POST", `/questionnaires/${q.id}/submit`, undefined, role)).statusCode).toBe(403);
});
it("fails closed for missing and foreign vendor/assessment/questionnaire IDs", async () => {
  const q = await questionnaire(); const before = await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } });
  for (const method of ["GET", "PATCH", "POST"] as const) {
    const suffix = method === "PATCH" ? "/responses" : method === "POST" ? "/submit" : "";
    expect((await call(method, `/questionnaires/${q.id}${suffix}`, method === "PATCH" ? { answers: {} } : undefined, "FOREIGN")).statusCode).toBe(404);
  }
  for (const id of ["bad-id", randomUUID()]) {
    expect((await call("GET", `/vendors/${id}`)).statusCode).toBe(404);
    expect((await call("POST", `/vendors/${id}/assessments`, { frameworkIds: [] })).statusCode).toBe(404);
    expect((await call("GET", `/questionnaires/${id}`)).statusCode).toBe(404);
  }
  expect(await prisma.questionnaire.findUniqueOrThrow({ where: { id: q.id } })).toEqual(before);
});
it("does not trust forged tenant/actor fields during vendor creation", async () => {
  const res = await call("POST", "/vendors", { legalName: "Section17 forged fields", tenantId: tenants[1], actorUserId: users[5] });
  expect(res.statusCode).toBe(201); expect(res.json().tenantId).toBe(tenants[0]);
  expect(await prisma.auditEvent.findFirst({ where: { targetId: res.json().id, action: "vendor.created" } })).toMatchObject({ tenantId: tenants[0], actorUserId: users[1] });
});
it("links only permitted vendors to AI systems and rejects duplicate/foreign links", async () => {
  const url = `/ai-systems/${systemId}/vendors`;
  const res = await call("POST", url, { vendorId, role: "PRIMARY_PROVIDER" }); expect(res.statusCode).toBe(201);
  expect((await call("GET", url)).json().vendorLinks.map((x: {vendorId: string}) => x.vendorId)).toContain(vendorId);
  expect((await call("POST", url, { vendorId, role: "PRIMARY_PROVIDER" })).statusCode).toBe(409);
  expect((await call("POST", url, { vendorId: foreignVendor })).statusCode).toBe(404);
  for (const role of ["REVIEWER", "AUDITOR", "READ_ONLY"]) expect((await call("POST", url, { vendorId }, role)).statusCode).toBe(403);
  expect((await call("DELETE", `${url}/${res.json().id}`)).statusCode).toBe(204);
  expect(await prisma.aiSystemVendor.count({ where: { aiSystemId: systemId } })).toBe(0);
});
it("cannot use vendor links to modify a retired AI system", async () => {
  const retired = await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: "Section17 retired fixture", origin: "INTERNAL", lifecycleStatus: "RETIRED" } });
  expect((await call("POST", `/ai-systems/${retired.id}/vendors`, { vendorId })).statusCode).toBe(409);
  expect(await prisma.aiSystemVendor.count({ where: { aiSystemId: retired.id } })).toBe(0);
});
it("preserves vendor finding review and governed remediation boundaries", async () => {
  const a = await assessment(); const control = await prisma.control.findFirstOrThrow({ where: { frameworkVersion: { framework: { tenantId: null } } } });
  const proposal = await call("POST", `/assessments/${a.id}/findings`, { controlId: control.id, status: "FAIL" }); expect(proposal.statusCode).toBe(200);
  expect(proposal.json()).toMatchObject({ requiresHumanReview: true, status: "INSUFFICIENT_EVIDENCE" });
  const findingId = proposal.json().id;
  expect((await call("POST", `/assessments/${a.id}/findings/${findingId}/review`, { decision: "ACCEPT", rationale: "Independent review" }, "REVIEWER")).statusCode).toBe(200);
  expect((await call("POST", `/assessments/${a.id}/findings`, { controlId: control.id, status: "PASS" })).statusCode).toBe(409);
  expect((await call("POST", `/vendors/${foreignVendor}/remediations`, { findingId, title: "Wrong tenant", description: "Denied" }, "FOREIGN")).statusCode).toBe(404);
  const rem = await call("POST", `/vendors/${vendorId}/remediations`, { findingId, title: "Vendor correction", description: "Existing vendor remediation" }); expect(rem.statusCode).toBe(201);
  expect((await call("GET", `/vendors/${vendorId}/remediations`)).json().remediations.map((x: { id: string }) => x.id)).toContain(rem.json().id);
  const governed = await prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Protected finding", description: "Disposable", severity: "HIGH", createdByUserId: users[1]!, status: "OPEN" } });
  const protectedRem = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, governanceFindingId: governed.id, title: "Protected remediation", description: "Disposable", ownerUserId: users[1]! } });
  expect((await call("PATCH", `/remediations/${protectedRem.id}`, { status: "CLOSED" }, "ADMIN")).statusCode).toBe(409);
  expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id: protectedRem.id } })).status).toBe("OPEN");
});
it("persists the same control-effectiveness input used by questionnaire residual scoring", async () => {
  const q = await questionnaire();
  await prisma.assessment.update({ where: { id: q.assessmentId }, data: { aiControlEffectiveness: 80 } });
  expect((await call("PATCH", `/questionnaires/${q.id}/responses`, { answers: { usesGenerativeAI: true } })).statusCode).toBe(200);
  const res = await call("POST", `/questionnaires/${q.id}/submit`); expect(res.statusCode).toBe(200);
  const row = await prisma.assessment.findUniqueOrThrow({ where: { id: q.assessmentId } });
  expect(row.aiControlEffectiveness).toBe(0);
  expect(row.aiResidualScore).toBe(calculateResidualRisk(row.aiInherentScore!, row.aiControlEffectiveness!).score);
});
it("keeps vendor reporting tied to the authoritative tenant vendor and assessment", async () => {
  const a = await assessment();
  const res = await call("GET", `/vendors/${vendorId}/executive-report`, undefined, "ADMIN");
  expect(res.statusCode).toBe(200);
  expect(res.json().vendor.id).toBe(vendorId); expect(res.json().assessment.id).toBe(a.id);
  expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenants[0], targetId: vendorId, action: "report.generated", actorUserId: users[0] } })).not.toBeNull();
  expect((await call("GET", `/vendors/${foreignVendor}/executive-report`, undefined, "ADMIN")).statusCode).toBe(404);
});
for (const value of [0, 100]) it(`preserves implemented vendor scoring at valid boundary ${value}`, async () => {
  const a = await assessment();
  const inputs = { modelRisk: value, dataRisk: value, securityRisk: value, regulatoryRisk: value, humanOversightRisk: value, governanceRisk: value };
  const res = await call("POST", `/assessments/${a.id}/ai-risk-score`, { ...inputs, controlEffectiveness: value });
  expect(res.statusCode).toBe(200);
  const inherent = calculateAIInherentRisk(inputs), residual = calculateResidualRisk(inherent.score, value);
  expect(res.json().inherent).toEqual(inherent); expect(res.json().residual).toEqual(residual);
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ aiInherentScore: inherent.score, aiResidualScore: residual.score, aiRiskBand: residual.band, aiControlEffectiveness: value });
});
