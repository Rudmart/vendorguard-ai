import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { prisma } from "@vendorguard/database";
import { createSessionCookie } from "@vendorguard/auth";
import { server } from "./index.js";
import { nextDueDate } from "./aiMonitoring.js";

let tenantAId: string;
let tenantBId: string;
let adminA: string;
let readOnlyA: string;
let adminB: string;
let fwId: string;
let ctrlId: string;
const sys: Record<string, string> = {};
const stamp = Date.now();
const DAY = 24 * 3600 * 1000;
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.41." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookie(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test", role });
}
async function call(method: "GET" | "PUT" | "POST", url: string, userId?: string, role?: string, tenantId?: string, payload?: Record<string, unknown>) {
  const res = await server.inject({
    method,
    url,
    cookies: userId && role ? { vg_session: cookie(userId, role, tenantId ?? tenantAId) } : {},
    payload,
    remoteAddress: nextIp(),
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
const get = (url: string, userId?: string, role?: string, tenantId?: string) => call("GET", url, userId, role, tenantId);

async function system(tenantId: string, name: string) {
  const s = await prisma.aiSystem.create({ data: { tenantId, name, origin: "INTERNAL" as never, dataCategories: [], affectedPopulation: [], regulatoryRelevance: [] } });
  return s.id;
}
async function riskAssessment(tenantId: string, aiSystemId: string, version: number, status: string, riskTitle: string) {
  const ra = await prisma.aiRiskAssessment.create({ data: { tenantId, aiSystemId, name: `RA v${version}`, version, status: status as never, assessorUserId: adminA } });
  await prisma.aiRisk.create({
    data: { tenantId, assessmentId: ra.id, title: riskTitle, category: "OPERATIONAL" as never, statement: "x", likelihood: 3, impact: 3, inherentScore: 9, inherentRating: "MODERATE" as never, residualLikelihood: 2, residualImpact: 2, residualScore: 4, residualRating: "LOW" as never },
  });
  return ra.id;
}
async function impact(tenantId: string, aiSystemId: string, version: number, status: string) {
  return prisma.aiImpactAssessment.create({ data: { tenantId, aiSystemId, name: `IA v${version}`, version, status: status as never, assessorUserId: adminA } });
}

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "PB Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "PB Tenant B" } })).id;
  const mk = async (label: string, tenantId: string, role: string) => {
    const u = await prisma.user.create({ data: { externalId: `pb-${label}-${stamp}`, email: `pb-${label}-${stamp}@example.com`, displayName: `PB ${label}` } });
    await prisma.tenantMembership.create({ data: { userId: u.id, tenantId, role: role as never } });
    return u.id;
  };
  adminA = await mk("admin", tenantAId, "ADMIN");
  readOnlyA = await mk("readonly", tenantAId, "READ_ONLY");
  adminB = await mk("adminb", tenantBId, "ADMIN");

  sys.s1 = await system(tenantAId, "PB S1");
  sys.s2 = await system(tenantAId, "PB S2");
  sys.s3 = await system(tenantAId, "PB S3");
  sys.s4 = await system(tenantAId, "PB S4");
  sys.b = await system(tenantBId, "PB B");
  await riskAssessment(tenantAId, sys.s1, 1, "COMPLETED", "S1v1");
  await riskAssessment(tenantAId, sys.s2, 1, "COMPLETED", "S2v1");
  await riskAssessment(tenantAId, sys.s2, 2, "COMPLETED", "S2v2");
  await riskAssessment(tenantAId, sys.s3, 1, "COMPLETED", "S3v1");
  await riskAssessment(tenantAId, sys.s3, 2, "IN_PROGRESS", "S3v2");
  await riskAssessment(tenantAId, sys.s4, 1, "IN_PROGRESS", "S4v1");
  await riskAssessment(tenantBId, sys.b, 1, "COMPLETED", "Bv1");
  await impact(tenantAId, sys.s2, 1, "COMPLETED");
  await impact(tenantAId, sys.s2, 2, "COMPLETED");
  await impact(tenantAId, sys.s3, 1, "COMPLETED");
  await impact(tenantAId, sys.s3, 2, "IN_PROGRESS");
  await impact(tenantBId, sys.b, 1, "COMPLETED");

  const fw = await prisma.framework.create({ data: { catalogId: `s8-test-pb-${stamp}`, name: "PB Framework", scope: "VENDOR_ASSESSMENT", industries: ["GENERAL"] } });
  fwId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId: fw.id, version: "1.0", isCurrent: true } });
  ctrlId = (await prisma.control.create({ data: { frameworkVersionId: version.id, controlId: "PB-1", title: "PB control", summary: "x", domain: "x", expectedEvidenceTypes: [], validationGuidance: "n/a" } })).id;
  expect((await call("PUT", `/ai-systems/${sys.s1}/framework-applicability/${fwId}`, adminA, "ADMIN", tenantAId, { status: "APPLICABLE", rationale: "x" })).status).toBe(201);
  expect((await call("POST", `/ai-systems/${sys.s1}/controls`, adminA, "ADMIN", tenantAId, { controlIds: [ctrlId] })).status).toBe(201);
  const rec = await prisma.aiSystemControl.findUniqueOrThrow({ where: { aiSystemId_controlId: { aiSystemId: sys.s1, controlId: ctrlId } } });
  for (const [i, status] of ["OPEN", "PENDING_REVIEW", "CLOSED", "DISMISSED"].entries()) {
    const test = await prisma.aiControlTest.create({
      data: { tenantId: tenantAId, aiSystemControlId: rec.id, testerUserId: adminA, status: "COMPLETED" as never, method: "SAMPLE_TESTING" as never, procedure: "x", testDate: new Date(), designEffectiveness: "EFFECTIVE" as never, operatingEffectiveness: "INEFFECTIVE" as never, overallEffectiveness: "INEFFECTIVE" as never },
    });
    const finding = await prisma.governanceFinding.create({
      data: { tenantId: tenantAId, aiControlTestId: test.id, title: `F-${status}`, description: "x", severity: (i === 0 ? "HIGH" : "LOW") as never, status: status as never, createdByUserId: adminA, ownerUserId: adminA },
    });
    if (status === "OPEN") {
      await prisma.remediationAction.create({ data: { tenantId: tenantAId, governanceFindingId: finding.id, title: "Fix", description: "x", status: "IN_PROGRESS" as never } });
    }
  }

  const check = (title: string, createdDaysAgo: number, active = true, tenantId = tenantAId, aiSystemId: string = sys.s1 ?? "") =>
    prisma.aiMonitoringCheck.create({
      data: { tenantId, aiSystemId, title, whatToReview: "x", expectation: "x", category: "HUMAN_OVERSIGHT" as never, cadence: "MONTHLY" as never, ownerUserId: adminA, createdByUserId: adminA, active, createdAt: new Date(Date.now() - createdDaysAgo * DAY) },
    });
  await check("C-notdue", 0);
  await check("C-overdue", 70);
  await check("C-duesoon", 27);
  await check("C-inactive", 0, false);
  await check("C-tenantB", 70, true, tenantBId, sys.b);

  const reassess = (aiSystemId: string, status: string, completedDaysAgo: number | null, tenantId = tenantAId) =>
    prisma.aiReassessment.create({
      data: {
        tenantId,
        aiSystemId,
        reason: "PERIODIC_REVIEW" as never,
        status: status as never,
        openCycleKey: status === "IN_PROGRESS" ? aiSystemId : null,
        whatChanged: "x",
        snapshotAtStart: {} as never,
        initiatedByUserId: adminA,
        completedAt: completedDaysAgo === null ? null : new Date(Date.now() - completedDaysAgo * DAY),
        conclusion: (status === "COMPLETED" ? "NO_MATERIAL_CHANGE" : null) as never,
      },
    });
  await reassess(sys.s2, "COMPLETED", 10);
  await reassess(sys.s1, "IN_PROGRESS", null);
  await reassess(sys.s3, "COMPLETED", 1);
  await reassess(sys.b, "IN_PROGRESS", null, tenantBId);
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.aiReassessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiMonitoringCheck.deleteMany({ where: { tenantId: tenants } });
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
  await prisma.governanceFinding.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiControlTest.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemControl.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystemFrameworkApplicability.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.framework.deleteMany({ where: { id: fwId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA, readOnlyA, adminB] } } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

