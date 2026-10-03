import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";

const stamp = Date.now();
const DAY = 24 * 3600 * 1000;
const u: Record<string, string> = {};
const id: Record<string, string> = {};
let tA = "";
let tB = "";
let tC = "";
let fwId = "";
let ip = 0;
function nextIp() {
  ip += 1;
  return "10.51." + Math.floor(ip / 250) + "." + (ip % 250);
}
async function call(method: "GET" | "PUT" | "POST", url: string, user?: string, role?: string, tenantId?: string, payload?: Record<string, unknown>) {
  const res = await server.inject({ method, url, payload, remoteAddress: nextIp(), cookies: user && role ? { vg_session: createSessionCookie({ userId: user, tenantId: tenantId ?? tA, email: `${user}@example.com`, displayName: "T", role }) } : {} });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

beforeAll(async () => {
  tA = (await prisma.tenant.create({ data: { name: "PC A" } })).id;
  tB = (await prisma.tenant.create({ data: { name: "PC B" } })).id;
  tC = (await prisma.tenant.create({ data: { name: "PC C" } })).id;
  const mk = async (k: string, tenantId: string, role: string) => {
    const x = await prisma.user.create({ data: { externalId: `pc-${k}-${stamp}`, email: `pc-${k}-${stamp}@example.com`, displayName: `PC ${k}` } });
    await prisma.tenantMembership.create({ data: { userId: x.id, tenantId, role: role as never } });
    u[k] = x.id;
  };
  await mk("admin", tA, "ADMIN");
  await mk("reviewer", tA, "REVIEWER");
  await mk("analyst", tA, "ANALYST");
  await mk("readonly", tA, "READ_ONLY");
  await mk("adminB", tB, "ADMIN");
  await mk("adminC", tC, "ADMIN");
  const sys = (await prisma.aiSystem.create({ data: { tenantId: tA, name: "PC S1", origin: "INTERNAL" as never, dataCategories: [], affectedPopulation: [], regulatoryRelevance: [] } })).id;
  const sysB = (await prisma.aiSystem.create({ data: { tenantId: tB, name: "PC SB", origin: "INTERNAL" as never, dataCategories: [], affectedPopulation: [], regulatoryRelevance: [] } })).id;
  id.sys = sys;

  const fw = await prisma.framework.create({ data: { catalogId: `s8-test-pc-${stamp}`, name: "PC FW", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const ver = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  const ctrl = await prisma.control.create({ data: { frameworkVersionId: ver.id, controlId: "PC-1", title: "PC control", summary: "x", domain: "x", expectedEvidenceTypes: [], validationGuidance: "n/a" } });
  expect((await call("PUT", `/ai-systems/${sys}/framework-applicability/${fwId}`, u.admin, "ADMIN", tA, { status: "APPLICABLE", rationale: "x" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sys}/controls`, u.admin, "ADMIN", tA, { controlIds: [ctrl.id] })).status).toBe(201);
  const rec = await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sys, controlId: ctrl.id } } });
  id.rec = rec.id;
  for (const [k, who, role] of [["link1", u.analyst, "ANALYST"], ["link2", u.admin, "ADMIN"]] as const) {
    const doc = await call("POST", `/ai-systems/${sys}/evidence`, who, role, tA, { displayFilename: `${k}.pdf`, documentType: "Policy" });
    const link = await call("POST", `/ai-system-controls/${rec.id}/evidence`, who, role, tA, { evidenceDocumentId: doc.body.id });
    expect(link.status).toBe(201);
    id[k] = link.body.id;
  }
  const test = async () =>
    (await prisma.aiControlTest.create({ data: { tenantId: tA, aiSystemControlId: rec.id, testerUserId: u.reviewer ?? "", status: "COMPLETED" as never, method: "SAMPLE_TESTING" as never, procedure: "x", testDate: new Date(), designEffectiveness: "EFFECTIVE" as never, operatingEffectiveness: "INEFFECTIVE" as never, overallEffectiveness: "INEFFECTIVE" as never } })).id;
  const finding = async (status: string, createdBy: string, owner: string | null) =>
    (await prisma.governanceFinding.create({ data: { tenantId: tA, aiControlTestId: await test(), title: `F-${status}-${stamp}`, description: "x", severity: "HIGH" as never, status: status as never, createdByUserId: createdBy, ownerUserId: owner } })).id;
  id.f1 = await finding("PENDING_REVIEW", u.reviewer ?? "", null);
  id.f2 = await finding("OPEN", u.admin ?? "", u.analyst ?? "");
  id.f3 = await finding("OPEN", u.admin ?? "", u.analyst ?? "");
  id.r1 = (await prisma.remediationAction.create({ data: { tenantId: tA, governanceFindingId: id.f2, title: "R1", description: "x", status: "PENDING_VERIFICATION" as never, ownerUserId: u.reviewer } })).id;
  id.r2 = (await prisma.remediationAction.create({ data: { tenantId: tA, governanceFindingId: id.f3, title: "R2", description: "x", status: "IN_PROGRESS" as never, ownerUserId: u.analyst } })).id;

  const ra = async (version: number, status: string, assessor: string, tenantId = tA, aiSystemId = sys) =>
    (await prisma.aiRiskAssessment.create({ data: { tenantId, aiSystemId, name: `RA v${version}`, version, status: status as never, assessorUserId: assessor } })).id;
  const risk = async (assessmentId: string, title: string, owner: string | null, tenantId = tA) =>
    (await prisma.aiRisk.create({ data: { tenantId, assessmentId, title, category: "OPERATIONAL" as never, statement: "x", likelihood: 3, impact: 3, inherentScore: 9, inherentRating: "MODERATE" as never, residualLikelihood: 2, residualImpact: 2, residualScore: 4, residualRating: "LOW" as never, treatmentOwnerUserId: owner } })).id;
  id.ra1 = await ra(1, "COMPLETED", u.analyst ?? "");
  id.riskOld = await risk(id.ra1, "Old", u.analyst ?? "");
  id.ra2 = await ra(2, "COMPLETED", u.analyst ?? "");
  id.riskCur = await risk(id.ra2, "Current", u.analyst ?? "");
  id.ra3 = await ra(3, "READY_FOR_REVIEW", u.reviewer ?? "");
  id.rem3 = (await prisma.remediationAction.create({ data: { tenantId: tA, aiRiskId: id.riskCur, title: "Closed", description: "x", status: "CLOSED" as never, ownerUserId: u.analyst } })).id;
  id.ia1 = (await prisma.aiImpactAssessment.create({ data: { tenantId: tA, aiSystemId: sys, name: "IA v1", version: 1, status: "READY_FOR_REVIEW" as never, assessorUserId: u.admin } })).id;
  id.ia2 = (await prisma.aiImpactAssessment.create({ data: { tenantId: tA, aiSystemId: sys, name: "IA v2", version: 2, status: "DRAFT" as never, assessorUserId: u.analyst } })).id;
  id.pa = (await prisma.riskAcceptance.create({ data: { tenantId: tA, aiRiskId: id.riskCur, status: "PENDING_REVIEW" as never, justification: "x", requestedByUserId: u.admin, expiresAt: new Date(Date.now() + 90 * DAY) } })).id;
  const raB = await ra(1, "COMPLETED", u.adminB ?? "", tB, sysB);
  const riskB = await risk(raB, "B risk", null, tB);
  id.paB = (await prisma.riskAcceptance.create({ data: { tenantId: tB, aiRiskId: riskB, status: "PENDING_REVIEW" as never, justification: "x", requestedByUserId: u.adminB, expiresAt: new Date(Date.now() + 90 * DAY) } })).id;
  id.check = (await prisma.aiMonitoringCheck.create({ data: { tenantId: tA, aiSystemId: sys, title: "PC check", whatToReview: "x", expectation: "x", category: "HUMAN_OVERSIGHT" as never, cadence: "MONTHLY" as never, ownerUserId: u.analyst ?? "", createdByUserId: u.admin ?? "", createdAt: new Date(Date.now() - 70 * DAY) } })).id;
  await prisma.aiReassessment.create({ data: { tenantId: tA, aiSystemId: sys, reason: "OTHER" as never, status: "IN_PROGRESS" as never, openCycleKey: sys, whatChanged: "x", snapshotAtStart: {} as never, initiatedByUserId: u.analyst ?? "", targetDate: new Date(Date.now() - DAY) } });
});

afterAll(async () => {
  const tenants = { in: [tA, tB, tC] };
  await prisma.aiReassessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiMonitoringCheck.deleteMany({ where: { tenantId: tenants } });
  await prisma.riskAcceptance.deleteMany({ where: { tenantId: tenants } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlTest.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlEvidenceReview.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControlEvidence.deleteMany({ where: { tenantId: tenants } });
  await prisma.evidenceDocument.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.framework.deleteMany({ where: { id: fwId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(u) } } });
  await prisma.tenant.deleteMany({ where: { id: tenants } });
});

describe("Pending Reviews - permission + SoD + lifecycle + tenant", () => {
  it("requires a session", async () => {
    for (const url of ["/reviews/pending", "/my-work", "/dashboard/summary"]) {
      expect((await call("GET", url)).status, url).toBe(401);
    }
  });

  it("REVIEWER sees only decisions they may make", async () => {
    const res = await call("GET", "/reviews/pending", u.reviewer, "REVIEWER");
    const got = ids(res.body);
    for (const k of ["link1", "link2", "ia1", "pa"]) expect(got, k).toContain(id[k]);
    expect(got).not.toContain(id.f1); // reviewer created the Finding
    expect(got).not.toContain(id.r1); // reviewer owns the remediation
    expect(got).not.toContain(id.ra3); // reviewer is the assessor
    expect(got).not.toContain(id.paB); // other tenant
    expect(got).not.toContain(id.ia2); // DRAFT, not ready for review
    const ev = res.body.items.find((i: { id: string }) => i.id === id.link1);
    expect(ev.href).toBe(`/ai-system-controls/${id.rec}/evidence`);
  });

  it("ADMIN sees the complementary set", async () => {
    const got = ids((await call("GET", "/reviews/pending", u.admin, "ADMIN")).body);
    for (const k of ["link1", "f1", "r1", "ra3"]) expect(got, k).toContain(id[k]);
    expect(got).not.toContain(id.link2); // admin submitted/uploaded it
    expect(got).not.toContain(id.pa); // admin requested it
    expect(got).not.toContain(id.ia1); // admin is the assessor
  });

  it("roles without review permissions see nothing", async () => {
    expect((await call("GET", "/reviews/pending", u.analyst, "ANALYST")).body.items).toEqual([]);
    expect((await call("GET", "/reviews/pending", u.readonly, "READ_ONLY")).body.items).toEqual([]);
  });
});

describe("My Work - current user's own open work only", () => {
  it("ANALYST: owned Findings, open remediation, latest-assessment risk, monitoring, draft assessment", async () => {
    const got = ids((await call("GET", "/my-work", u.analyst, "ANALYST")).body);
    for (const k of ["f2", "f3", "r2", "riskCur", "check", "ia2"]) expect(got, k).toContain(id[k]);
    expect(got).not.toContain(id.riskOld); // older assessment version
    expect(got).not.toContain(id.rem3); // closed
    expect(got).not.toContain(id.r1); // someone else's
  });

  it("REVIEWER: only their own remediation (waiting for verification)", async () => {
    const items = (await call("GET", "/my-work", u.reviewer, "REVIEWER")).body.items as { id: string; state: string }[];
    expect(items.map((i) => i.id)).toEqual([id.r1]);
    expect(items[0]?.state).toContain("waiting");
  });
});

describe("Dashboard summary", () => {
  it("counts the tenant's records with latest-assessed semantics", async () => {
    const d = (await call("GET", "/dashboard/summary", u.reviewer, "REVIEWER")).body;
    expect(d.posture.aiSystems).toBe(1);
    expect(d.attention.findingsOpen).toBe(2);
    expect(d.attention.findingsPendingReview).toBe(1);
    expect(d.attention.criticalOrHighOpenFindings).toBe(2);
    expect(d.attention.remediationAwaitingVerification).toBe(1);
    expect(d.attention.riskAcceptancePending).toBe(1);
    expect(d.attention.monitoringOverdue).toBe(1);
    expect(d.attention.reassessmentsPastTarget).toBe(1);
    expect(d.attention.pendingReviewsForMe).toBe(4);
    expect(d.posture.latestAssessedResidualRisk.LOW).toBe(1); // only v2's risk, not v1's
    expect(d.posture.withoutCompletedImpactAssessment).toBe(1);
  });

  it("is empty for an empty tenant", async () => {
    const d = (await call("GET", "/dashboard/summary", u.adminC, "ADMIN", tC)).body;
    expect(d.posture.aiSystems).toBe(0);
    expect(d.attention.findingsOpen).toBe(0);
    expect(d.attention.pendingReviewsForMe).toBe(0);
  });
});