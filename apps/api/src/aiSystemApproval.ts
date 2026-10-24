import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, audit } from "./aiControlEvidence.js";

// All writes use the existing tenant transaction/row-lock guard. No approval is inferred from legacy lifecycle labels.
export async function systemApprovalContext(id: string, tenantId: string) {
  const system = await prisma.aiSystem.findFirst({ where: { id, tenantId } });
  if (!system) return null;
  const [uses, risks, impacts, frameworks, controls, findings, cycles, creator] = await Promise.all([
    prisma.aiUseCase.findMany({ where: { tenantId, aiSystemId: id }, orderBy: { id: "asc" } }),
    prisma.aiRiskAssessment.findMany({ where: { tenantId, aiSystemId: id }, orderBy: { version: "desc" }, include: { risks: { orderBy: { id: "asc" } } } }),
    prisma.aiImpactAssessment.findMany({ where: { tenantId, aiSystemId: id }, orderBy: { version: "desc" }, include: { impacts: { orderBy: { id: "asc" } } } }),
    prisma.aiSystemFrameworkApplicability.findMany({ where: { tenantId, aiSystemId: id }, orderBy: { id: "asc" } }),
    prisma.aiSystemControl.findMany({ where: { tenantId, aiSystemId: id }, orderBy: { id: "asc" }, include: { tests: { where: { tenantId, status: "COMPLETED" }, orderBy: [{ completedAt: "desc" }, { id: "asc" }], take: 1 } } }),
    prisma.governanceFinding.findMany({ where: { tenantId, OR: [{ aiControlTest: { aiSystemControl: { aiSystemId: id } } }, { incidentLinks: { some: { incident: { aiSystemId: id } } } }] }, orderBy: { id: "asc" }, include: { aiControlTest: { select: { aiSystemControlId: true } }, riskAcceptances: { where: { tenantId }, orderBy: { id: "asc" } } } }),
    prisma.aiReassessment.count({ where: { tenantId, aiSystemId: id, status: "IN_PROGRESS" } }),
    prisma.auditEvent.findFirst({ where: { tenantId, targetId: id, action: "ai_system.created" }, orderBy: { createdAt: "asc" }, select: { actorUserId: true } }),
  ]);
  const blockers: string[] = [];
  if (system.lifecycleStatus === "RETIRED") blockers.push("Retired systems cannot be approved");
  if (!system.ownerUserId) blockers.push("A system owner is required");
  if (![system.businessCriticality, system.decisionRole, system.humanOversight, system.impactLevel, system.dataSensitivity].every(Boolean)) blockers.push("Complete the system governance classification");
  if (!uses.some(u => u.status === "APPROVED" && u.reviewDecision === "APPROVED" && u.reviewerUserId && u.reviewedAt) || uses.some(u => u.status === "PENDING_REVIEW")) blockers.push("An approved use case and no pending use-case decisions are required");
  if (!risks.length || risks[0]!.status !== "COMPLETED" || risks[0]!.reviewDecision !== "APPROVED" || !risks[0]!.reviewerUserId || !risks[0]!.assessorUserId) blockers.push("A reviewed risk assessment is required");
  if (!impacts.length || impacts[0]!.status !== "COMPLETED" || impacts[0]!.reviewDecision !== "APPROVED" || !impacts[0]!.reviewerUserId || !impacts[0]!.assessorUserId) blockers.push("A reviewed impact assessment is required");
  if (cycles) blockers.push("Complete the open reassessment before requesting system approval");
  if (!frameworks.length || frameworks.some(f => f.status === "NEEDS_REVIEW")) blockers.push("Record framework applicability decisions");
  const now = Date.now();
  const accepted = (f: typeof findings[number]) => f.riskAcceptances.some(a => a.status === "APPROVED" && a.expiresAt && a.expiresAt.getTime() > now);
  for (const f of frameworks.filter(f => f.status === "APPLICABLE" || f.status === "PARTIALLY_APPLICABLE")) {
    if (!controls.some(c => c.sourceApplicabilityId === f.id)) blockers.push("Applicable frameworks require mapped controls");
  }
  for (const control of controls) {
    const framework = frameworks.find(f => f.id === control.sourceApplicabilityId);
    if (!framework || framework.status === "NOT_APPLICABLE" || control.applicability === "NOT_APPLICABLE") continue;
    if (!control.ownerUserId || control.applicability === "NOT_ASSESSED") blockers.push("Applicable controls require ownership and applicability");
    const open = findings.filter(f => f.aiControlTest?.aiSystemControlId === control.id && (f.status === "OPEN" || f.status === "PENDING_REVIEW"));
    const exception = open.length > 0 && open.every(f => f.status === "OPEN" && accepted(f));
    if (control.tests[0]?.overallEffectiveness !== "EFFECTIVE" && !exception) blockers.push("Applicable controls require effective completed tests or explicit active accepted exceptions");
  }
  if (findings.some(f => ["HIGH", "CRITICAL"].includes(f.severity) && ["OPEN", "PENDING_REVIEW"].includes(f.status) && !(f.status === "OPEN" && accepted(f)))) blockers.push("Resolve or explicitly accept outstanding HIGH/CRITICAL findings");
  const { lifecycleStatus: _lifecycle, updatedAt: _updated, retiredAt: _retired, ...profile } = system;
  void _lifecycle; void _updated; void _retired;
  const contextHash = createHash("sha256").update(JSON.stringify({ profile, uses, risks, impacts, frameworks, controls, findings, cycles })).digest("hex");
  const independentOfUserIds = [...new Set([system.ownerUserId, creator?.actorUserId, ...risks.map(a => a.assessorUserId), ...impacts.map(a => a.assessorUserId)].filter((x): x is string => Boolean(x)))].sort();
  return { blockers: [...new Set(blockers)], contextHash, independentOfUserIds, system };
}

