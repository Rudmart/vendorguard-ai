import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, afterEach, it as test, expect, vi } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import type { GovernanceReport, ReportRecords } from "@vendorguard/shared";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";
import * as governancePdf from "./aiGovernanceReportPdf.js";
import * as vendorPdf from "./executiveReportPdf.js";
import { buildExecutiveReport } from "./executiveReport.js";

const tenants: string[] = [], users: string[] = [], systems: string[] = [];
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};
const DAY = 86400000;
let frameworkId: string, controlId: string, vendorId: string, ip = 0, failAudit = false, failSource = false;
const pending = new Set<Promise<unknown>>();
function track<T>(p: Promise<T>): Promise<T> { pending.add(p); void p.then(() => pending.delete(p), () => pending.delete(p)); return p; }
function it(name: string, body: () => Promise<void>) { test(name, () => track(Promise.resolve().then(body))); }
async function drain() { while (pending.size) await Promise.allSettled([...pending]); }
beforeEach(drain);
afterEach(async () => { await drain(); failAudit = false; failSource = false; vi.restoreAllMocks(); });
function get(url: string, role = "ADMIN") { return track(Promise.resolve(server.inject({ method: "GET", url, cookies: role === "NONE" ? {} : { vg_session: cookies[role]! }, remoteAddress: `10.194.${Math.floor(++ip / 250)}.${ip % 250}` }))); }
async function report(query = "", role = "ADMIN") { const res = await get("/reports/ai-governance" + query, role); expect(res.statusCode).toBe(200); return res.json<GovernanceReport>(); }
function metric(data: GovernanceReport, key: string) { const m = data.metrics.find(x => x.key === key); expect(m?.access, key).toBe("AVAILABLE"); if (m?.access !== "AVAILABLE") throw Error(key); return m; }
// Decode PDFKit text operators for content assertions, not visual/layout assurance.
function pdfText(bytes: Buffer) {
  const output: string[] = [];
  for (const match of bytes.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content = Buffer.from(match[1]!, "latin1");
    try { content = inflateSync(content); } catch { /* Uncompressed PDF content. */ }
    for (const line of content.toString("latin1").matchAll(/\[([^\]]+)\]\s*TJ/g)) output.push([...line[1]!.matchAll(/<([0-9a-f]+)>/gi)].map(x => Buffer.from(x[1]!, "hex").toString("latin1")).join(""));
  }
  return output.join("\n");
}
const exportDir = join(tmpdir(), "vg-section18", "exports");
function renderedReport(data: GovernanceReport) {
  const source = readFileSync(new URL("../../web/src/app/reports/ai-governance/report-sections.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("report-sections.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ReportSections");
  if (!component) throw Error("Report component missing");
  const script = ts.transpileModule(component.getText(parsed).replace("export default ", "") + "\nglobalThis.component = ReportSections;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
  const react = webRequire("react");
  const context = { React: react, muted: {}, component: undefined };
  runInNewContext(script, context);
  return webRequire("react-dom/server").renderToStaticMarkup(react.createElement(context.component, { report: data })) as string;
}
beforeAll(async () => {
  for (const label of ["A", "B", "Empty"]) tenants.push((await prisma.tenant.create({ data: { name: `Section18 reporting ${label}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID(), tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!, actualRole = role === "FOREIGN" ? "ADMIN" : role;
    const user = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section18.example.test`, displayName: role } }); users.push(user.id);
    await prisma.tenantMembership.create({ data: { tenantId, userId: user.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: user.id, role: actualRole, email: user.email, displayName: role });
  }
  await prisma.tenantMembership.create({ data: { tenantId: tenants[2]!, userId: users[0]!, role: "ADMIN" } });
  cookies.EMPTY = await issueTestSessionCookie({ tenantId: tenants[2]!, userId: users[0]!, role: "ADMIN", email: "empty@section18.example.test", displayName: "Empty" });
  for (const lifecycleStatus of ["PRODUCTION", "SUSPENDED", "RETIRED"] as const) systems.push((await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: `Section18 ${lifecycleStatus}`, origin: "INTERNAL", lifecycleStatus, ownerUserId: users[1]!, ...(lifecycleStatus === "RETIRED" ? { retiredAt: new Date() } : {}) } })).id);
  ids.foreignSystem = (await prisma.aiSystem.create({ data: { tenantId: tenants[1]!, name: "FOREIGN-SECTION18-SECRET", origin: "INTERNAL", lifecycleStatus: "PRODUCTION" } })).id;
  for (const [key, aiSystemId, version, status] of [["old", systems[0]!, 1, "COMPLETED"], ["latest", systems[0]!, 2, "COMPLETED"], ["draft", systems[0]!, 3, "READY_FOR_REVIEW"], ["retired", systems[2]!, 1, "COMPLETED"]] as const) ids[key] = (await prisma.aiRiskAssessment.create({ data: { tenantId: tenants[0]!, aiSystemId, version, status, name: `Section18 ${key}`, assessorUserId: users[1]! } })).id;
  for (const [key, assessmentId, residualRating] of [["oldRisk", ids.old!, "CRITICAL"], ["latestRisk", ids.latest!, "LOW"], ["draftRisk", ids.draft!, "HIGH"], ["retiredRisk", ids.retired!, "HIGH"]] as const) ids[key] = (await prisma.aiRisk.create({ data: { tenantId: tenants[0]!, assessmentId, title: `Section18 ${key}`, category: "OPERATIONAL", statement: "Disposable", likelihood: 2, impact: 2, inherentScore: 4, inherentRating: "LOW", residualRating } })).id;
  const impact = await prisma.aiImpactAssessment.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, name: "Section18 impact", version: 1, status: "COMPLETED" } });
  ids.impact = impact.id;
  for (const direction of ["BENEFICIAL", "ADVERSE"] as const) await prisma.aiImpact.create({ data: { tenantId: tenants[0]!, assessmentId: impact.id, title: `Section18 ${direction}`, description: "Disposable", category: "OPERATIONAL", direction, affectedPopulation: "CUSTOMERS", severity: 3, scale: "LIMITED", reversibility: "REVERSIBLE" } });
  for (const status of ["DRAFT", "PENDING_REVIEW", "APPROVED"] as const) await prisma.aiUseCase.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, name: `Section18 ${status}`, businessPurpose: "Disposable", affectedParties: [], status, createdByUserId: users[1]!, ownerUserId: users[1]! } });
  const fw = await prisma.framework.create({ data: { tenantId: tenants[0]!, catalogId: `s8-test-section18-${randomUUID()}`, name: "Section18 framework", scope: "VENDOR_ASSESSMENT", industries: [] } }); frameworkId = fw.id;
  const version = await prisma.frameworkVersion.create({ data: { frameworkId, version: "1.0", isCurrent: true } });
  controlId = (await prisma.control.create({ data: { frameworkVersionId: version.id, controlId: "S18", title: "Section18 control", summary: "Disposable", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "Test", severity: "HIGH" } })).id;
  for (const [index, aiSystemId] of systems.entries()) {
    const applicability = await prisma.aiSystemFrameworkApplicability.create({ data: { tenantId: tenants[0]!, aiSystemId, frameworkId, status: "APPLICABLE", rationale: "Disposable", determinedAt: new Date() } });
    ids[`control${index}`] = (await prisma.aiSystemControl.create({ data: { tenantId: tenants[0]!, aiSystemId, controlId, sourceApplicabilityId: applicability.id, applicability: "APPLICABLE" } })).id;
  }
  for (const [index, status] of ["PENDING_REVIEW", "OPEN", "DISMISSED", "CLOSED"].entries()) {
    const controlTest = await prisma.aiControlTest.create({ data: { tenantId: tenants[0]!, aiSystemControlId: ids.control0!, testerUserId: users[1]!, status: "COMPLETED", method: "DOCUMENT_REVIEW", procedure: "Disposable", testDate: new Date(Date.now() - index * DAY), overallEffectiveness: "INEFFECTIVE" } });
    ids[`finding${index}`] = (await prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, aiControlTestId: controlTest.id, title: `Section18 ${status}`, description: "Disposable", severity: "HIGH", status: status as "OPEN", createdByUserId: users[1]! } })).id;
  }
  for (const [index, status] of ["OPEN", "PENDING_VERIFICATION", "CLOSED"].entries()) ids[`rem${index}`] = (await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, governanceFindingId: ids[`finding${index}`], title: `Section18 remediation ${status}`, description: "Disposable", status: status as "OPEN", dueDate: new Date(Date.now() - DAY), ownerUserId: users[1]! } })).id;
  ids.retiredRem = (await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, aiRiskId: ids.retiredRisk!, title: "Section18 historical obligation", description: "Disposable", status: "OPEN" } })).id;
  for (const [index, state] of ["UPLOADED", "INDEXED", "QUARANTINED"].entries()) {
    const doc = await prisma.evidenceDocument.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, displayFilename: `Section18 evidence ${state}`, storageKey: `S18-NEVER-EXPOSE-${randomUUID()}`, sha256Hash: "e".repeat(64), sizeBytes: 1, mimeType: "text/plain", documentType: "OTHER", state: state as "UPLOADED", uploadedByUserId: users[1]!, expirationDate: index === 0 ? new Date(Date.now() - DAY) : null } });
    ids[`evidence${index}`] = doc.id;
  }
  await prisma.aiSystemControlEvidence.create({ data: { tenantId: tenants[0]!, aiSystemControlId: ids.control0!, evidenceDocumentId: ids.evidence0!, status: "PENDING_REVIEW", submittedByUserId: users[1]! } });
  for (const active of [true, false]) await prisma.aiMonitoringCheck.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, title: "Section18 monitor", whatToReview: "Disposable", expectation: "Disposable", category: "OTHER", cadence: "MONTHLY", ownerUserId: users[1]!, createdByUserId: users[1]!, active, createdAt: new Date(Date.now() - 90 * DAY) } });
  for (const status of ["OPEN", "CLOSED"] as const) await prisma.aiIncident.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, title: `Section18 incident ${status}`, description: "Disposable", severity: "HIGH", status, detectedAt: new Date(), reporterUserId: users[1]! } });
  for (const [index, status] of ["PENDING_REVIEW", "APPROVED", "REJECTED"].entries()) await prisma.riskAcceptance.create({ data: { tenantId: tenants[0]!, aiRiskId: ids.latestRisk!, status: status as "APPROVED", justification: "Disposable", requestedByUserId: users[1]!, expiresAt: new Date(Date.now() + (index === 1 ? -DAY : DAY)) } });
  vendorId = (await prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section18 vendor", serviceDescription: "Disposable", serviceCategory: "Test", criticality: "LOW", aiFunctionality: true } })).id;
  await prisma.vendor.create({ data: { tenantId: tenants[1]!, legalName: "FOREIGN-VENDOR-SECTION18", serviceDescription: "Disposable", serviceCategory: "Test", criticality: "LOW" } });
  await prisma.aiSystemVendor.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, vendorId, role: "PRIMARY_PROVIDER" } });
  ids.inactiveVendor = (await prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section18 offboarded vendor", serviceDescription: "Disposable", serviceCategory: "Test", criticality: "LOW", deletedAt: new Date(), aiFunctionality: true } })).id;
  await prisma.aiSystemVendor.create({ data: { tenantId: tenants[0]!, aiSystemId: systems[0]!, vendorId: ids.inactiveVendor, role: "MODEL_PROVIDER" } });
  const assessment = await prisma.assessment.create({ data: { tenantId: tenants[0]!, vendorId, scoringModelVersion: "section18", startedByUserId: users[1]! } }); ids.vendorAssessment = assessment.id;
  ids.rating = (await prisma.riskRating.create({ data: { tenantId: tenants[0]!, assessmentId: assessment.id, inherentScore: 75, controlEffectiveness: 40, residualScore: 45, finalRating: "MODERATE", factorInputsJson: {}, weightsUsedJson: {}, createdByUserId: users[1]! } })).id;
  for (const status of ["PASS", "FAIL", "INSUFFICIENT_EVIDENCE"] as const) {
    const v = await prisma.frameworkVersion.findFirstOrThrow({ where: { frameworkId } });
    const c = await prisma.control.create({ data: { frameworkVersionId: v.id, controlId: `S18-${status}`, title: `Section18 ${status}`, summary: "Disposable", domain: "Test", expectedEvidenceTypes: [], validationGuidance: "Test", severity: "HIGH" } });
    await prisma.controlFinding.create({ data: { tenantId: tenants[0]!, vendorId, assessmentId: assessment.id, controlId: c.id, status, requiresHumanReview: status === "INSUFFICIENT_EVIDENCE", proposedByUserId: users[1]!, proposedStatus: status } });
  }
  for (const status of ["OPEN", "CLOSED"] as const) await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, vendorId, title: `Section18 vendor remediation ${status}`, description: "Disposable", status, dueDate: new Date(Date.now() - DAY) } });
  databaseClient.$use(async (params, next) => {
    if (params.args?.data?.tenantId === tenants[0] && failAudit && params.model === "AuditEvent" && params.action === "create") throw new Error("Disposable reporting audit failure");
    if (failSource && params.model === "AiRisk" && params.action === "findMany" && params.args?.where?.tenantId === tenants[0]) throw new Error("Disposable report source failure");
    return next(params);
  });
});
afterAll(async () => {
  await drain(); failAudit = false; failSource = false; vi.restoreAllMocks(); const where = { tenantId: { in: tenants } };
  await prisma.aiIncidentFinding.deleteMany({ where }); await prisma.aiIncidentReview.deleteMany({ where }); await prisma.aiIncident.deleteMany({ where });
  await prisma.aiMonitoringReview.deleteMany({ where }); await prisma.aiMonitoringCheck.deleteMany({ where });
  await prisma.riskAcceptance.deleteMany({ where }); await prisma.remediationVerification.deleteMany({ where }); await prisma.remediationAction.deleteMany({ where });
  await prisma.governanceFindingReview.deleteMany({ where }); await prisma.governanceFinding.deleteMany({ where });
  await prisma.aiControlTest.deleteMany({ where }); await prisma.aiControlEvidenceReview.deleteMany({ where }); await prisma.aiSystemControlEvidence.deleteMany({ where }); await prisma.evidenceDocument.deleteMany({ where });
  await prisma.aiSystemControl.deleteMany({ where }); await prisma.aiSystemFrameworkApplicability.deleteMany({ where });
  await prisma.reviewDecision.deleteMany({ where }); await prisma.controlFinding.deleteMany({ where }); await prisma.auditEvent.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }); await prisma.framework.deleteMany({ where: { id: frameworkId } }); await prisma.user.deleteMany({ where: { id: { in: users } } });
});

