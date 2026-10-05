/**
 * Step 14 - Reassessment & Governance Review Cycle.
 *
 * A lightweight orchestration/history record for a governed reassessment cycle of an existing AI system.
 * It REFERENCES existing governance records (prior/new risk + impact assessments, optional Risk Acceptance)
 * and snapshots only a small set of AiSystem classification fields at start and at completion.
 * It never clones controls, evidence, tests, Findings, remediation or acceptances, never changes the
 * AI system, never renews an acceptance, and has no automatic triggers.
 * Lifecycle: IN_PROGRESS -> COMPLETED (immutable). One IN_PROGRESS cycle per AI system (DB-enforced).
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, parseOptionalDate, audit } from "./aiControlEvidence.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";

export const REASSESSMENT_REASONS = ["PERIODIC_REVIEW", "MATERIAL_CHANGE", "REMEDIATION_COMPLETED", "RISK_ACCEPTANCE_REVIEW", "REGULATORY_CHANGE", "OTHER"] as const;
type Reason = (typeof REASSESSMENT_REASONS)[number];
export const REASSESSMENT_CONCLUSIONS = ["NO_MATERIAL_CHANGE", "GOVERNANCE_UPDATED", "FOLLOW_UP_REQUIRED"] as const;
type Conclusion = (typeof REASSESSMENT_CONCLUSIONS)[number];

/** The only AiSystem fields snapshotted: description (where the use case lives today) + classification. */
export const SNAPSHOT_FIELDS = [
  "description",
  "lifecycleStatus",
  "category",
  "riskTier",
  "businessCriticality",
  "decisionRole",
  "humanOversight",
  "impactLevel",
  "dataSensitivity",
  "dataCategories",
  "affectedPopulation",
  "externalImpact",
  "regulatoryRelevance",
] as const;

const USER_SELECT = { id: true, displayName: true, email: true } as const;
const ASSESSMENT_SELECT = { id: true, name: true, version: true, status: true, reviewDecision: true, reviewedAt: true, createdAt: true } as const;
const LOCKED = "This reassessment is completed and locked. Start a new reassessment for a later governance cycle.";

function isReason(value: unknown): value is Reason {
  return typeof value === "string" && (REASSESSMENT_REASONS as readonly string[]).includes(value);
}

function isConclusion(value: unknown): value is Conclusion {
  return typeof value === "string" && (REASSESSMENT_CONCLUSIONS as readonly string[]).includes(value);
}

export function snapshotOf(system: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of SNAPSHOT_FIELDS) {
    out[field] = system[field] ?? null;
  }
  return out;
}

export function classificationChanges(start: unknown, end: unknown) {
  const a = (start ?? {}) as Record<string, unknown>;
  const b = (end ?? {}) as Record<string, unknown>;
  return SNAPSHOT_FIELDS.filter((field) => JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null)).map((field) => ({
    field,
    before: a[field] ?? null,
    after: b[field] ?? null,
  }));
}

async function userMap(ids: Array<string | null>) {
  const unique = Array.from(new Set(ids.filter((v): v is string => typeof v === "string")));
  if (unique.length === 0) {
    return new Map<string, { id: string; displayName: string; email: string }>();
  }
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: USER_SELECT });
  return new Map(users.map((u) => [u.id, u]));
}

type LinkResult = { ok: true; id: string | null } | { ok: false; status: number; error: string };

async function linkRisk(value: unknown, tenantId: string, aiSystemId: string, startedAt: Date): Promise<LinkResult> {
  if (value === null || value === "") {
    return { ok: true, id: null };
  }
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "newRiskAssessmentId must be text" };
  }
  const found = await prisma.aiRiskAssessment.findFirst({ where: { id: value, tenantId }, select: { id: true, aiSystemId: true, createdAt: true } });
  if (!found) {
    return { ok: false, status: 404, error: "Risk assessment not found" };
  }
  if (found.aiSystemId !== aiSystemId) {
    return { ok: false, status: 400, error: "The risk assessment must belong to the same AI system" };
  }
  if (found.createdAt.getTime() < startedAt.getTime()) {
    return { ok: false, status: 400, error: "Link a NEW risk assessment created after this reassessment started - earlier assessments are the baseline" };
  }
  return { ok: true, id: found.id };
}