export async function productionApprovalIssue(id: string, tenantId: string) {
  const context = await systemApprovalContext(id, tenantId);
  if (!context) return "AI system not found";
  if (context.blockers.length) return context.blockers.join("; ");
  const decision = await prisma.aiSystemApproval.findFirst({ where: { tenantId, aiSystemId: id, status: "APPROVED", contextHash: context.contextHash }, orderBy: { decidedAt: "desc" } });
  return decision ? null : "An independent system approval for the current governance context is required";
}

export async function registerSystemApprovalRoutes(app: FastifyInstance) {
  app.get("/ai-systems/:id/approval", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) return reply.code(401).send({ error: "Not logged in" });
    if (!hasPermission(session, "ai-system:read")) return reply.code(403).send({ error: "Not authorized" });
    const context = await systemApprovalContext((request.params as { id: string }).id, session.tenantId);
    if (!context) return reply.code(404).send({ error: "AI system not found" });
    const history = await prisma.aiSystemApproval.findMany({ where: { tenantId: session.tenantId, aiSystemId: context.system.id }, orderBy: { requestedAt: "desc" } });
    return { blockers: context.blockers, history, contextHash: context.contextHash };
  });
  app.post("/ai-systems/:id/approval-request", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) return reply.code(401).send({ error: "Not logged in" });
    if (!hasPermission(session, "ai-system:update")) return reply.code(403).send({ error: "Not authorized" });
    const rationale = cleanText((request.body as { rationale?: unknown } | null)?.rationale, 4000);
    if (!rationale) return reply.code(400).send({ error: "A request rationale is required" });
    const context = await systemApprovalContext((request.params as { id: string }).id, session.tenantId);
    if (!context) return reply.code(404).send({ error: "AI system not found" });
    if (context.blockers.length) return reply.code(409).send({ error: context.blockers.join("; ") });
    if (await prisma.aiSystemApproval.findFirst({ where: { tenantId: session.tenantId, activeRequestKey: context.system.id } })) return reply.code(409).send({ error: "A system approval request is already pending; decide or cancel it first" });
    const record = await prisma.aiSystemApproval.create({ data: { tenantId: session.tenantId, aiSystemId: context.system.id, activeRequestKey: context.system.id, requestedByUserId: session.userId!, requestRationale: rationale, contextHash: context.contextHash, independentOfUserIds: context.independentOfUserIds } });
    await prisma.aiSystem.update({ where: { id: context.system.id }, data: { lifecycleStatus: "PENDING_APPROVAL" } });
    await audit(session, "ai_system.approval_requested", "AiSystemApproval", record.id, { aiSystemId: context.system.id });
    return reply.code(201).send(record);
  });
  app.post("/ai-system-approvals/:id/decision", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) return reply.code(401).send({ error: "Not logged in" });
    if (!hasPermission(session, "ai-system:approve")) return reply.code(403).send({ error: "Not authorized to decide system approval" });
    const row = await prisma.aiSystemApproval.findFirst({ where: { id: (request.params as { id: string }).id, tenantId: session.tenantId } });
    if (!row) return reply.code(404).send({ error: "System approval not found" });
    const body = request.body as { decision?: unknown; rationale?: unknown } | null;
    const rationale = cleanText(body?.rationale, 4000);
    if (!rationale || typeof body?.decision !== "string" || !["APPROVED", "REJECTED"].includes(body.decision)) return reply.code(400).send({ error: "An APPROVED/REJECTED decision and rationale are required" });
    if (row.status !== "PENDING_REVIEW") return reply.code(409).send({ error: "System approval already decided" });
    const context = await systemApprovalContext(row.aiSystemId, session.tenantId);
    if (!context) return reply.code(404).send({ error: "AI system not found" });
    if ([row.requestedByUserId, ...row.independentOfUserIds, ...context.independentOfUserIds].includes(session.userId!)) {
      await audit(session, "ai_system.approval_denied", "AiSystemApproval", row.id, { reason: "independent_review_required" }, "DENIED");
      return reply.code(403).send({ error: "Independent reviewer required: requester, owner, creator and assessors cannot decide" });
    }
    if (body?.decision === "APPROVED" && (context.blockers.length || context.contextHash !== row.contextHash || context.system.lifecycleStatus !== "PENDING_APPROVAL")) return reply.code(409).send({ error: "Governance context changed or is incomplete; cancel and resubmit for review" });
    const changed = await prisma.aiSystemApproval.updateMany({ where: { id: row.id, tenantId: session.tenantId, status: "PENDING_REVIEW" }, data: { status: body!.decision as string, activeRequestKey: null, decidedByUserId: session.userId!, decidedAt: new Date(), decisionRationale: rationale } });
    if (!changed.count) return reply.code(409).send({ error: "System approval already decided" });
    if (body!.decision === "APPROVED") await prisma.aiSystem.update({ where: { id: row.aiSystemId }, data: { lifecycleStatus: "APPROVED" } });
    else await prisma.aiSystem.updateMany({ where: { id: row.aiSystemId, tenantId: session.tenantId, lifecycleStatus: "PENDING_APPROVAL" }, data: { lifecycleStatus: "ASSESSMENT" } });
    await audit(session, "ai_system.approval_decided", "AiSystemApproval", row.id, { aiSystemId: row.aiSystemId, decision: body!.decision as string, rationale });
    return prisma.aiSystemApproval.findUnique({ where: { id: row.id } });
  });
  app.post("/ai-system-approvals/:id/cancel", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) return reply.code(401).send({ error: "Not logged in" });
    const row = await prisma.aiSystemApproval.findFirst({ where: { id: (request.params as { id: string }).id, tenantId: session.tenantId } });
    if (!row) return reply.code(404).send({ error: "System approval not found" });
    if (!hasPermission(session, "ai-system:update") || row.requestedByUserId !== session.userId) return reply.code(403).send({ error: "Only the requester may cancel their pending approval request" });
    const rationale = cleanText((request.body as { rationale?: unknown } | null)?.rationale, 4000);
    if (!rationale) return reply.code(400).send({ error: "A cancellation rationale is required" });
    if (row.status !== "PENDING_REVIEW") return reply.code(409).send({ error: "System approval already decided" });
    await prisma.aiSystemApproval.update({ where: { id: row.id }, data: { status: "CANCELLED", activeRequestKey: null, decidedByUserId: session.userId!, decidedAt: new Date(), decisionRationale: rationale } });
    await prisma.aiSystem.updateMany({ where: { id: row.aiSystemId, tenantId: session.tenantId, lifecycleStatus: "PENDING_APPROVAL" }, data: { lifecycleStatus: "ASSESSMENT" } });
    await audit(session, "ai_system.approval_cancelled", "AiSystemApproval", row.id, { aiSystemId: row.aiSystemId });
    return { cancelled: true };
  });
}