for (const role of ["ANALYST", "REVIEWER", "READ_ONLY"]) it(`denies legacy vendor PDF export without report:export for ${role}`, async () => {
  const res = await get(`/vendors/${vendorId}/executive-report/export`, role);
  expect(res.statusCode).toBe(403); expect(res.headers["content-type"]).not.toContain("pdf");
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], actorUserId: users[role === "ANALYST" ? 1 : role === "REVIEWER" ? 2 : 4], action: "report.denied" } })).toBeGreaterThan(0);
});
for (const role of ["ADMIN", "AUDITOR"]) it(`exports authorized vendor bytes and stored source values for ${role}`, async () => {
  const res = await get(`/vendors/${vendorId}/executive-report/export`, role); expect(res.statusCode).toBe(200);
  const text = pdfText(res.rawPayload), stored = await prisma.riskRating.findUniqueOrThrow({ where: { id: ids.rating } });
  expect(text).toContain("Section18 vendor"); expect(text).toContain(stored.finalRating); expect(text).toContain(`Inherent: ${stored.inherentScore}`); expect(text).toContain(`Residual: ${stored.residualScore}`); expect(text).toContain(stored.id);
  expect(text).not.toContain("FOREIGN-"); expect(text).not.toContain("S18-NEVER-EXPOSE");
  mkdirSync(exportDir, { recursive: true }); writeFileSync(join(exportDir, `vendor-${role}.pdf`), res.rawPayload);
});
it("vendor PDF uses its supplied snapshot date rather than the rendering clock", async () => {
  const snapshot = await buildExecutiveReport(tenants[0]!, vendorId); expect(snapshot).not.toBeNull();
  snapshot!.generatedAt = "2020-01-02T12:00:00.000Z";
  const bytes = await vendorPdf.renderExecutiveReportPdf(snapshot!);
  expect(pdfText(bytes)).toContain(new Date(snapshot!.generatedAt).toLocaleDateString());
});
for (const [key, status] of [["findings.PENDING_REVIEW", "PENDING_REVIEW"], ["findings.OPEN", "OPEN"], ["findings.DISMISSED", "DISMISSED"], ["findings.CLOSED", "CLOSED"]] as const) it(`reconciles ${key} to stored findings and exact drill-down IDs`, async () => {
  const source = await prisma.governanceFinding.findMany({ where: { tenantId: tenants[0], status, aiControlTest: { aiSystemControl: { aiSystemId: systems[0] } } }, select: { id: true } });
  const data = await report(); expect(metric(data, key).value).toBe(source.length);
  const drill = await get(metric(data, key).drillDown); expect(drill.statusCode).toBe(200);
  expect(drill.json<ReportRecords>().records.map(x => x.id).sort()).toEqual(source.map(x => x.id).sort());
});
for (const [key, status] of [["remediation.OPEN", "OPEN"], ["remediation.PENDING_VERIFICATION", "PENDING_VERIFICATION"], ["remediation.CLOSED", "CLOSED"]] as const) it(`reconciles ${key} to stored remediation`, async () => {
  const source = await prisma.remediationAction.findMany({ where: { tenantId: tenants[0], status, governanceFinding: { aiControlTest: { aiSystemControl: { aiSystemId: systems[0] } } } }, select: { id: true } });
  const data = await report(); expect(metric(data, key).value).toBe(source.length);
  expect((await get(metric(data, key).drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(source.map(x => x.id).sort());
});
for (const scope of ["operational", "historical", "all"] as const) it(`reconciles ${scope} systems and lifecycle distributions to stored inventory`, async () => {
  const source = await prisma.aiSystem.findMany({ where: { tenantId: tenants[0] } });
  const data = await report(`?lifecycleScope=${scope}`);
  expect(metric(data, "systems.operational").value).toBe(source.filter(x => x.lifecycleStatus !== "RETIRED").length);
  expect(metric(data, "systems.historical").value).toBe(source.filter(x => x.lifecycleStatus === "RETIRED").length);
  expect(metric(data, "systems.production").value).toBe(source.filter(x => x.lifecycleStatus === "PRODUCTION").length);
  const statuses = await prisma.aiRiskAssessment.findMany({ where: { tenantId: tenants[0], ...(scope === "all" ? {} : { aiSystem: { lifecycleStatus: scope === "historical" ? "RETIRED" : { not: "RETIRED" } } }) } });
  for (const status of ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED"]) expect(metric(data, `riskAssessments.${status}`).value).toBe(statuses.filter(x => x.status === status).length);
});
it("risk posture uses stored latest completed versions rather than newer drafts or retired systems", async () => {
  const rows = await prisma.aiRiskAssessment.findMany({ where: { tenantId: tenants[0], status: "COMPLETED", aiSystem: { lifecycleStatus: { not: "RETIRED" } } }, orderBy: { version: "desc" } });
  const seen = new Set<string>(); const latest = rows.filter(r => { if (seen.has(r.aiSystemId)) return false; seen.add(r.aiSystemId); return true; });
  const risks = await prisma.aiRisk.findMany({ where: { tenantId: tenants[0], assessmentId: { in: latest.map(x => x.id) } } });
  const data = await report();
  for (const band of ["LOW", "MODERATE", "HIGH", "CRITICAL", "NOT_ASSESSED"]) expect(metric(data, `risks.${band}`).value).toBe(risks.filter(r => (r.residualRating ?? "NOT_ASSESSED") === band).length);
  expect(metric(data, "risk.coverage").value).toBe(latest.length);
});
it("reconciles overdue remediation to stored due dates without treating closed work as overdue", async () => {
  const source = await prisma.remediationAction.findMany({ where: { tenantId: tenants[0], governanceFindingId: { not: null }, status: { not: "CLOSED" }, dueDate: { lt: new Date() } } });
  const data = await report(); expect(metric(data, "remediation.overdue").value).toBe(source.length);
  expect((await get(metric(data, "remediation.overdue").drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(source.map(x => x.id).sort());
});
it("retains retired-system obligations while excluding them from operational status counts", async () => {
  const row = await prisma.remediationAction.findUniqueOrThrow({ where: { id: ids.retiredRem } });
  const data = await report();
  expect((await get(metric(data, "historical.followUp").drillDown)).json<ReportRecords>().records.map(x => x.id)).toContain(row.id);
  expect((await get(metric(data, "remediation.OPEN").drillDown)).json<ReportRecords>().records.map(x => x.id)).not.toContain(row.id);
});
it("tenant-wide pending decisions reconcile to source state and remain distinct from personal eligibility", async () => {
  const expected = [ids.draft!, ids.finding0!, ids.rem1!, ...(await prisma.aiUseCase.findMany({ where: { tenantId: tenants[0], status: "PENDING_REVIEW" } })).map(x => x.id), ...(await prisma.riskAcceptance.findMany({ where: { tenantId: tenants[0], status: "PENDING_REVIEW" } })).map(x => x.id)];
  const data = await report(); expect(metric(data, "decisions.pending").value).toBe(expected.length);
  expect((await get(metric(data, "decisions.pending").drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(expected.sort());
});
for (const role of ["ADMIN", "AUDITOR", "REVIEWER"]) it(`reconciles evidence visibility and source totals for ${role}`, async () => {
  const data = await report("", role), m = data.metrics.find(x => x.key === "evidence.total")!;
  if (role === "REVIEWER") { expect(m).toMatchObject({ access: "RESTRICTED" }); expect(m).not.toHaveProperty("value"); expect(m).not.toHaveProperty("denominator"); expect((await get(m.drillDown, role)).statusCode).toBe(403); }
  else { expect(metric(data, "evidence.total").value).toBe(await prisma.evidenceDocument.count({ where: { tenantId: tenants[0], aiSystemId: systems[0], deletedAt: null } })); }
  expect(JSON.stringify(data)).not.toMatch(/S18-NEVER-EXPOSE|FOREIGN-SECTION18-SECRET/);
});
for (const role of ["ADMIN", "AUDITOR"]) it(`exports governance values and source IDs from authorized stored records for ${role}`, async () => {
  const res = await get("/reports/ai-governance/export", role); expect(res.statusCode).toBe(200);
  const text = pdfText(res.rawPayload);
  const operational = await prisma.aiSystem.count({ where: { tenantId: tenants[0], lifecycleStatus: { not: "RETIRED" } } });
  expect(text).toContain(`Non-retired AI systems: ${operational}`); expect(text).toContain(systems[0]!); expect(text).toContain(ids.latestRisk!); expect(text).not.toContain(ids.draftRisk!);
  expect(text).not.toMatch(/S18-NEVER-EXPOSE|FOREIGN-SECTION18-SECRET/);
  mkdirSync(exportDir, { recursive: true }); writeFileSync(join(exportDir, `governance-${role}.pdf`), res.rawPayload);
});
for (const path of ["/reports/ai-governance", "/reports/ai-governance/records?metric=systems.operational", "/reports/ai-governance/export", "/dashboard/summary"]) it(`fails closed on audit failure at ${path}`, async () => {
  const count = await prisma.auditEvent.count({ where: { tenantId: tenants[0], outcome: "SUCCESS" } });
  failAudit = true; const res = await get(path); failAudit = false;
  expect(res.statusCode).toBe(500); expect(res.headers["content-type"]).not.toContain("pdf");
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], outcome: "SUCCESS" } })).toBe(count);
});
it("does not deliver either export when its renderer fails", async () => {
  vi.spyOn(governancePdf, "renderGovernanceReportPdf").mockRejectedValueOnce(new Error("Disposable rendering failure"));
  expect((await get("/reports/ai-governance/export")).statusCode).toBe(500);
  vi.spyOn(vendorPdf, "renderExecutiveReportPdf").mockRejectedValueOnce(new Error("Disposable rendering failure"));
  expect((await get(`/vendors/${vendorId}/executive-report/export`)).statusCode).toBe(500);
});
it("fails closed when a source query fails and creates no successful report audit", async () => {
  const count = await prisma.auditEvent.count({ where: { tenantId: tenants[0], action: "governance_report.generated", outcome: "SUCCESS" } });
  failSource = true; const res = await get("/reports/ai-governance"); failSource = false;
  expect(res.statusCode).toBe(500); expect(res.body).not.toMatch(/Disposable|Prisma|stack|password/);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], action: "governance_report.generated", outcome: "SUCCESS" } })).toBe(count);
});
for (const status of ["DRAFT", "PENDING_REVIEW", "APPROVED", "SUSPENDED", "RETIRED"] as const) it(`reconciles use-case ${status} to stored lifecycle state`, async () => {
  const source = await prisma.aiUseCase.findMany({ where: { tenantId: tenants[0], status, aiSystem: { lifecycleStatus: { not: "RETIRED" } } }, select: { id: true } });
  const data = await report(), m = metric(data, `useCases.${status}`);
  expect(m.value).toBe(source.length); expect((await get(m.drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(source.map(x => x.id).sort());
});
for (const direction of ["BENEFICIAL", "ADVERSE"] as const) it(`reconciles ${direction} impact items to stored completed-assessment records`, async () => {
  const rows = await prisma.aiImpact.findMany({ where: { tenantId: tenants[0], assessmentId: ids.impact, direction }, select: { id: true } });
  const m = metric(await report(), `impacts.${direction}`); expect(m.value).toBe(rows.length);
  expect((await get(m.drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(rows.map(x => x.id).sort());
});
for (const status of ["OPEN", "IN_PROGRESS", "PENDING_REVIEW", "CLOSED"] as const) it(`reconciles incident ${status} to stored records`, async () => {
  const rows = await prisma.aiIncident.findMany({ where: { tenantId: tenants[0], status, aiSystem: { lifecycleStatus: { not: "RETIRED" } } }, select: { id: true } });
  const m = metric(await report(), `incidents.${status}`); expect(m.value).toBe(rows.length);
  expect((await get(m.drillDown)).json<ReportRecords>().records.map(x => x.id).sort()).toEqual(rows.map(x => x.id).sort());
});
it("reconciles controls, testing coverage, monitoring and vendor associations to stored sources", async () => {
  const data = await report();
  const controls = await prisma.aiSystemControl.findMany({ where: { tenantId: tenants[0], applicability: "APPLICABLE", aiSystem: { lifecycleStatus: { not: "RETIRED" } } } });
  const tests = await prisma.aiControlTest.findMany({ where: { tenantId: tenants[0], status: "COMPLETED", aiSystemControlId: { in: controls.map(c => c.id) } } });
  expect(metric(data, "controls.APPLICABLE").value).toBe(controls.length);
  expect(metric(data, "tests.COMPLETED").value).toBe(tests.length);
  expect(metric(data, "tests.coverage")).toMatchObject({ value: new Set(tests.map(t => t.aiSystemControlId)).size, denominator: controls.length });
  expect(metric(data, "monitoring.INACTIVE").value).toBe(await prisma.aiMonitoringCheck.count({ where: { tenantId: tenants[0], active: false } }));
  expect(metric(data, "monitoring.OVERDUE").value).toBe(await prisma.aiMonitoringCheck.count({ where: { tenantId: tenants[0], active: true, createdAt: { lt: new Date(Date.now() - 60 * DAY) } } }));
  expect(metric(data, "vendors.links").value).toBe(await prisma.aiSystemVendor.count({ where: { tenantId: tenants[0], aiSystem: { lifecycleStatus: { not: "RETIRED" } }, vendor: { tenantId: tenants[0], deletedAt: null } } }));
});
it("reconciles acceptance expiration from stored decision state instead of planned treatment", async () => {
  const data = await report(), rows = await prisma.riskAcceptance.findMany({ where: { tenantId: tenants[0], aiRiskId: { not: null } } });
  const now = Date.parse(data.generatedAt);
  expect(metric(data, "acceptances.PENDING_REVIEW").value).toBe(rows.filter(r => r.status === "PENDING_REVIEW").length);
  expect(metric(data, "acceptances.REJECTED").value).toBe(rows.filter(r => r.status === "REJECTED").length);
  expect(metric(data, "acceptances.EXPIRED").value).toBe(rows.filter(r => r.status === "APPROVED" && r.expiresAt && r.expiresAt.getTime() < now).length);
  expect(metric(data, "acceptances.ACTIVE").value).toBe(rows.filter(r => r.status === "APPROVED" && (!r.expiresAt || r.expiresAt.getTime() >= now)).length);
});
it("dashboard populations reconcile to stored sources, excluding offboarded vendors", async () => {
  const res = await get("/dashboard/summary"); expect(res.statusCode).toBe(200); const body = res.json();
  expect(body.posture.aiSystems).toBe(await prisma.aiSystem.count({ where: { tenantId: tenants[0], lifecycleStatus: { not: "RETIRED" } } }));
  expect(body.posture.inProduction).toBe(await prisma.aiSystem.count({ where: { tenantId: tenants[0], lifecycleStatus: "PRODUCTION" } }));
  expect(body.attention.findingsOpen).toBe(await prisma.governanceFinding.count({ where: { tenantId: tenants[0], status: "OPEN" } }));
  expect(body.attention.remediationAwaitingVerification).toBe(await prisma.remediationAction.count({ where: { tenantId: tenants[0], governanceFindingId: { not: null }, status: "PENDING_VERIFICATION" } }));
  expect(body.thirdParty.vendors).toBe(await prisma.vendor.count({ where: { tenantId: tenants[0], deletedAt: null } }));
  expect(body.thirdParty.aiVendors).toBe(await prisma.vendor.count({ where: { tenantId: tenants[0], deletedAt: null, aiFunctionality: true } }));
});
it("vendor report reconciles stored ratings, finding states and closed/overdue remediation", async () => {
  const res = await get(`/vendors/${vendorId}/executive-report`); expect(res.statusCode).toBe(200); const body = res.json();
  const stored = await prisma.riskRating.findUniqueOrThrow({ where: { id: ids.rating } });
  expect(body.riskRating).toMatchObject({ id: stored.id, assessmentId: stored.assessmentId, inherentScore: stored.inherentScore, residualScore: stored.residualScore, finalRating: stored.finalRating });
  const findings = await prisma.controlFinding.findMany({ where: { tenantId: tenants[0], assessmentId: ids.vendorAssessment } });
  expect(body.findings.total).toBe(findings.length); expect(body.findings.closedCount).toBe(findings.filter(f => ["PASS", "NOT_APPLICABLE"].includes(f.status)).length);
  const rows = await prisma.remediationAction.findMany({ where: { tenantId: tenants[0], vendorId } });
  expect(body.remediation.counts.total).toBe(rows.length); expect(body.remediation.counts.closed).toBe(rows.filter(r => r.status === "CLOSED").length);
  expect(body.remediation.overdueItems.map((r: { id: string }) => r.id).sort()).toEqual(rows.filter(r => r.status !== "CLOSED" && r.dueDate && r.dueDate.getTime() < Date.parse(body.generatedAt)).map(r => r.id).sort());
});
for (const path of ["/reports/ai-governance", "/reports/ai-governance/records?metric=systems.operational", "/reports/ai-governance/export"]) it(`rejects foreign filters on ${path}`, async () => {
  const res = await get(path + (path.includes("?") ? "&" : "?") + `aiSystemId=${ids.foreignSystem}`);
  expect(res.statusCode).toBe(404); expect(res.body).not.toContain("FOREIGN-SECTION18-SECRET");
});
for (const query of ["?lifecycleScope=wrong", "?tenantId=forged", "?aiSystemId=bad", "?lifecycleScope=all&lifecycleScope=historical"]) it(`fails closed for malformed report filters ${query}`, async () => {
  expect((await get("/reports/ai-governance" + query)).statusCode).toBe(400);
});
it("empty authorized tenant reports stored zero populations and exports no foreign source records", async () => {
  const data = await report("", "EMPTY"); expect(metric(data, "systems.operational").value).toBe(0);
  const res = await get("/reports/ai-governance/export", "EMPTY"); expect(res.statusCode).toBe(200);
  const text = pdfText(res.rawPayload); expect(text).toContain("Non-retired AI systems: 0"); expect(text).not.toContain(systems[0]!); expect(text).not.toContain("FOREIGN-");
});
it("detects stale pagination after a source record leaves the selected metric", async () => {
  const row = await prisma.aiUseCase.findFirstOrThrow({ where: { tenantId: tenants[0], status: "DRAFT" } });
  const cursor = `AiUseCase:${row.id}`;
  await prisma.aiUseCase.update({ where: { id: row.id }, data: { status: "PENDING_REVIEW" } });
  try { expect((await get(`/reports/ai-governance/records?metric=useCases.DRAFT&cursor=${cursor}`)).statusCode).toBe(400); }
  finally { await prisma.aiUseCase.update({ where: { id: row.id }, data: { status: "DRAFT" } }); }
});
it("repeated and concurrent report reads neither duplicate source populations nor mutate lifecycle records", async () => {
  const before = await prisma.aiSystem.findMany({ where: { tenantId: tenants[0] }, orderBy: { id: "asc" } });
  const res = await Promise.all([get("/reports/ai-governance"), get("/reports/ai-governance"), get("/reports/ai-governance/export")]);
  expect(res.map(r => r.statusCode)).toEqual([200, 200, 200]);
  const count = await prisma.aiSystem.count({ where: { tenantId: tenants[0], lifecycleStatus: { not: "RETIRED" } } });
  for (const response of res.slice(0, 2)) expect(metric(response.json<GovernanceReport>(), "systems.operational").value).toBe(count);
  expect(await prisma.aiSystem.findMany({ where: { tenantId: tenants[0] }, orderBy: { id: "asc" } })).toEqual(before);
});
for (const operation of ["executive-report", "executive-report/export"]) it(`does not deliver vendor ${operation} when required audit persistence fails`, async () => {
  const before = await prisma.auditEvent.count({ where: { tenantId: tenants[0], action: "report.exported", outcome: "SUCCESS" } });
  failAudit = true; const res = await get(`/vendors/${vendorId}/${operation}`); failAudit = false;
  expect(res.statusCode).toBe(500); expect(res.headers["content-type"]).not.toContain("pdf");
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], action: "report.exported", outcome: "SUCCESS" } })).toBe(before);
});
it("displays the stored operational population and exact metric destination through the real report component", async () => {
  const data = await report();
  const count = await prisma.aiSystem.count({ where: { tenantId: tenants[0], lifecycleStatus: { not: "RETIRED" } } });
  const html = renderedReport(data), m = metric(data, "systems.operational");
  expect(html).toContain(`Non-retired AI systems: </strong><a href="${m.drillDown.replaceAll("&", "&amp;")}" style="color:#93c5fd">${count}`);
  expect(html).not.toContain("FOREIGN-SECTION18-SECRET");
});
it("displays restricted evidence without substituting a misleading numeric zero", async () => {
  const data = await report("", "REVIEWER"), html = renderedReport(data);
  expect(html).toContain("Evidence documents: </strong><span>Restricted</span>");
  expect(html).not.toContain("Evidence documents: </strong><a");
  expect(html).not.toContain("S18-NEVER-EXPOSE");
});