async function linkImpact(value: unknown, tenantId: string, aiSystemId: string, startedAt: Date): Promise<LinkResult> {
  if (value === null || value === "") {
    return { ok: true, id: null };
  }
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "newImpactAssessmentId must be text" };
  }
  const found = await prisma.aiImpactAssessment.findFirst({ where: { id: value, tenantId }, select: { id: true, aiSystemId: true, createdAt: true } });
  if (!found) {
    return { ok: false, status: 404, error: "Impact assessment not found" };
  }
  if (found.aiSystemId !== aiSystemId) {
    return { ok: false, status: 400, error: "The impact assessment must belong to the same AI system" };
  }
  if (found.createdAt.getTime() < startedAt.getTime()) {
    return { ok: false, status: 400, error: "Link a NEW impact assessment created after this reassessment started - earlier assessments are the baseline" };
  }
  return { ok: true, id: found.id };
}

async function linkAcceptance(value: unknown, tenantId: string, aiSystemId: string): Promise<LinkResult> {
  if (value === undefined || value === null || value === "") {
    return { ok: true, id: null };
  }
  if (typeof value !== "string") {
    return { ok: false, status: 400, error: "relatedRiskAcceptanceId must be text" };
  }
  const found = await prisma.riskAcceptance.findFirst({
    where: { id: value, tenantId, aiRiskId: { not: null } },
    select: { id: true, aiRisk: { select: { assessment: { select: { aiSystemId: true } } } } },
  });
  if (!found) {
    return { ok: false, status: 404, error: "Risk Acceptance not found" };
  }
  if (found.aiRisk?.assessment.aiSystemId !== aiSystemId) {
    return { ok: false, status: 400, error: "The Risk Acceptance must concern a risk of the same AI system" };
  }
  return { ok: true, id: found.id };
}

