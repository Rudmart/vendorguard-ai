import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let tenantId: string | undefined;
const users: string[] = [];
const cookies: Record<string, string> = {};
let systemId: string, assessmentId: string, riskId: string;
let ip = 0;
async function request(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ANALYST") {
  return server.inject({ method, url, cookies: { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.192.${Math.floor(++ip / 250)}.${ip % 250}` });
}
beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Section10 risk validation" } })).id;
  for (const role of ["ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
    const unique = randomUUID();
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section10.example.test`, displayName: role } });
    users.push(user.id);
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, email: user.email, displayName: role, role });
  }
  systemId = (await prisma.aiSystem.create({ data: { tenantId, name: "Risk validation", origin: "INTERNAL" } })).id;
  assessmentId = (await prisma.aiRiskAssessment.create({ data: { tenantId, aiSystemId: systemId, name: "Risk validation", version: 1, assessorUserId: users[0] } })).id;
  riskId = (await prisma.aiRisk.create({ data: { tenantId, assessmentId, title: "Valid risk", statement: "Valid statement", category: "DATA", likelihood: 2, impact: 3, inherentScore: 6, inherentRating: "MODERATE" } })).id;
});
afterAll(async () => {
  if (tenantId) {
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("Risk assessment input and derived-value regression", () => {
  for (const route of ["create", "update", "risk-create", "risk-update", "review"]) {
    it.each([null, [], 42, "text"])(`${route} rejects malformed body %j`, async body => {
      const url = route === "create" ? `/ai-systems/${systemId}/risk-assessments` : route === "risk-create" ? `/ai-risk-assessments/${assessmentId}/risks` : route === "risk-update" ? `/ai-risks/${riskId}` : `/ai-risk-assessments/${assessmentId}${route === "review" ? "/review" : ""}`;
      const before = await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: assessmentId } });
      const response = await request(route === "update" || route === "risk-update" ? "PATCH" : "POST", url, body, route === "review" ? "REVIEWER" : "ANALYST");
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toMatch(/Prisma|TypeError|stack/);
      expect(await prisma.aiRiskAssessment.findUniqueOrThrow({ where: { id: assessmentId } })).toEqual(before);
    });
  }
  it.each([{ name: " " }, { name: {} }, { assessorUserId: {} }])("rejects invalid assessment fields %j", async body => {
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, body)).statusCode).toBe(400);
  });
  it.each([{ title: " " }, { statement: {} }, { controlId: {} }, { existingControls: {} }, { treatmentRationale: {} }, { treatmentOwnerUserId: {} }, { treatmentTargetDate: "not-a-date" }])("rejects invalid risk fields %j", async body => {
    expect((await request("PATCH", `/ai-risks/${riskId}`, body)).statusCode).toBe(400);
  });
  it.each([" ", {}, 42])("rejects invalid review rationale %j without recording a decision", async rationale => {
    const before = await prisma.governanceDecision.count({ where: { riskAssessmentId: assessmentId } });
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "CHANGES_REQUESTED", rationale }, "REVIEWER")).statusCode).toBe(400);
    expect(await prisma.governanceDecision.count({ where: { riskAssessmentId: assessmentId } })).toBe(before);
  });
  it.each([{}, { name: " " }, { name: 42 }, { name: "Valid", assessorUserId: {} }])("rejects invalid registration input %j", async body => {
    expect((await request("POST", `/ai-systems/${systemId}/risk-assessments`, body)).statusCode).toBe(400);
  });
  it.each(["AUDITOR", "READ_ONLY"])("allows %s reads but denies assessment writes and reviews", async role => {
    expect((await request("GET", `/ai-risk-assessments/${assessmentId}`, undefined, role)).statusCode).toBe(200);
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { name: "Denied" }, role)).statusCode).toBe(403);
    expect((await request("POST", `/ai-systems/${systemId}/risk-assessments`, { name: "Denied" }, role)).statusCode).toBe(403);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: "Denied" }, role)).statusCode).toBe(403);
  });
  it.each([{}, { title: "Risk", category: "DATA" }, { title: "Risk", category: "DATA", statement: "Statement", likelihood: "5", impact: 2 }])("rejects missing or invalid risk registration fields %j", async body => {
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/risks`, body)).statusCode).toBe(400);
  });
  it("rejects malformed identifiers and invalid status/review values without server errors", async () => {
    for (const id of ["not-a-uuid", encodeURIComponent("' OR 1=1 --")]) {
      expect((await request("GET", `/ai-risk-assessments/${id}`)).statusCode).toBe(404);
      expect((await request("PATCH", `/ai-risks/${id}`, { likelihood: 2 })).statusCode).toBe(404);
    }
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { status: "INVALID" })).statusCode).toBe(400);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "INVALID", rationale: "Invalid decision" }, "REVIEWER")).statusCode).toBe(400);
  });
  for (const field of ["residualLikelihood", "residualImpact"]) {
    it(`clears derived residual values when ${field} is cleared`, async () => {
      expect((await request("PATCH", `/ai-risks/${riskId}`, { residualLikelihood: 3, residualImpact: 4 })).statusCode).toBe(200);
      expect((await request("PATCH", `/ai-risks/${riskId}`, { [field]: null })).statusCode).toBe(200);
      const saved = await prisma.aiRisk.findUniqueOrThrow({ where: { id: riskId } });
      expect(saved.residualScore).toBeNull();
      expect(saved.residualRating).toBeNull();
    });
  }
  it("persists all 25 inherent score combinations and ignores submitted derived values", async () => {
    for (let likelihood = 1; likelihood <= 5; likelihood++) for (let impact = 1; impact <= 5; impact++) {
      const score = likelihood * impact;
      const rating = score <= 4 ? "LOW" : score <= 9 ? "MODERATE" : score <= 16 ? "HIGH" : "CRITICAL";
      expect((await request("PATCH", `/ai-risks/${riskId}`, { likelihood, impact, inherentScore: 0, inherentRating: "LOW" })).statusCode).toBe(200);
      const response = await request("GET", `/ai-risk-assessments/${assessmentId}`);
      expect(response.json().risks.find((risk: { id: string }) => risk.id === riskId)).toMatchObject({ likelihood, impact, inherentScore: score, inherentRating: rating });
    }
  });
  it("preserves returned review history, locks approved data and creates the next version", async () => {
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { status: "COMPLETED" })).statusCode).toBe(400);
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { status: "READY_FOR_REVIEW" })).statusCode).toBe(200);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: "Self review" })).statusCode).toBe(403);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "CHANGES_REQUESTED", rationale: "First review" }, "REVIEWER")).json()).toMatchObject({ status: "IN_PROGRESS" });
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { status: "READY_FOR_REVIEW" })).statusCode).toBe(200);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "APPROVED", rationale: "Second review" }, "REVIEWER")).json()).toMatchObject({ status: "COMPLETED" });
    expect((await request("PATCH", `/ai-risk-assessments/${assessmentId}`, { name: "Overwrite" })).statusCode).toBe(409);
    expect((await request("PATCH", `/ai-risks/${riskId}`, { likelihood: 1 })).statusCode).toBe(409);
    expect((await request("DELETE", `/ai-risks/${riskId}`)).statusCode).toBe(409);
    expect((await request("POST", `/ai-risk-assessments/${assessmentId}/review`, { decision: "REJECTED", rationale: "Overwrite" }, "REVIEWER")).statusCode).toBe(409);
    expect((await request("POST", `/ai-systems/${systemId}/risk-assessments`, { name: "Next version" })).json()).toMatchObject({ version: 2 });
    expect((await request("POST", `/ai-systems/${systemId}/risk-assessments`, { name: "Duplicate open version" })).statusCode).toBe(409);
    const history = await prisma.governanceDecision.findMany({ where: { riskAssessmentId: assessmentId }, orderBy: { createdAt: "asc" } });
    expect(history.map(row => row.rationale)).toEqual(["First review", "Second review"]);
    expect((await request("GET", `/ai-risk-assessments/${assessmentId}`)).json()).toMatchObject({ version: 1, status: "COMPLETED", reviewRationale: "Second review" });
    expect((await request("GET", `/ai-risk-assessments/${randomUUID()}`)).statusCode).toBe(404);
  });
});