const ROUTES = ["/ai-risks", "/ai-risk-assessments", "/ai-impact-assessments", "/governance-findings", "/ai-monitoring-checks", "/ai-reassessments"];

describe("Phase B global lists - access", () => {
  it("require a valid signed session (401), ai-system:read (403), and allow read roles", async () => {
    for (const url of ROUTES) {
      expect((await get(url)).status, url).toBe(401);
      // Security fix: the database role is authoritative - a signed cookie claiming a fake role (NO_ACCESS)
      // for a user whose membership is ADMIN is ignored, so the ADMIN read succeeds.
      expect((await get(url, adminA, "NO_ACCESS")).status, url).toBe(200);
      expect((await get(url, readOnlyA, "READ_ONLY")).status, url).toBe(200);
    }
  });
});

describe("Risk Register - latest assessed posture", () => {
  it("default: latest completed per system; draft fallback labeled; no other tenant", async () => {
    const res = await get("/ai-risks", readOnlyA, "READ_ONLY");
    const titles = res.body.risks.map((r: { title: string }) => r.title).sort();
    expect(titles).toEqual(["S1v1", "S2v2", "S3v1", "S4v1"]);
    const s4 = res.body.risks.find((r: { title: string }) => r.title === "S4v1");
    expect(s4.assessment.posture).toBe("DRAFT_NO_COMPLETED_ASSESSMENT");
    expect(res.body.risks.find((r: { title: string }) => r.title === "S3v1").assessment.posture).toBe("LATEST_ASSESSED");
  });

  it("scope=all shows history with version context", async () => {
    const res = await get("/ai-risks?scope=all", readOnlyA, "READ_ONLY");
    const byTitle = new Map(res.body.risks.map((r: { title: string; assessment: { version: number; posture: string } }) => [r.title, r.assessment]));
    expect(Array.from(byTitle.keys()).sort()).toEqual(["S1v1", "S2v1", "S2v2", "S3v1", "S3v2", "S4v1"]);
    expect(byTitle.get("S2v1")).toMatchObject({ version: 1, posture: "OTHER_VERSION" });
    expect(byTitle.get("S3v2")).toMatchObject({ version: 2, posture: "OTHER_VERSION" });
  });
});