export async function registerReassessmentRoutes(app: FastifyInstance): Promise<void> {
  // 1. Initiate a reassessment (human-initiated; no automatic triggers).
  app.post("/ai-systems/:id/reassessments", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to initiate a reassessment" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!isReason(body.reason)) {
      return reply.status(400).send({ error: "reason must be one of: " + REASSESSMENT_REASONS.join(", ") });
    }
    const whatChanged = cleanText(body.whatChanged, 4000);
    if (!whatChanged) {
      return reply.status(400).send({ error: "Describe what changed or why the reassessment is needed (whatChanged, max 4000 characters)" });
    }
    if (body.materialChange !== undefined && typeof body.materialChange !== "boolean") {
      return reply.status(400).send({ error: "materialChange must be true or false" });
    }
    const materialChange = body.materialChange === true;
    let materialChangeDescription: string | null = null;
    if (materialChange) {
      materialChangeDescription = cleanText(body.materialChangeDescription, 4000);
      if (!materialChangeDescription) {
        return reply.status(400).send({ error: "A material change needs a description of why it matters" });
      }
    }
    const targetDate = parseOptionalDate(body.targetDate);
    if (targetDate === "invalid") {
      return reply.status(400).send({ error: "targetDate must be a valid date" });
    }
    if (body.relatedRiskAcceptanceId && body.reason !== "RISK_ACCEPTANCE_REVIEW") {
      return reply.status(400).send({ error: "A Risk Acceptance can only be linked when the reason is RISK_ACCEPTANCE_REVIEW" });
    }
    const acceptance = await linkAcceptance(body.relatedRiskAcceptanceId, session.tenantId, aiSystem.id);
    if (!acceptance.ok) {
      return reply.status(acceptance.status).send({ error: acceptance.error });
    }
    const priorRisk = await prisma.aiRiskAssessment.findFirst({
      where: { tenantId: session.tenantId, aiSystemId: aiSystem.id, status: "COMPLETED" },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    const priorImpact = await prisma.aiImpactAssessment.findFirst({
      where: { tenantId: session.tenantId, aiSystemId: aiSystem.id, status: "COMPLETED" },
      orderBy: { version: "desc" },
      select: { id: true },
    });
    try {
      const created = await prisma.aiReassessment.create({
        data: {
          tenantId: session.tenantId,
          aiSystemId: aiSystem.id,
          reason: body.reason,
          status: "IN_PROGRESS",
          openCycleKey: aiSystem.id,
          whatChanged,
          materialChange,
          materialChangeDescription,
          targetDate,
          priorRiskAssessmentId: priorRisk?.id ?? null,
          priorImpactAssessmentId: priorImpact?.id ?? null,
          relatedRiskAcceptanceId: acceptance.id,
          snapshotAtStart: snapshotOf(aiSystem) as never,
          initiatedByUserId: userId,
        },
      });
      await audit(session, "ai_reassessment.initiated", "AiReassessment", created.id, {
        aiSystemId: aiSystem.id,
        reason: body.reason,
        materialChange,
        priorRiskAssessmentId: priorRisk?.id ?? null,
        priorImpactAssessmentId: priorImpact?.id ?? null,
      });
      return reply.status(201).send(created);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "This AI system already has a reassessment in progress" });
      }
      throw err;
    }
  });

  // 2. Reassessment history for an AI system.
  app.get("/ai-systems/:id/reassessments", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view reassessments" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const rows = await prisma.aiReassessment.findMany({
      where: { tenantId: session.tenantId, aiSystemId: aiSystem.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, reason: true, status: true, conclusion: true, materialChange: true, targetDate: true, createdAt: true, completedAt: true, initiatedByUserId: true },
    });
    const users = await userMap(rows.map((r) => r.initiatedByUserId));
    const now = Date.now();
    return reply.send({
      reassessments: rows.map((r) => ({
        ...r,
        initiatedBy: users.get(r.initiatedByUserId) ?? null,
        pastTarget: r.status === "IN_PROGRESS" && r.targetDate !== null && r.targetDate.getTime() < now,
      })),
    });
  });

  // 3. Reassessment detail with governance context.
  app.get("/ai-reassessments/:id", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view reassessments" });
    }
    const { id } = request.params as { id: string };
    const r = await prisma.aiReassessment.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        aiSystem: { select: { id: true, name: true } },
        priorRiskAssessment: { select: ASSESSMENT_SELECT },
        newRiskAssessment: { select: ASSESSMENT_SELECT },
        priorImpactAssessment: { select: ASSESSMENT_SELECT },
        newImpactAssessment: { select: ASSESSMENT_SELECT },
        relatedRiskAcceptance: {
          select: { id: true, status: true, expiresAt: true, decidedAt: true, residualScoreAtRequest: true, residualRatingAtRequest: true, aiRisk: { select: { id: true, title: true } } },
        },
      },
    });
    if (!r) {
      return reply.status(404).send({ error: "Reassessment not found" });
    }
    const live = await prisma.aiSystem.findFirst({ where: { id: r.aiSystemId, tenantId: session.tenantId } });
    const end = r.status === "COMPLETED" ? r.snapshotAtCompletion : snapshotOf(live ?? {});
    const users = await userMap([r.initiatedByUserId, r.completedByUserId]);
    const openFindings = await prisma.governanceFinding.findMany({
      where: { tenantId: session.tenantId, status: "OPEN", aiControlTest: { aiSystemControl: { aiSystemId: r.aiSystemId } } },
      select: { id: true, title: true, severity: true },
    });
    const acceptances = await prisma.riskAcceptance.findMany({
      where: { tenantId: session.tenantId, status: "APPROVED", aiRisk: { assessment: { aiSystemId: r.aiSystemId } } },
      select: { id: true, status: true, expiresAt: true, aiRisk: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
    });
    const availableRisk =
      r.status === "IN_PROGRESS"
        ? await prisma.aiRiskAssessment.findMany({
            where: { tenantId: session.tenantId, aiSystemId: r.aiSystemId, createdAt: { gte: r.createdAt } },
            select: ASSESSMENT_SELECT,
            orderBy: { version: "desc" },
          })
        : [];
    const availableImpact =
      r.status === "IN_PROGRESS"
        ? await prisma.aiImpactAssessment.findMany({
            where: { tenantId: session.tenantId, aiSystemId: r.aiSystemId, createdAt: { gte: r.createdAt } },
            select: ASSESSMENT_SELECT,
            orderBy: { version: "desc" },
          })
        : [];
    return reply.send({
      ...r,
      initiatedBy: users.get(r.initiatedByUserId) ?? null,
      completedBy: r.completedByUserId ? (users.get(r.completedByUserId) ?? null) : null,
      pastTarget: r.status === "IN_PROGRESS" && r.targetDate !== null && r.targetDate.getTime() < Date.now(),
      classificationChanges: classificationChanges(r.snapshotAtStart, end),
      relatedRiskAcceptance: r.relatedRiskAcceptance
        ? { ...r.relatedRiskAcceptance, state: deriveAcceptanceState(r.relatedRiskAcceptance.status, r.relatedRiskAcceptance.expiresAt) }
        : null,
      context: {
        openFindings,
        acceptances: acceptances.map((a) => ({ ...a, state: deriveAcceptanceState(a.status, a.expiresAt) })),
        availableRiskAssessments: availableRisk,
        availableImpactAssessments: availableImpact,
      },
    });
  });

  // 4. Update while IN_PROGRESS (what changed, material change, target date, links).
  app.patch("/ai-reassessments/:id", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to update reassessments" });
    }
    const { id } = request.params as { id: string };
    const r = await prisma.aiReassessment.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!r) {
      return reply.status(404).send({ error: "Reassessment not found" });
    }
    if (r.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: LOCKED });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: {
      whatChanged?: string;
      materialChange?: boolean;
      materialChangeDescription?: string | null;
      targetDate?: Date | null;
      newRiskAssessmentId?: string | null;
      newImpactAssessmentId?: string | null;
      relatedRiskAcceptanceId?: string | null;
    } = {};
    if ("whatChanged" in body) {
      const v = cleanText(body.whatChanged, 4000);
      if (!v) {
        return reply.status(400).send({ error: "whatChanged cannot be empty (max 4000 characters)" });
      }
      data.whatChanged = v;
    }
    if ("materialChange" in body) {
      if (typeof body.materialChange !== "boolean") {
        return reply.status(400).send({ error: "materialChange must be true or false" });
      }
      data.materialChange = body.materialChange;
    }
    if ("materialChangeDescription" in body) {
      if (body.materialChangeDescription === null || body.materialChangeDescription === "") {
        data.materialChangeDescription = null;
      } else {
        const v = cleanText(body.materialChangeDescription, 4000);
        if (!v) {
          return reply.status(400).send({ error: "materialChangeDescription must be text of at most 4000 characters" });
        }
        data.materialChangeDescription = v;
      }
    }
    const effectiveMaterial = data.materialChange ?? r.materialChange;
    const effectiveDescription = data.materialChangeDescription !== undefined ? data.materialChangeDescription : r.materialChangeDescription;
    if (effectiveMaterial && !effectiveDescription) {
      return reply.status(400).send({ error: "A material change needs a description of why it matters" });
    }
    if ("targetDate" in body) {
      const v = parseOptionalDate(body.targetDate);
      if (v === "invalid") {
        return reply.status(400).send({ error: "targetDate must be a valid date" });
      }
      data.targetDate = v;
    }
    if ("newRiskAssessmentId" in body) {
      const link = await linkRisk(body.newRiskAssessmentId, session.tenantId, r.aiSystemId, r.createdAt);
      if (!link.ok) {
        return reply.status(link.status).send({ error: link.error });
      }
      data.newRiskAssessmentId = link.id;
    }
    if ("newImpactAssessmentId" in body) {
      const link = await linkImpact(body.newImpactAssessmentId, session.tenantId, r.aiSystemId, r.createdAt);
      if (!link.ok) {
        return reply.status(link.status).send({ error: link.error });
      }
      data.newImpactAssessmentId = link.id;
    }
    if ("relatedRiskAcceptanceId" in body) {
      if (body.relatedRiskAcceptanceId && r.reason !== "RISK_ACCEPTANCE_REVIEW") {
        return reply.status(400).send({ error: "A Risk Acceptance can only be linked when the reason is RISK_ACCEPTANCE_REVIEW" });
      }
      const link = await linkAcceptance(body.relatedRiskAcceptanceId, session.tenantId, r.aiSystemId);
      if (!link.ok) {
        return reply.status(link.status).send({ error: link.error });
      }
      data.relatedRiskAcceptanceId = link.id;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const updated = await prisma.aiReassessment.updateMany({ where: { id: r.id, tenantId: session.tenantId, status: "IN_PROGRESS" }, data });
    if (updated.count === 0) {
      return reply.status(409).send({ error: LOCKED });
    }
    await audit(session, "ai_reassessment.updated", "AiReassessment", r.id, { fields: Object.keys(data).join(",") });
    return reply.send(await prisma.aiReassessment.findFirst({ where: { id: r.id, tenantId: session.tenantId } }));
  });

  // 5. Complete: explicit human conclusion + rationale. Snapshot at completion. Locked afterwards.
  app.post("/ai-reassessments/:id/complete", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to complete reassessments" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { conclusion?: unknown; rationale?: unknown };
    if (!isConclusion(body.conclusion)) {
      return reply.status(400).send({ error: "conclusion must be one of: " + REASSESSMENT_CONCLUSIONS.join(", ") });
    }
    const conclusion = body.conclusion;
    const rationale = cleanText(body.rationale, 4000);
    if (!rationale) {
      return reply.status(400).send({ error: "A completion rationale (max 4000 characters) is required" });
    }
    const r = await prisma.aiReassessment.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!r) {
      return reply.status(404).send({ error: "Reassessment not found" });
    }
    if (r.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: LOCKED });
    }
    if (conclusion === "GOVERNANCE_UPDATED") {
      const [newRisk, newImpact] = await Promise.all([
        r.newRiskAssessmentId ? prisma.aiRiskAssessment.findFirst({ where: { id: r.newRiskAssessmentId, tenantId: session.tenantId }, select: { status: true } }) : null,
        r.newImpactAssessmentId ? prisma.aiImpactAssessment.findFirst({ where: { id: r.newImpactAssessmentId, tenantId: session.tenantId }, select: { status: true } }) : null,
      ]);
      if (newRisk?.status !== "COMPLETED" && newImpact?.status !== "COMPLETED") {
        return reply.status(400).send({
          error: "GOVERNANCE_UPDATED requires at least one linked NEW risk or impact assessment that has been COMPLETED through its independent review",
        });
      }
    }
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id: r.aiSystemId, tenantId: session.tenantId } });
    const snapshotAtCompletion = snapshotOf(aiSystem ?? {});
    const updated = await prisma.aiReassessment.updateMany({
      where: { id: r.id, tenantId: session.tenantId, status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        openCycleKey: null,
        conclusion,
        conclusionRationale: rationale,
        completedByUserId: userId,
        completedAt: new Date(),
        snapshotAtCompletion: snapshotAtCompletion as never,
      },
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This reassessment was already completed" });
    }
    await audit(session, "ai_reassessment.completed", "AiReassessment", r.id, {
      aiSystemId: r.aiSystemId,
      conclusion,
      classificationFieldsChanged: classificationChanges(r.snapshotAtStart, snapshotAtCompletion).length,
    });
    return reply.send(await prisma.aiReassessment.findFirst({ where: { id: r.id, tenantId: session.tenantId } }));
  });
}