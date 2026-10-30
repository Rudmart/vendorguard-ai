import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma, frameworkVisibility, type Prisma } from "@vendorguard/database";
import { roleHasPermission, type Role } from "@vendorguard/shared";
import { resolveSession, type ApiSession } from "./session.js";
import { cleanText } from "./aiControlEvidence.js";

export const VENDOR_REASSESSMENT_TRIGGERS = ["SCHEDULED_REVIEW", "MATERIAL_VENDOR_CHANGE", "MODEL_SERVICE_CHANGE", "SECURITY_INCIDENT", "NEW_EVIDENCE", "CONTROL_FAILURE", "CONTRACT_REGULATORY_CHANGE", "RISK_RATING_CHANGE"] as const;
const fail = (statusCode: number, message: string): never => { throw Object.assign(new Error(message), { statusCode }); };
const permission = (s: ApiSession, name: string) => roleHasPermission(s.role as Role, name);
function bodyOf(r: FastifyRequest): Record<string, unknown> {
  if (!r.body || typeof r.body !== "object" || Array.isArray(r.body)) fail(400, "An object body is required");
  return r.body as Record<string, unknown>;
}
function text(value: unknown, label: string) { const result = cleanText(value, 4000); return result || fail(400, `${label} is required (maximum 4000 characters)`); }
function optionalId(value: unknown) { if (value === undefined || value === null) return null; if (typeof value !== "string" || !value.trim() || value.length > 200) fail(400, "Invalid resource identifier"); return (value as string).trim(); }
function date(value: unknown, required = false): Date | null {
  if ((value === undefined || value === null || value === "") && !required) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return fail(400, "Invalid date");
  const [y, m, d] = value.slice(0, 10).split("-").map(Number); const calendar = new Date(Date.UTC(y!, m! - 1, d!));
  const result = new Date(value); if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(result.getTime())) fail(400, "Invalid date");
  return result;
}
async function vendorOf(tx: Prisma.TransactionClient, tenantId: string, id: string, lock = false) {
  if (lock) await tx.$queryRaw`SELECT id FROM vendors WHERE id=${id} AND "tenantId"=${tenantId} FOR UPDATE`;
  return await tx.vendor.findFirst({ where: { id, tenantId, deletedAt: null } }) || fail(404, "Vendor not found");
}
async function snapshot(tx: Prisma.TransactionClient, tenantId: string, vendorId: string, assessmentId: string, findingId: string | null) {
  const vendor = await vendorOf(tx, tenantId, vendorId);
  await tx.$queryRaw`SELECT id FROM assessments WHERE id=${assessmentId} AND "tenantId"=${tenantId} AND "vendorId"=${vendorId} FOR SHARE`;
  if (findingId) await tx.$queryRaw`SELECT id FROM control_findings WHERE id=${findingId} AND "tenantId"=${tenantId} FOR SHARE`;
  const assessment = await tx.assessment.findFirst({ where: { id: assessmentId, tenantId, vendorId }, select: { id: true, status: true, scoringModelVersion: true, inherentScore: true, residualScore: true, riskBand: true, aiInherentScore: true, aiResidualScore: true, aiRiskBand: true, impactScore: true, impactBand: true } }) || fail(404, "Assessment not found");
  const finding = findingId ? await tx.controlFinding.findFirst({ where: { id: findingId, tenantId, vendorId, assessmentId }, select: { id: true, status: true, requiresHumanReview: true, proposedByUserId: true, reviewDecisions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, decision: true } } } }) : null;
  if (findingId && !finding) fail(404, "Finding not found");
  if (finding && (finding.requiresHumanReview || !finding.reviewDecisions.length)) fail(409, "Complete independent finding review before requesting acceptance");
  const value = { assessmentId: assessment.id, ...assessment, vendorId, vendorUpdatedAt: vendor.updatedAt.toISOString(), finding };
  return { value: value as unknown as Prisma.InputJsonValue, hash: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
function event(tx: Prisma.TransactionClient, s: ApiSession, action: string, targetType: string, targetId: string, metadataJson: Prisma.InputJsonValue, outcome = "SUCCESS") {
  return tx.auditEvent.create({ data: { tenantId: s.tenantId, actorUserId: s.userId, action, targetType, targetId, metadataJson, outcome } });
}
export async function registerVendorGovernanceRoutes(app: FastifyInstance) {
  type Handler = (r: FastifyRequest, reply: FastifyReply, s: ApiSession) => Promise<unknown>;
  const guard = (handler: Handler) => async (r: FastifyRequest, reply: FastifyReply) => {
    const s = await resolveSession(r); if (!s) return reply.code(401).send({ error: "Not logged in" });
    try { return await handler(r, reply, s); } catch (error) { const e = error as Error & { statusCode?: number }; if (!e.statusCode) r.log.error({ err: error }, "Vendor governance operation failed"); return reply.code(e.statusCode ?? 500).send({ error: e.statusCode ? e.message : "Vendor governance operation failed" }); }
  };
  app.get("/frameworks/available", guard(async (r, reply, s) => {
    if (!permission(s, "assessment:read")) fail(403, "Not authorized");
    const entries = await prisma.framework.findMany({ where: { ...frameworkVisibility(s.tenantId), scope: "VENDOR_ASSESSMENT" }, orderBy: { name: "asc" }, include: { versions: { where: { isCurrent: true, controls: { some: {} } }, orderBy: { createdAt: "desc" }, take: 1, select: { version: true, sourceUrl: true, licenseNote: true, _count: { select: { controls: true } } } } } });
    return { frameworks: entries.filter(f => f.versions.length).map(f => ({ frameworkId: f.catalogId, frameworkName: f.name, version: f.versions[0]!.version, controlCount: f.versions[0]!._count.controls, sourceUrl: f.versions[0]!.sourceUrl, licenseNote: f.versions[0]!.licenseNote })) };
  }));
  app.post("/vendors/:id/risk-acceptance", guard(async (r, reply, s) => {
    if (!permission(s, "assessment:create") && !permission(s, "risk:accept")) fail(403, "Not authorized to request risk acceptance");
    const b = bodyOf(r), vendorId = (r.params as { id: string }).id;
    const justification = text(b.justification, "Justification"), residualRiskStatement = text(b.residualRiskStatement, "Residual risk statement"), expiresAt = date(b.expiresAt, true)!;
    if (expiresAt.getTime() <= Date.now()) fail(400, "Acceptance expiry must be in the future");
    const assessmentId = optionalId(b.assessmentId) || fail(400, "Select an assessment"), findingId = optionalId(b.findingId);
    const row = await prisma.$transaction(async tx => {
      await vendorOf(tx, s.tenantId, vendorId, true); const context = await snapshot(tx, s.tenantId, vendorId, assessmentId, findingId);
      const row = await tx.riskAcceptance.create({ data: { tenantId: s.tenantId, vendorId, assessmentId, vendorFindingId: findingId, justification, residualRiskStatement, expiresAt, requestedByUserId: s.userId, status: "PENDING_REVIEW", vendorRiskSnapshot: context.value, vendorRiskContextHash: context.hash, conditions: b.conditions === undefined ? null : text(b.conditions, "Conditions") } });
      await event(tx, s, "vendor.risk_acceptance_requested", "RiskAcceptance", row.id, { vendorId, assessmentId, findingId }); return row;
    });
    return reply.code(201).send({ riskAcceptance: row });
  }));
  app.get("/vendors/:id/risk-acceptance", guard(async (r, reply, s) => {
    if (!permission(s, "vendor:read")) fail(403, "Not authorized"); const id = (r.params as { id: string }).id; await vendorOf(prisma, s.tenantId, id);
    return { riskAcceptances: await prisma.riskAcceptance.findMany({ where: { tenantId: s.tenantId, vendorId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }) };
  }));
  app.post("/vendor-risk-acceptances/:id/decision", guard(async (r, reply, s) => {
    if (!permission(s, "risk:accept")) fail(403, "Not authorized to decide risk acceptance");
    const id = (r.params as { id: string }).id, b = bodyOf(r), rationale = text(b.rationale, "Decision rationale");
    if (b.decision !== "APPROVED" && b.decision !== "REJECTED") fail(400, "Decision must be APPROVED or REJECTED"); const decision = b.decision as "APPROVED" | "REJECTED";
    const result = await prisma.$transaction(async tx => {
      const initial = await tx.riskAcceptance.findFirst({ where: { id, tenantId: s.tenantId, vendorId: { not: null } } }) || fail(404, "Acceptance not found");
      await vendorOf(tx, s.tenantId, initial.vendorId!, true);
      const row = await tx.riskAcceptance.findUniqueOrThrow({ where: { id } });
      if (row.status !== "PENDING_REVIEW" || !row.requestedByUserId || !row.vendorRiskContextHash) fail(409, "Acceptance already decided or requires explicit legacy reconciliation");
      if (row.requestedByUserId === s.userId) { await event(tx, s, "vendor.risk_acceptance_denied", "RiskAcceptance", id, { reason: "independent_review_required" }, "DENIED"); return { denied: true } as const; }
      if (decision === "APPROVED") {
        if (!row.expiresAt || row.expiresAt.getTime() <= Date.now()) fail(409, "Acceptance request expired");
        const current = await snapshot(tx, s.tenantId, row.vendorId!, row.assessmentId!, row.vendorFindingId);
        if (current.hash !== row.vendorRiskContextHash) fail(409, "Source risk changed; reject this request and submit a fresh snapshot");
      }
      const riskAcceptance = await tx.riskAcceptance.update({ where: { id }, data: { status: decision, approvedByUserId: decision === "APPROVED" ? s.userId : null, decidedByUserId: s.userId, decidedAt: new Date(), decisionRationale: rationale } });
      await event(tx, s, "vendor.risk_acceptance_decided", "RiskAcceptance", id, { vendorId: row.vendorId, decision, rationale }); return { riskAcceptance };
    });
    return "denied" in result ? reply.code(403).send({ error: "Requester cannot decide their own acceptance" }) : result;
  }));
  app.get("/vendors/:id/monitoring", guard(async (r, reply, s) => {
    if (!permission(s, "vendor:read")) fail(403, "Not authorized"); const id = (r.params as { id: string }).id; const vendor = await vendorOf(prisma, s.tenantId, id);
    const [assessments, reassessments, acceptances] = await Promise.all([
      prisma.assessment.findMany({ where: { tenantId: s.tenantId, vendorId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true, status: true, riskBand: true, residualScore: true, aiRiskBand: true, aiResidualScore: true, questionnaires: { select: { id: true, status: true } }, findings: { select: { id: true, status: true, requiresHumanReview: true } } } }),
      prisma.vendorReassessment.findMany({ where: { tenantId: s.tenantId, vendorId: id }, orderBy: { startedAt: "desc" } }),
      prisma.riskAcceptance.findMany({ where: { tenantId: s.tenantId, vendorId: id, status: "APPROVED" }, select: { id: true, expiresAt: true } }),
    ]);
    return { vendorId: id, contractReviewDate: vendor.contractReviewDate, reviewDue: !!vendor.contractReviewDate && vendor.contractReviewDate.getTime() <= Date.now(), expiredAcceptances: acceptances.filter(a => a.expiresAt && a.expiresAt.getTime() <= Date.now()).map(a => a.id), assessments, reassessments, triggers: VENDOR_REASSESSMENT_TRIGGERS };
  }));
  app.get("/vendor-monitoring", guard(async (r, reply, s) => {
    if (!permission(s, "vendor:read")) fail(403, "Not authorized");
    const now = Date.now();
    const rows = await prisma.vendor.findMany({ where: { tenantId: s.tenantId, deletedAt: null }, orderBy: { legalName: "asc" }, select: { id: true, contractReviewDate: true, reassessments: { where: { status: "IN_PROGRESS" }, select: { targetDate: true } }, riskAcceptances: { where: { status: "APPROVED" }, select: { expiresAt: true } } } });
    return { vendors: rows.map(v => ({ id: v.id, contractReviewDate: v.contractReviewDate, reviewDue: !!v.contractReviewDate && v.contractReviewDate.getTime() <= now, activeReassessments: v.reassessments.length, overdueReassessments: v.reassessments.filter(c => c.targetDate && c.targetDate.getTime() < now).length, expiredAcceptances: v.riskAcceptances.filter(a => a.expiresAt && a.expiresAt.getTime() <= now).length })) };
  }));
  app.post("/vendors/:id/reassessments", guard(async (r, reply, s) => {
    if (!permission(s, "assessment:create")) fail(403, "Not authorized to initiate reassessment");
    const vendorId = (r.params as { id: string }).id, b = bodyOf(r), priorAssessmentId = optionalId(b.priorAssessmentId) || fail(400, "Prior assessment is required");
    if (!VENDOR_REASSESSMENT_TRIGGERS.includes(b.trigger as never)) fail(400, "Invalid reassessment trigger");
    const rationale = text(b.rationale, "Rationale"), materialChanges = text(b.materialChanges, "Material changes"), targetDate = date(b.targetDate);
    const reassessment = await prisma.$transaction(async tx => {
      await vendorOf(tx, s.tenantId, vendorId, true);
      const prior = await tx.assessment.findFirst({ where: { id: priorAssessmentId, vendorId, tenantId: s.tenantId }, include: { frameworks: true } }) || fail(404, "Prior assessment not found");
      if (await tx.vendorReassessment.findFirst({ where: { tenantId: s.tenantId, vendorId, status: "IN_PROGRESS" } })) fail(409, "A vendor reassessment is already in progress");
      const context = await snapshot(tx, s.tenantId, vendorId, prior.id, null);
      const next = await tx.assessment.create({ data: { tenantId: s.tenantId, vendorId, status: "DRAFT", scoringModelVersion: prior.scoringModelVersion, startedByUserId: s.userId } });
      for (const f of prior.frameworks) {
        const visible = await tx.framework.findFirst({ where: { id: f.frameworkId, ...frameworkVisibility(s.tenantId) } });
        if (visible) await tx.assessmentFramework.create({ data: { tenantId: s.tenantId, assessmentId: next.id, frameworkId: f.frameworkId, frameworkVersion: f.frameworkVersion, applicabilityReason: "reassessment-prior-selection: revalidate applicability" } });
      }
      const row = await tx.vendorReassessment.create({ data: { tenantId: s.tenantId, vendorId, priorAssessmentId: prior.id, newAssessmentId: next.id, activeKey: vendorId, trigger: b.trigger as string, rationale, materialChanges, targetDate, startedByUserId: s.userId, priorSnapshot: context.value } });
      await event(tx, s, "assessment.created", "Assessment", next.id, { vendorId, priorAssessmentId: prior.id, reassessmentId: row.id });
      await event(tx, s, "vendor.reassessment_started", "VendorReassessment", row.id, { vendorId, priorAssessmentId: prior.id, newAssessmentId: next.id, trigger: row.trigger }); return row;
    });
    return reply.code(201).send({ reassessment });
  }));
  app.post("/vendor-reassessments/:id/complete", guard(async (r, reply, s) => {
    if (!permission(s, "risk:accept")) fail(403, "Independent authorized reviewer required"); const id = (r.params as { id: string }).id, rationale = text(bodyOf(r).rationale, "Completion rationale");
    const result = await prisma.$transaction(async tx => {
      const initial = await tx.vendorReassessment.findFirst({ where: { id, tenantId: s.tenantId } }) || fail(404, "Reassessment not found"); await vendorOf(tx, s.tenantId, initial.vendorId, true);
      const row = await tx.vendorReassessment.findUniqueOrThrow({ where: { id } }); if (row.status !== "IN_PROGRESS") fail(409, "Reassessment already completed");
      await tx.$queryRaw`SELECT id FROM assessments WHERE id=${row.newAssessmentId} AND "tenantId"=${s.tenantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM questionnaires WHERE "assessmentId"=${row.newAssessmentId} AND "tenantId"=${s.tenantId} ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM control_findings WHERE "assessmentId"=${row.newAssessmentId} AND "tenantId"=${s.tenantId} ORDER BY id FOR SHARE`;
      const questionnaires = await tx.questionnaire.findMany({ where: { tenantId: s.tenantId, assessmentId: row.newAssessmentId } });
      if (!questionnaires.length || questionnaires.some(q => q.status !== "APPROVED" || !q.submittedByUserId || !q.reviewedByUserId || !q.approvedByUserId || q.submittedByUserId === q.approvedByUserId)) fail(409, "Complete independent questionnaire review and approval first");
      if (row.startedByUserId === s.userId || questionnaires.some(q => q.submittedByUserId === s.userId)) fail(403, "Reassessment requires independent completion");
      if (await tx.controlFinding.count({ where: { tenantId: s.tenantId, assessmentId: row.newAssessmentId, requiresHumanReview: true } })) fail(409, "Complete pending finding reviews first");
      const updated = await tx.vendorReassessment.update({ where: { id }, data: { status: "COMPLETED", activeKey: null, completedByUserId: s.userId, completedAt: new Date(), conclusion: rationale } });
      await event(tx, s, "vendor.reassessment_completed", "VendorReassessment", id, { vendorId: row.vendorId, newAssessmentId: row.newAssessmentId, rationale }); return { reassessment: updated };
    }); return result;
  }));
  app.patch("/vendor-reassessments/:id", guard(async (r, reply, s) => {
    if (!permission(s, "assessment:create")) fail(403, "Not authorized to update reassessment");
    const id = (r.params as { id: string }).id, b = bodyOf(r), materialChanges = text(b.materialChanges, "Material changes"), targetDate = date(b.targetDate);
    const reassessment = await prisma.$transaction(async tx => {
      const initial = await tx.vendorReassessment.findFirst({ where: { id, tenantId: s.tenantId } }) || fail(404, "Reassessment not found"); await vendorOf(tx, s.tenantId, initial.vendorId, true);
      const row = await tx.vendorReassessment.findUniqueOrThrow({ where: { id } });
      if (row.status !== "IN_PROGRESS") fail(409, "Completed reassessments cannot be changed");
      if (row.startedByUserId !== s.userId && s.role !== "ADMIN") fail(403, "Only the initiator or ADMIN can update the change record");
      const updated = await tx.vendorReassessment.update({ where: { id }, data: { materialChanges, targetDate } });
      await event(tx, s, "vendor.reassessment_updated", "VendorReassessment", id, { vendorId: row.vendorId, previousMaterialChanges: row.materialChanges, materialChanges }); return updated;
    }); return { reassessment };
  }));
}