describe("Assessment lists", () => {
  it("risk assessments: all versions, latest completed marked, tenant scoped", async () => {
    const rows = (await get("/ai-risk-assessments", adminA, "ADMIN")).body.assessments as { aiSystem: { name: string }; version: number; isLatestCompleted: boolean }[];
    expect(rows.some((r) => r.aiSystem.name === "PB B")).toBe(false);
    const flag = (name: string, v: number) => rows.find((r) => r.aiSystem.name === name && r.version === v)?.isLatestCompleted;
    expect(flag("PB S2", 2)).toBe(true);
    expect(flag("PB S2", 1)).toBe(false);
    expect(flag("PB S3", 1)).toBe(true);
    expect(flag("PB S3", 2)).toBe(false);
    expect(flag("PB S4", 1)).toBe(false);
  });

  it("impact assessments: same conventions", async () => {
    const rows = (await get("/ai-impact-assessments", adminA, "ADMIN")).body.assessments as { aiSystem: { name: string }; version: number; isLatestCompleted: boolean }[];
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.aiSystem.name === "PB S2" && r.version === 2)?.isLatestCompleted).toBe(true);
    expect(rows.find((r) => r.aiSystem.name === "PB S3" && r.version === 2)?.isLatestCompleted).toBe(false);
  });
});

describe("Findings", () => {
  it("default = OPEN + PENDING_REVIEW with remediation status; all = 4; other tenant empty", async () => {
    const active = (await get("/governance-findings", adminA, "ADMIN")).body.findings as { title: string; status: string; remediation: { status: string } | null; aiSystem: { name: string } }[];
    expect(active.map((f) => f.status).sort()).toEqual(["OPEN", "PENDING_REVIEW"]);
    expect(active.find((f) => f.status === "OPEN")?.remediation?.status).toBe("IN_PROGRESS");
    expect(active[0]?.aiSystem.name).toBe("PB S1");
    expect((await get("/governance-findings?status=all", adminA, "ADMIN")).body.findings).toHaveLength(4);
    expect((await get("/governance-findings", adminB, "ADMIN", tenantBId)).body.findings).toEqual([]);
  });
});

describe("Governance Monitoring", () => {
  it("orders OVERDUE -> DUE_SOON -> NOT_DUE, excludes inactive by default, reuses Step 15 helpers", async () => {
    const rows = (await get("/ai-monitoring-checks", adminA, "ADMIN")).body.checks as { title: string; dueState: string; nextDueAt: string }[];
    expect(rows.map((r) => r.title)).toEqual(["C-overdue", "C-duesoon", "C-notdue"]);
    expect(rows.map((r) => r.dueState)).toEqual(["OVERDUE", "DUE_SOON", "NOT_DUE"]);
    const stored = await prisma.aiMonitoringCheck.findFirstOrThrow({ where: { tenantId: tenantAId, title: "C-overdue" } });
    expect(new Date(rows[0]?.nextDueAt ?? "").getTime()).toBe(nextDueDate(stored.createdAt, "MONTHLY").getTime());
    const all = (await get("/ai-monitoring-checks?active=all", adminA, "ADMIN")).body.checks as { title: string; dueState: string }[];
    expect(all.at(-1)).toMatchObject({ title: "C-inactive", dueState: "INACTIVE" });
  });
});

describe("Reassessments", () => {
  it("in progress first, then completed newest first; tenant scoped", async () => {
    const rows = (await get("/ai-reassessments", adminA, "ADMIN")).body.reassessments as { aiSystem: { name: string }; status: string }[];
    expect(rows.map((r) => r.aiSystem.name)).toEqual(["PB S1", "PB S3", "PB S2"]);
    expect(rows[0]?.status).toBe("IN_PROGRESS");
  });
});

describe("Phase B navigation", () => {
  it("adds the new AI Risk and Monitoring pages, each backed by a real page", () => {
    const webApp = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "app");
    const sidebar = readFileSync(join(webApp, "sidebar.tsx"), "utf8");
    for (const [label, href] of [["Risk Register", "/risk-register"], ["Risk Assessments", "/risk-assessments"], ["Impact Assessments", "/impact-assessments"], ["Findings", "/findings"], ["Governance Monitoring", "/governance-monitoring"], ["Reassessments", "/reassessments"], ["AI Incidents", "/ai-incidents"]]) {
      expect(sidebar).toContain(`label: "${label}", href: "${href}"`);
      expect(existsSync(join(webApp, (href ?? "").slice(1), "page.tsx")), href).toBe(true);
    }
    expect(sidebar).toContain('title: "Monitoring",');
    expect(sidebar).toContain('label: "AI Incidents", href: "/ai-incidents"');
    expect(sidebar).not.toContain('"/evidence"');
  });
});