import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let tenantId: string | undefined;
const users: string[] = [];
const cookies: Record<string, string> = {};
let systemId: string, assessmentId: string, impactId: string;
let ip = 0;
async function request(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ANALYST") {
  return server.inject({ method, url, cookies: { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.193.${Math.floor(++ip / 250)}.${ip % 250}` });
}
beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Section11 impact validation" } })).id;
  for (const role of ["ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section11.example.test`, displayName: role } });
    users.push(user.id);
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, email: user.email, displayName: role, role });
  }
  systemId = (await prisma.aiSystem.create({ data: { tenantId, name: "Impact validation", origin: "INTERNAL", impactLevel: "MODERATE" } })).id;
  assessmentId = (await prisma.aiImpactAssessment.create({ data: { tenantId, aiSystemId: systemId, name: "Impact validation", version: 1, assessorUserId: users[0] } })).id;
});
afterAll(async () => {
  if (tenantId) {
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("Impact assessment input and live-summary regression", () => {
  it.each([{}, 42])("rejects malformed assessor identifier %j before creating an assessment", async assessorUserId => {
    const system = await prisma.aiSystem.create({ data: { tenantId: tenantId!, name: "Bad assessor fixture", origin: "INTERNAL" } });
    const response = await request("POST", `/ai-systems/${system.id}/impact-assessments`, { assessorUserId });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/Prisma|TypeError|stack/);
    expect(await prisma.aiImpactAssessment.count({ where: { aiSystemId: system.id } })).toBe(0);
  });
  it.each([{}, 42, []])("rejects malformed review rationale %j without changing review/history", async rationale => {
    const before = await prisma.aiImpactAssessment.findUniqueOrThrow({ where: { id: assessmentId } });
    const response = await request("POST", `/ai-impact-assessments/${assessmentId}/review`, { decision: "CHANGES_REQUESTED", rationale }, "REVIEWER");
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toMatch(/Prisma|TypeError|stack/);
    expect(await prisma.aiImpactAssessment.findUniqueOrThrow({ where: { id: assessmentId } })).toEqual(before);
    expect(await prisma.governanceDecision.count({ where: { impactAssessmentId: assessmentId } })).toBe(0);
  });
  it("keeps existing automatic assessment naming when the name is omitted", async () => {
    const system = await prisma.aiSystem.create({ data: { tenantId: tenantId!, name: "Automatic naming", origin: "INTERNAL" } });
    expect((await request("POST", `/ai-systems/${system.id}/impact-assessments`, {})).json()).toMatchObject({ name: "Impact Assessment v1", version: 1 });
  });
  it("derives the summary from persisted inputs after changes, rejected clearing and deletion", async () => {
    const before = await prisma.aiSystem.findUniqueOrThrow({ where: { id: systemId } });
    const created = await request("POST", `/ai-impact-assessments/${assessmentId}/impacts`, { title: "Adverse impact", description: "Disposable impact", category: "SOCIETAL", direction: "ADVERSE", affectedPopulation: "CUSTOMERS", severity: 5, scale: "LIMITED", reversibility: "IRREVERSIBLE", vulnerablePopulations: true, vulnerablePopulationsExplanation: "Disposable context" });
    expect(created.statusCode).toBe(201);
    impactId = created.json().id;
    const summary = async () => (await request("GET", `/ai-impact-assessments/${assessmentId}`)).json().impactSummary;
    expect(await summary()).toMatchObject({ totalImpacts: 1, highestAdverseSeverity: 5, majorOrSevereAdverseImpacts: 1, vulnerablePopulationImpacts: 1, difficultOrIrreversibleImpacts: 1 });
    expect((await request("PATCH", `/ai-impacts/${impactId}`, { severity: 2, reversibility: "REVERSIBLE", vulnerablePopulations: false, vulnerablePopulationsExplanation: null })).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ highestAdverseSeverity: 2, majorOrSevereAdverseImpacts: 0, vulnerablePopulationImpacts: 0, difficultOrIrreversibleImpacts: 0 });
    expect((await request("PATCH", `/ai-impacts/${impactId}`, { severity: null })).statusCode).toBe(400);
    expect((await prisma.aiImpact.findUniqueOrThrow({ where: { id: impactId } })).severity).toBe(2);
    expect((await request("PATCH", `/ai-impacts/${impactId}`, { direction: "BENEFICIAL" })).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ adverseImpacts: 0, beneficialImpacts: 1, highestAdverseSeverity: null });
    expect((await request("DELETE", `/ai-impacts/${impactId}`)).statusCode).toBe(200);
    expect(await summary()).toEqual({ totalImpacts: 0, beneficialImpacts: 0, adverseImpacts: 0, majorOrSevereAdverseImpacts: 0, vulnerablePopulationImpacts: 0, difficultOrIrreversibleImpacts: 0, highestAdverseSeverity: null });
    expect((await request("DELETE", `/ai-impacts/${impactId}`)).statusCode).toBe(404);
    expect((await prisma.aiSystem.findUniqueOrThrow({ where: { id: systemId } })).impactLevel).toBe(before.impactLevel);
  });
  it.each([null, [], 42, "text", {}, { title: " " }, { severity: "5" }, { vulnerablePopulations: true, vulnerablePopulationsExplanation: " " }])("rejects malformed or missing impact fields %j", async body => {
    expect((await request("POST", `/ai-impact-assessments/${assessmentId}/impacts`, body)).statusCode).toBe(400);
  });
  it.each(["AUDITOR", "READ_ONLY"])("allows %s reads and denies writes/review", async role => {
    expect((await request("GET", `/ai-impact-assessments/${assessmentId}`, undefined, role)).statusCode).toBe(200);
    expect((await request("PATCH", `/ai-impact-assessments/${assessmentId}`, { name: "Denied" }, role)).statusCode).toBe(403);
    expect((await request("POST", `/ai-impact-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: "Denied" }, role)).statusCode).toBe(403);
  });
  it("preserves returned decisions, locks completed records, and advances version history", async () => {
    expect((await request("POST", `/ai-impact-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: " " }, "REVIEWER")).statusCode).toBe(400);
    expect((await request("PATCH", `/ai-impact-assessments/${assessmentId}`, { status: "COMPLETED" })).statusCode).toBe(400);
    expect((await request("PATCH", `/ai-impact-assessments/${assessmentId}`, { status: "READY_FOR_REVIEW" })).statusCode).toBe(200);
    expect((await request("POST", `/ai-impact-assessments/${assessmentId}/review`, { decision: "CHANGES_REQUESTED", rationale: "First impact review" }, "REVIEWER")).json()).toMatchObject({ status: "IN_PROGRESS" });
    expect((await request("PATCH", `/ai-impact-assessments/${assessmentId}`, { status: "READY_FOR_REVIEW" })).statusCode).toBe(200);
    expect((await request("POST", `/ai-impact-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: "Second impact review" }, "REVIEWER")).json()).toMatchObject({ status: "COMPLETED" });
    expect((await request("PATCH", `/ai-impact-assessments/${assessmentId}`, { name: "Overwrite" })).statusCode).toBe(409);
    expect((await request("POST", `/ai-systems/${systemId}/impact-assessments`, {})).json()).toMatchObject({ version: 2 });
    expect((await request("POST", `/ai-systems/${systemId}/impact-assessments`, {})).statusCode).toBe(409);
    const decisions = await prisma.governanceDecision.findMany({ where: { impactAssessmentId: assessmentId }, orderBy: { createdAt: "asc" } });
    expect(decisions.map(row => row.rationale)).toEqual(["First impact review", "Second impact review"]);
    for (const id of [randomUUID(), "invalid-id", encodeURIComponent("' OR 1=1 --")]) {
      expect((await request("GET", `/ai-impact-assessments/${id}`)).statusCode).toBe(404);
      expect((await request("PATCH", `/ai-impacts/${id}`, { severity: 2 })).statusCode).toBe(404);
    }
  });
});
