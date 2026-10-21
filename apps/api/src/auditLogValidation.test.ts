import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach, it as test, expect } from "vitest";
import { prisma, databaseClient } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";
import { safeAuditMetadata } from "./auditEvents.js";

const tenants: string[] = [], users: string[] = [];
const cookies: Record<string, string> = {}, actors: Record<string, string> = {};
const pending = new Set<Promise<unknown>>();
let vendorId: string, systemId: string, foreignEventId: string, foreignTargetId: string, ip = 0;
let failAuditAt = 0, attemptedAudits = 0, failReads = false;
function track<T>(p: Promise<T>): Promise<T> { pending.add(p); void p.then(() => pending.delete(p), () => pending.delete(p)); return p; }
function it(name: string, body: () => Promise<void>) { test(name, () => track(Promise.resolve().then(body))); }
async function drain() { while (pending.size) await Promise.allSettled([...pending]); }
function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, role = "ADMIN") {
  return track(Promise.resolve(server.inject({ method, url, cookies: role === "NONE" ? {} : { vg_session: cookies[role]! },
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) } : {}),
    remoteAddress: `10.193.${Math.floor(++ip / 250)}.${ip % 250}` })));
}
async function visible(action: string, targetId: string) {
  const res = await call("GET", `/audit-events?action=${action}&targetId=${targetId}`);
  expect(res.statusCode).toBe(200); return res.json().events as { id: string; actorUserId: string; action: string; targetId: string; targetType: string; outcome: string; createdAt: string; metadataJson: unknown }[];
}
async function reconcile(action: string, targetId: string, targetType: string, role: string, since: number, outcome = "SUCCESS") {
  const stored = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], action, targetId } });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ tenantId: tenants[0], actorUserId: actors[role], targetId, targetType, action, outcome });
  expect(stored[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(since);
  expect(stored[0]!.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  const events = await visible(action, targetId); expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ id: stored[0]!.id, actorUserId: actors[role], action, targetId, targetType, outcome, createdAt: stored[0]!.createdAt.toISOString() });
  expect(events[0]!.metadataJson).toEqual(safeAuditMetadata(stored[0]!.metadataJson));
  return stored[0]!;
}
async function finding(status: "PENDING_REVIEW" | "OPEN" = "PENDING_REVIEW", creator = actors.ADMIN!) {
  return prisma.governanceFinding.create({ data: { tenantId: tenants[0]!, title: "Section19 disposable finding", description: "Disposable", severity: "HIGH", status, createdByUserId: creator } });
}
async function governed(status: "IN_PROGRESS" | "PENDING_VERIFICATION" = "PENDING_VERIFICATION") {
  const f = await finding("OPEN");
  const rem = await prisma.remediationAction.create({ data: { tenantId: tenants[0]!, governanceFindingId: f.id, title: "Section19 corrective action", description: "Disposable", ownerUserId: actors.ANALYST!, status } });
  return { f, rem };
}
beforeAll(async () => {
  await server.ready();
  for (const label of ["A", "B"]) tenants.push((await prisma.tenant.create({ data: { name: `Section19 audit ${label}` } })).id);
  for (const role of ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY", "FOREIGN"] as const) {
    const unique = randomUUID(), tenantId = role === "FOREIGN" ? tenants[1]! : tenants[0]!, actualRole = role === "FOREIGN" ? "ADMIN" : role;
    const u = await prisma.user.create({ data: { externalId: unique, email: `${unique}@section19.example.test`, displayName: role } }); users.push(u.id); actors[role] = u.id;
    await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: actualRole } });
    cookies[role] = await issueTestSessionCookie({ tenantId, userId: u.id, role: actualRole, email: u.email, displayName: role });
  }
  vendorId = (await prisma.vendor.create({ data: { tenantId: tenants[0]!, legalName: "Section19 vendor", serviceDescription: "Disposable", serviceCategory: "Test", criticality: "LOW" } })).id;
  systemId = (await prisma.aiSystem.create({ data: { tenantId: tenants[0]!, name: "Section19 system", origin: "INTERNAL" } })).id;
  foreignTargetId = randomUUID(); foreignEventId = (await prisma.auditEvent.create({ data: { tenantId: tenants[1]!, actorUserId: actors.FOREIGN!, action: "section19.foreign", targetType: "Vendor", targetId: foreignTargetId, outcome: "SUCCESS", metadataJson: { token: "S19-SECRET-TOKEN" } } })).id;
  databaseClient.$use(async (params, next) => {
    if (params.model === "AuditEvent" && params.action === "create" && params.args?.data?.tenantId === tenants[0] && failAuditAt && ++attemptedAudits === failAuditAt) throw new Error("Section19 disposable audit failure");
    if (failReads && params.model === "AuditEvent" && params.action === "findMany" && params.args?.where?.tenantId === tenants[0]) throw new Error("Section19 disposable audit read failure");
    return next(params);
  });
});
beforeEach(drain);
afterEach(async () => { await drain(); failAuditAt = 0; attemptedAudits = 0; failReads = false; });
afterAll(async () => {
  await drain(); failAuditAt = 0; failReads = false;
  const where = { tenantId: { in: tenants } };
  await prisma.remediationVerification.deleteMany({ where }); await prisma.remediationAction.deleteMany({ where });
  await prisma.governanceFindingReview.deleteMany({ where }); await prisma.governanceFinding.deleteMany({ where });
  await prisma.evidenceDocument.deleteMany({ where }); await prisma.auditEvent.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } }); await prisma.user.deleteMany({ where: { id: { in: users } } });
});

for (const role of ["ADMIN", "AUDITOR", "ANALYST", "REVIEWER", "READ_ONLY", "NONE"]) it(`enforces existing audit read policy for ${role}`, async () => {
  const res = await call("GET", "/audit-events", undefined, role);
  expect(res.statusCode).toBe(role === "NONE" ? 401 : ["ADMIN", "AUDITOR"].includes(role) ? 200 : 403);
  expect(res.headers["cache-control"]).toBe("private, no-store");
  if (res.statusCode !== 200) expect(res.json()).not.toHaveProperty("events");
});
it("reconciles real vendor creation and assessment creation with their persisted targets and audit response", async () => {
  const since = Date.now();
  const v = await call("POST", "/vendors", { legalName: "Section19 created vendor", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" }, "ANALYST");
  expect(v.statusCode).toBe(201); const stored = await prisma.vendor.findUniqueOrThrow({ where: { id: v.json().id } });
  expect(stored).toMatchObject({ tenantId: tenants[0], legalName: "Section19 created vendor" });
  await reconcile("vendor.created", stored.id, "Vendor", "ANALYST", since);
  const a = await call("POST", `/vendors/${stored.id}/assessments`, {}, "ANALYST"); expect(a.statusCode).toBe(201);
  expect(await prisma.assessment.findUniqueOrThrow({ where: { id: a.json().id } })).toMatchObject({ vendorId: stored.id, tenantId: tenants[0], startedByUserId: actors.ANALYST });
  await reconcile("assessment.created", a.json().id, "Assessment", "ANALYST", since);
});
for (const decision of ["CONFIRM", "DISMISS"]) it(`reconciles human ${decision} with immutable-through-API review attribution and matching audit`, async () => {
  const f = await finding(), since = Date.now();
  const res = await call("POST", `/governance-findings/${f.id}/review`, { decision, rationale: "Section19 human rationale" }, "REVIEWER"); expect(res.statusCode).toBe(200);
  const stored = await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } }); expect(stored.status).toBe(decision === "CONFIRM" ? "OPEN" : "DISMISSED");
  const review = await prisma.governanceFindingReview.findFirstOrThrow({ where: { findingId: f.id } }); expect(review).toMatchObject({ reviewerUserId: actors.REVIEWER, decision, rationale: "Section19 human rationale", previousStatus: "PENDING_REVIEW", newStatus: stored.status });
  const event = await reconcile("governance_finding.reviewed", f.id, "GovernanceFinding", "REVIEWER", since);
  expect(event.metadataJson).toMatchObject({ decision, reviewId: review.id, to: stored.status });
  expect((await call("POST", `/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: "overwrite" }, "REVIEWER")).statusCode).toBe(409);
  expect(await prisma.governanceFindingReview.findUniqueOrThrow({ where: { id: review.id } })).toEqual(review);
  expect(await visible("governance_finding.reviewed", f.id)).toHaveLength(1);
});
it("records actual self-review denial without a misleading success decision", async () => {
  const f = await finding(), since = Date.now();
  expect((await call("POST", `/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: "Self" })).statusCode).toBe(403);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).toEqual(f);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: f.id } })).toBe(0);
  const event = await reconcile("governance_finding.denied", f.id, "GovernanceFinding", "ADMIN", since, "DENIED"); expect(event.metadataJson).toMatchObject({ reason: "reviewer_is_creator" });
  expect(await visible("governance_finding.reviewed", f.id)).toEqual([]);
});
for (const decision of ["VERIFIED", "REJECTED"]) it(`reconciles remediation ${decision} with stored verification and all expected audit events`, async () => {
  const { f, rem } = await governed(), since = Date.now();
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision, rationale: "Independent check" }, "REVIEWER")).statusCode).toBe(200);
  const saved = await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } }); expect(saved.status).toBe(decision === "VERIFIED" ? "CLOSED" : "IN_PROGRESS");
  const verification = await prisma.remediationVerification.findFirstOrThrow({ where: { remediationId: rem.id } }); expect(verification).toMatchObject({ verifierUserId: actors.REVIEWER, decision, rationale: "Independent check", newStatus: saved.status });
  const event = await reconcile(`governance_remediation.${decision === "VERIFIED" ? "verified" : "rejected"}`, rem.id, "RemediationAction", "REVIEWER", since); expect(event.metadataJson).toMatchObject({ verificationId: verification.id });
  if (decision === "VERIFIED") { await reconcile("governance_remediation.closed", rem.id, "RemediationAction", "REVIEWER", since); await reconcile("governance_finding.closed", f.id, "GovernanceFinding", "REVIEWER", since); }
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(decision === "VERIFIED" ? "CLOSED" : "OPEN");
});
it("reconciles owner submission with persisted pending state and correct human audit", async () => {
  const { rem } = await governed("IN_PROGRESS"), since = Date.now();
  expect((await call("POST", `/governance-remediations/${rem.id}/submit`, {}, "ANALYST")).statusCode).toBe(200);
  expect((await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } })).status).toBe("PENDING_VERIFICATION");
  await reconcile("governance_remediation.submitted_for_verification", rem.id, "RemediationAction", "ANALYST", since);
});
it("reconciles disposable evidence metadata creation without touching recovered evidence or blobs", async () => {
  const since = Date.now(); const res = await call("POST", `/ai-systems/${systemId}/evidence`, { displayFilename: "Section19 metadata.txt", documentType: "OTHER" }, "ANALYST"); expect(res.statusCode).toBe(201);
  const stored = await prisma.evidenceDocument.findUniqueOrThrow({ where: { id: res.json().id } }); expect(stored).toMatchObject({ tenantId: tenants[0], aiSystemId: systemId, uploadedByUserId: actors.ANALYST, displayFilename: "Section19 metadata.txt" });
  const event = await reconcile("ai_system_evidence.created", stored.id, "EvidenceDocument", "ANALYST", since); expect(event.metadataJson).toMatchObject({ aiSystemId: systemId, documentType: "OTHER" });
});
for (const [suffix, action] of [["", "report.generated"], ["/export", "report.exported"]]) it(`reconciles authorized vendor ${action} with existing source and audit`, async () => {
  const before = await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } }), since = Date.now();
  const res = await call("GET", `/vendors/${vendorId}/executive-report${suffix}`, undefined, "AUDITOR"); expect(res.statusCode).toBe(200);
  if (suffix) expect(res.headers["content-type"]).toContain("pdf"); else expect(res.json().vendor.id).toBe(vendorId);
  expect(await prisma.vendor.findUniqueOrThrow({ where: { id: vendorId } })).toEqual(before);
  await reconcile(action!, vendorId, "Vendor", "AUDITOR", since);
});
for (const [path, action, format] of [["/reports/ai-governance", "governance_report.generated", "JSON"], ["/reports/ai-governance/export", "governance_report.exported", "PDF"]]) it(`matches ${action} attribution, snapshot and response`, async () => {
  const since = Date.now(), count = await prisma.aiSystem.count({ where: { tenantId: tenants[0] } });
  const response = await call("GET", path!, undefined, "AUDITOR"); expect(response.statusCode).toBe(200);
  if (format === "PDF") expect(response.headers["content-type"]).toContain("pdf");
  const events = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], action } }); expect(events).toHaveLength(1);
  const event = events[0]!; expect(event).toMatchObject({ actorUserId: actors.AUDITOR, targetType: "GovernanceReport", outcome: "SUCCESS" });
  expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(since); expect(event.metadataJson).toMatchObject({ format });
  expect(event.correlationId).toEqual(expect.any(String)); expect(event.correlationId!.length).toBeGreaterThan(0);
  const res = await call("GET", `/audit-events?action=${action}`); expect(res.statusCode).toBe(200); expect(res.json().events[0]).toMatchObject({ id: event.id, actorUserId: actors.AUDITOR, metadataJson: safeAuditMetadata(event.metadataJson) });
  expect(await prisma.aiSystem.count({ where: { tenantId: tenants[0] } })).toBe(count);
});
for (const stage of [1, 2, 3]) it(`rolls back closure, verification and earlier audit events when audit write ${stage} fails`, async () => {
  const { f, rem } = await governed(); failAuditAt = stage;
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale: "Rollback check" }, "REVIEWER")).statusCode).toBe(500);
  expect(attemptedAudits).toBe(stage); failAuditAt = 0;
  expect(await prisma.remediationAction.findUniqueOrThrow({ where: { id: rem.id } })).toEqual(rem);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).toEqual(f);
  expect(await prisma.remediationVerification.count({ where: { remediationId: rem.id } })).toBe(0);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], targetId: { in: [f.id, rem.id] }, outcome: "SUCCESS" } })).toBe(0);
  // A later authorized retry must commit the complete chain, once.
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale: "Retest after recovery" }, "REVIEWER")).statusCode).toBe(200);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], targetId: { in: [f.id, rem.id] }, outcome: "SUCCESS" } })).toBe(3);
});
for (const operation of ["review", "vendor", "evidence", "report"]) it(`fails closed without partial state or success audit after ${operation} audit failure`, async () => {
  const f = await finding(); const count = await prisma.evidenceDocument.count({ where: { tenantId: tenants[0] } });
  const vendors = await prisma.vendor.count({ where: { tenantId: tenants[0] } }); const audits = await prisma.auditEvent.count({ where: { tenantId: tenants[0], outcome: "SUCCESS" } });
  failAuditAt = 1;
  const res = operation === "review" ? await call("POST", `/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: "Rollback" }, "REVIEWER")
    : operation === "vendor" ? await call("POST", "/vendors", { legalName: "Must rollback", serviceDescription: "Test", serviceCategory: "Test", criticality: "LOW" }, "ANALYST")
    : operation === "evidence" ? await call("POST", `/ai-systems/${systemId}/evidence`, { displayFilename: "Rollback.txt", documentType: "OTHER" }, "ANALYST") : await call("GET", `/vendors/${vendorId}/executive-report/export`);
  expect(res.statusCode).toBe(500); expect(attemptedAudits).toBe(1); failAuditAt = 0;
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).toEqual(f);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: f.id } })).toBe(0);
  expect(await prisma.evidenceDocument.count({ where: { tenantId: tenants[0] } })).toBe(count); expect(await prisma.vendor.count({ where: { tenantId: tenants[0] } })).toBe(vendors);
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], outcome: "SUCCESS" } })).toBe(audits); expect(res.headers["content-type"]).not.toContain("pdf");
});
it("records exactly one human review and one matching audit during concurrent conflicting decisions", async () => {
  const f = await finding(); const results = await Promise.all(["CONFIRM", "DISMISS"].map(decision => call("POST", `/governance-findings/${f.id}/review`, { decision, rationale: decision }, "REVIEWER")));
  expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
  const reviews = await prisma.governanceFindingReview.findMany({ where: { findingId: f.id } }); expect(reviews).toHaveLength(1);
  const events = await prisma.auditEvent.findMany({ where: { targetId: f.id, action: "governance_finding.reviewed" } }); expect(events).toHaveLength(1);
  expect(events[0]!.metadataJson).toMatchObject({ decision: reviews[0]!.decision, reviewId: reviews[0]!.id, to: reviews[0]!.newStatus });
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe(reviews[0]!.newStatus);
  expect((await visible("governance_finding.reviewed", f.id))[0]!.id).toBe(events[0]!.id);
});
for (const role of ["ADMIN", "AUDITOR"]) it(`does not return foreign audit IDs or targets to ${role}`, async () => {
  const res = await call("GET", "/audit-events?limit=100", undefined, role); expect(res.statusCode).toBe(200);
  expect(res.body).not.toContain(foreignEventId); expect(res.body).not.toContain(foreignTargetId);
  expect((await call("GET", `/audit-events?targetId=${foreignTargetId}`, undefined, role)).json().events).toEqual([]);
  expect((await call("GET", `/audit-events?cursor=${foreignEventId}`, undefined, role)).statusCode).toBe(400);
});
for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=NaN", "action=bad%20action", "targetType=%3Cscript%3E", "targetId=bad", "cursor=bad", "from=bad", "from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z", "tenantId=foreign", "role=ADMIN", "action=a&action=b", "from=2026-02-30T00:00:00Z", "to=2026-04-31T00:00:00Z", "from=2026-01-01T24:00:00Z"]) it(`rejects malformed audit query ${query}`, async () => {
  const res = await call("GET", "/audit-events?" + query); expect(res.statusCode).toBe(400); expect(res.body).not.toMatch(/Prisma|stack|SELECT|S19-SECRET/);
});
it("combines action, target type, target ID and inclusive time filters against stored records", async () => {
  const at = new Date("2024-02-29T12:34:56.123Z"), id = randomUUID();
  const e = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, actorUserId: actors.ADMIN, action: "section19.filter", targetId: id, targetType: "Vendor", outcome: "SUCCESS", createdAt: at } });
  const base = `/audit-events?action=section19.filter&targetType=Vendor&targetId=${id}&from=${at.toISOString()}&to=${at.toISOString()}`;
  const res = await call("GET", base); expect(res.statusCode).toBe(200); expect(res.json().events.map((x: { id: string }) => x.id)).toEqual([e.id]);
  expect((await call("GET", base.replace("targetType=Vendor", "targetType=Assessment"))).json().events).toEqual([]);
  expect((await call("GET", `/audit-events?targetId=${randomUUID()}`)).json().events).toEqual([]);
});
it("paginates tied timestamps in stable ID order without duplicates or gaps", async () => {
  const at = new Date("2025-01-01T00:00:00Z");
  for (let i = 0; i < 5; i++) await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.page", outcome: "SUCCESS", createdAt: at } });
  const expected = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], action: "section19.page" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const seen: string[] = []; let cursor: string | null = null;
  do { const res = await call("GET", "/audit-events?action=section19.page&limit=2" + (cursor ? `&cursor=${cursor}` : "")); expect(res.statusCode).toBe(200); seen.push(...res.json().events.map((e: { id: string }) => e.id)); cursor = res.json().nextCursor; expect(seen.length).toBeLessThanOrEqual(5); } while (cursor);
  expect(seen).toEqual(expected.map(e => e.id)); expect(new Set(seen).size).toBe(5);
  expect((await call("GET", `/audit-events?action=section19.other&cursor=${seen[0]}`)).statusCode).toBe(400);
});
it("rejects stale/deleted and nonexistent cursors without returning unrelated history", async () => {
  const event = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.stale", outcome: "SUCCESS" } });
  await prisma.auditEvent.delete({ where: { id: event.id } });
  for (const id of [event.id, randomUUID()]) { const res = await call("GET", `/audit-events?cursor=${id}`); expect(res.statusCode).toBe(400); expect(res.json()).not.toHaveProperty("events"); }
});
it("does not expose raw narratives, cookies, tokens, storage keys or nested metadata", async () => {
  const secret = "S19-SECRET-TOKEN", id = randomUUID();
  const event = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, actorUserId: actors.ADMIN, action: "section19.redaction", targetId: id, outcome: "SUCCESS", metadataJson: { format: "JSON", password: secret, cookie: cookies.ADMIN, token: secret, storageKey: secret, rationale: secret, nested: { secret }, operation: secret, definitionVersion: secret } } });
  const res = await call("GET", `/audit-events?targetId=${id}`); expect(res.statusCode).toBe(200); expect(res.body).not.toContain(secret); expect(res.body).not.toContain(cookies.ADMIN!);
  expect(res.json().events[0]).toMatchObject({ id: event.id, metadataJson: { format: "JSON" } });
});
it("audit reads are read-only, repeatable and isolated under concurrent requests", async () => {
  const before = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0] }, orderBy: { id: "asc" } });
  const results = await Promise.all([call("GET", "/audit-events?limit=100"), call("GET", "/audit-events?limit=100", undefined, "AUDITOR")]);
  expect(results.map(r => r.statusCode)).toEqual([200, 200]); expect(results[0]!.json()).toEqual(results[1]!.json());
  expect(await prisma.auditEvent.findMany({ where: { tenantId: tenants[0] }, orderBy: { id: "asc" } })).toEqual(before);
});
it("fails closed on audit read failure and recovers without returning partial history", async () => {
  failReads = true; const res = await call("GET", "/audit-events"); expect(res.statusCode).toBe(500); expect(res.json()).not.toHaveProperty("events");
  failReads = false; expect((await call("GET", "/audit-events")).statusCode).toBe(200);
});
for (const value of ["2024-02-29T12:34:56Z", "2024-02-29T12:34:56.1Z", "2024-02-29T12:34:56.12Z", "2024-02-29T12:34:56.123Z", "2026-12-31T23:59:59Z"]) it(`preserves valid UTC boundary ${value}`, async () => {
  const at = new Date(value);
  const e = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.valid_date", outcome: "SUCCESS", createdAt: at } });
  const res = await call("GET", `/audit-events?action=section19.valid_date&from=${value}&to=${value}`); expect(res.statusCode).toBe(200); expect(res.json().events.map((x: { id: string }) => x.id)).toContain(e.id);
});
for (const value of ["2025-02-29T00:00:00Z", "2026-02-31T00:00:00.123Z", "2026-13-01T00:00:00Z", "2026-01-01T23:60:00Z", "2026-01-01T23:59:60Z", "2026-01-01T00:00:00+01:00"]) it(`rejects additional invalid calendar/time boundary ${value}`, async () => {
  expect((await call("GET", "/audit-events?from=" + encodeURIComponent(value))).statusCode).toBe(400);
});
for (const method of ["POST", "PATCH", "DELETE"] as const) it(`provides no ${method} audit-history mutation API`, async () => {
  const e = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.protected", outcome: "SUCCESS" } });
  expect((await call(method, `/audit-events/${e.id}`, { action: "overwrite", outcome: "DENIED" })).statusCode).toBe(404);
  expect(await prisma.auditEvent.findUniqueOrThrow({ where: { id: e.id } })).toEqual(e);
});
it("keeps foreign decision state and history unchanged after a direct-ID action attempt", async () => {
  const f = await prisma.governanceFinding.create({ data: { tenantId: tenants[1]!, title: "Section19 foreign", description: "Disposable", severity: "HIGH", createdByUserId: actors.FOREIGN! } });
  expect((await call("POST", `/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: "Foreign attempt" }, "REVIEWER")).statusCode).toBe(404);
  expect(await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).toEqual(f);
  expect(await prisma.governanceFindingReview.count({ where: { findingId: f.id } })).toBe(0);
  expect(await prisma.auditEvent.count({ where: { targetId: f.id, outcome: "SUCCESS" } })).toBe(0);
  expect((await call("GET", `/audit-events?targetId=${f.id}`)).json().events).toEqual([]);
});
it("records denied report access as DENIED for the actual actor without a success event", async () => {
  const before = await prisma.auditEvent.count({ where: { tenantId: tenants[0], actorUserId: actors.READ_ONLY, action: "governance_report.denied" } });
  expect((await call("GET", "/reports/ai-governance", undefined, "READ_ONLY")).statusCode).toBe(403);
  const events = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], actorUserId: actors.READ_ONLY, action: "governance_report.denied" } }); expect(events).toHaveLength(before + 1);
  expect(events.at(-1)).toMatchObject({ outcome: "DENIED", targetType: "GovernanceReport" });
  expect(await prisma.auditEvent.count({ where: { tenantId: tenants[0], actorUserId: actors.READ_ONLY, action: "governance_report.generated" } })).toBe(0);
  const res = await call("GET", "/audit-events?action=governance_report.denied"); expect(res.json().events.map((e: { id: string }) => e.id)).toContain(events.at(-1)!.id);
});
it("preserves a stable older page when a newer event arrives between page requests", async () => {
  const at = new Date("2023-01-01T00:00:00Z");
  const first = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.insert_page", outcome: "SUCCESS", createdAt: at } });
  const older = await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.insert_page", outcome: "SUCCESS", createdAt: new Date(at.getTime() - 1) } });
  const one = await call("GET", "/audit-events?action=section19.insert_page&limit=1"); expect(one.json().events[0].id).toBe(first.id); expect(one.json().nextCursor).toBe(first.id);
  await prisma.auditEvent.create({ data: { tenantId: tenants[0]!, action: "section19.insert_page", outcome: "SUCCESS", createdAt: new Date(at.getTime() + 1) } });
  const two = await call("GET", `/audit-events?action=section19.insert_page&limit=1&cursor=${first.id}`); expect(two.json().events[0].id).toBe(older.id); expect(two.json().nextCursor).toBeNull();
});
it("restricts metadata to the existing scalar allowlist at boundaries", async () => {
  expect(safeAuditMetadata({ format: "PDF", lifecycleScope: "historical", operation: "records", definitionVersion: "999.999", metrics: 0, records: 1000000 })).toEqual({ format: "PDF", lifecycleScope: "historical", operation: "records", definitionVersion: "999.999", metrics: 0, records: 1000000 });
  for (const input of [null, [], "secret", { records: 1000001, metrics: -1, format: {}, operation: [], definitionVersion: "1.0-secret" }, { records: 0.5, metrics: Number.NaN }, { records: Number.POSITIVE_INFINITY }]) expect(safeAuditMetadata(input)).toEqual({});
});
it("ignores forged audit attribution in a real human decision payload", async () => {
  const f = await finding(), since = Date.now();
  expect((await call("POST", `/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: "Actual human", actorUserId: actors.FOREIGN, tenantId: tenants[1], targetId: foreignTargetId, outcome: "DENIED" }, "REVIEWER")).statusCode).toBe(200);
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("OPEN");
  const event = await reconcile("governance_finding.reviewed", f.id, "GovernanceFinding", "REVIEWER", since);
  expect(event.tenantId).not.toBe(tenants[1]); expect(event.actorUserId).not.toBe(actors.FOREIGN);
});
it("preserves rejection, resubmission and closure audit links to both real verification records", async () => {
  const { rem, f } = await governed();
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "REJECTED", rationale: "First review returned" }, "REVIEWER")).statusCode).toBe(200);
  expect((await call("POST", `/governance-remediations/${rem.id}/submit`, {}, "ANALYST")).statusCode).toBe(200);
  expect((await call("POST", `/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale: "Second review verified" }, "REVIEWER")).statusCode).toBe(200);
  const reviews = await prisma.remediationVerification.findMany({ where: { remediationId: rem.id }, orderBy: { createdAt: "asc" } });
  expect(reviews.map(r => [r.decision, r.rationale])).toEqual([["REJECTED", "First review returned"], ["VERIFIED", "Second review verified"]]);
  for (const [action, review] of [["governance_remediation.rejected", reviews[0]!], ["governance_remediation.verified", reviews[1]!]] as const) {
    const events = await prisma.auditEvent.findMany({ where: { targetId: rem.id, action } }); expect(events).toHaveLength(1); expect(events[0]!.metadataJson).toMatchObject({ verificationId: review.id }); expect(events[0]!.actorUserId).toBe(review.verifierUserId);
    expect((await visible(action, rem.id))[0]!.id).toBe(events[0]!.id);
  }
  expect((await prisma.governanceFinding.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("CLOSED");
});
it("gives concurrent report generations distinct traceable audit correlations without lost events", async () => {
  const before = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], action: "governance_report.generated" }, select: { id: true } });
  const results = await Promise.all([call("GET", "/reports/ai-governance"), call("GET", "/reports/ai-governance", undefined, "AUDITOR")]); expect(results.map(r => r.statusCode)).toEqual([200, 200]);
  const events = await prisma.auditEvent.findMany({ where: { tenantId: tenants[0], action: "governance_report.generated", id: { notIn: before.map(e => e.id) } } }); expect(events).toHaveLength(2);
  expect(new Set(events.map(e => e.correlationId)).size).toBe(2); expect(events.every(e => e.correlationId && e.outcome === "SUCCESS")).toBe(true); expect(events.map(e => e.actorUserId).sort()).toEqual([actors.ADMIN, actors.AUDITOR].sort());
  const res = await call("GET", "/audit-events?action=governance_report.generated"); expect(res.json().events.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining(events.map(e => e.id)));
});
