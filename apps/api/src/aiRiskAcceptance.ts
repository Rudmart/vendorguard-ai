/**
 * Step 13 - Risk Acceptance & Residual Risk Governance (AI risks).
 *
 * What is accepted: the RESIDUAL risk of an AiRisk. A GovernanceFinding may be linked as context only -
 * its status NEVER changes (CLOSED still means verified remediation).
 * Lifecycle: PENDING_REVIEW -> APPROVED | REJECTED. Decided records are immutable.
 * ACTIVE / EXPIRED are derived from APPROVED + expiresAt (no scheduler). Requestor != approver.
 * AiRisk.treatment = ACCEPT is only the PLANNED treatment; only an APPROVED RiskAcceptance is authoritative.
 * No side effects: no Finding change, no remediation, no rescoring, no treatment change.
 * The legacy vendor RiskAcceptance route (single-step) is unchanged.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, parseOptionalDate, audit, type Session } from "./aiControlEvidence.js";

const USER_SELECT = { id: true, displayName: true, email: true } as const;
type UserRef = { id: string; displayName: string; email: string };
export type AcceptanceState = "PENDING_REVIEW" | "ACTIVE" | "EXPIRED" | "REJECTED";

export function deriveAcceptanceState(status: string, expiresAt: Date | null, now: number = Date.now()): AcceptanceState {
  if (status === "PENDING_REVIEW") {
    return "PENDING_REVIEW";
  }
  if (status === "REJECTED") {
    return "REJECTED";
  }
  return expiresAt !== null && expiresAt.getTime() >= now ? "ACTIVE" : "EXPIRED";
}

const ACCEPTANCE_INCLUDE = {
  governanceFinding: { select: { id: true, title: true, status: true } },
  aiRisk: {
    select: {
      id: true,
      title: true,
      treatmentOwner: { select: USER_SELECT },
      assessment: { select: { id: true, aiSystem: { select: { id: true, name: true } } } },
    },
  },
} as const;

async function usersById(ids: Array<string | null>): Promise<Map<string, UserRef>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => typeof v === "string")));
  if (unique.length === 0) {
    return new Map();
  }
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: USER_SELECT });
  return new Map(users.map((u) => [u.id, u]));
}

async function decorateAll<T extends { status: string; expiresAt: Date | null; requestedByUserId: string | null; decidedByUserId: string | null }>(rows: T[]) {
  const users = await usersById(rows.flatMap((r) => [r.requestedByUserId, r.decidedByUserId]));
  return rows.map((r) => ({
    ...r,
    state: deriveAcceptanceState(r.status, r.expiresAt),
    requestedBy: r.requestedByUserId ? (users.get(r.requestedByUserId) ?? null) : null,
    decidedBy: r.decidedByUserId ? (users.get(r.decidedByUserId) ?? null) : null,
  }));
}

async function loadAcceptance(id: string, tenantId: string) {
  const row = await prisma.riskAcceptance.findFirst({ where: { id, tenantId, aiRiskId: { not: null } }, include: ACCEPTANCE_INCLUDE });
  if (!row) {
    return null;
  }
  const [decorated] = await decorateAll([row]);
  return decorated ?? null;
}

async function loadRisk(id: string, tenantId: string) {
  return prisma.aiRisk.findFirst({
    where: { id, tenantId },
    include: {
      assessment: { select: { id: true, aiSystemId: true, aiSystem: { select: { id: true, name: true } } } },
      treatmentOwner: { select: USER_SELECT },
    },
  });
}

async function blockingAcceptance(tenantId: string, aiRiskId: string, excludeId?: string) {
  const rows = await prisma.riskAcceptance.findMany({
    where: { tenantId, aiRiskId, status: { in: ["PENDING_REVIEW", "APPROVED"] } },
    select: { id: true, status: true, expiresAt: true },
  });
  const others = rows.filter((r) => r.id !== excludeId);
  return {
    pending: others.some((r) => r.status === "PENDING_REVIEW"),
    active: others.some((r) => deriveAcceptanceState(r.status, r.expiresAt) === "ACTIVE"),
  };
}

function futureDate(value: unknown): Date | null {
  const date = parseOptionalDate(value);
  if (!(date instanceof Date) || date.getTime() <= Date.now()) {
    return null;
  }
  return date;
}

async function denyDecision(session: Session, id: string, reason: string): Promise<void> {
  await audit(session, "risk_acceptance.denied", "RiskAcceptance", id, { reason }, "DENIED");
}

export async function registerRiskAcceptanceRoutes(app: FastifyInstance): Promise<void> {
  // 1. Risk context + acceptance history for one AI risk.
  app.get("/ai-risks/:id/risk-acceptance", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view Risk Acceptance" });
    }
    const { id } = request.params as { id: string };
    const risk = await loadRisk(id, session.tenantId);
    if (!risk) {
      return reply.status(404).send({ error: "Risk not found" });
    }
    const rows = await prisma.riskAcceptance.findMany({
      where: { tenantId: session.tenantId, aiRiskId: risk.id },
      orderBy: { createdAt: "desc" },
      include: ACCEPTANCE_INCLUDE,
    });
    const openFindings = await prisma.governanceFinding.findMany({
      where: { tenantId: session.tenantId, status: "OPEN", aiControlTest: { aiSystemControl: { aiSystemId: risk.assessment.aiSystemId } } },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });
    return reply.send({
      risk: {
        id: risk.id,
        title: risk.title,
        statement: risk.statement,
        category: risk.category,
        residualLikelihood: risk.residualLikelihood,
        residualImpact: risk.residualImpact,
        residualScore: risk.residualScore,
        residualRating: risk.residualRating,
        treatment: risk.treatment,
        treatmentRationale: risk.treatmentRationale,
        treatmentOwner: risk.treatmentOwner,
        assessmentId: risk.assessment.id,
        aiSystem: risk.assessment.aiSystem,
      },
      acceptances: await decorateAll(rows),
      openFindings,
    });
  });

  // 2. Request Risk Acceptance (PENDING_REVIEW). Snapshots the residual risk being reviewed.
  app.post("/ai-risks/:id/risk-acceptance", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to request Risk Acceptance" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const risk = await loadRisk(id, session.tenantId);
    if (!risk) {
      return reply.status(404).send({ error: "Risk not found" });
    }
    if (!risk.treatmentOwnerUserId) {
      return reply.status(400).send({ error: "Assign a treatment owner to this risk before requesting Risk Acceptance" });
    }
    const residualScore = risk.residualScore;
    const residualRating = risk.residualRating;
    if (residualScore === null || residualRating === null) {
      return reply.status(400).send({ error: "Assess the residual risk before requesting Risk Acceptance" });
    }
    const body = (request.body ?? {}) as { justification?: unknown; residualRiskStatement?: unknown; conditions?: unknown; expiresAt?: unknown; governanceFindingId?: unknown };
    const justification = cleanText(body.justification, 4000);
    const residualRiskStatement = cleanText(body.residualRiskStatement, 4000);
    if (!justification || !residualRiskStatement) {
      return reply.status(400).send({ error: "A business justification and a residual-risk statement are required (max 4000 characters each)" });
    }
    let conditions: string | null = null;
    if (body.conditions !== undefined && body.conditions !== null && body.conditions !== "") {
      conditions = cleanText(body.conditions, 2000);
      if (!conditions) {
        return reply.status(400).send({ error: "conditions must be text of at most 2000 characters" });
      }
    }
    const expiresAt = futureDate(body.expiresAt);
    if (!expiresAt) {
      return reply.status(400).send({ error: "A future review/expiration date (expiresAt) is required - Risk Acceptance is time-bound" });
    }
    let governanceFindingId: string | null = null;
    if (body.governanceFindingId !== undefined && body.governanceFindingId !== null && body.governanceFindingId !== "") {
      if (typeof body.governanceFindingId !== "string") {
        return reply.status(400).send({ error: "governanceFindingId must be text" });
      }
      const finding = await prisma.governanceFinding.findFirst({
        where: { id: body.governanceFindingId, tenantId: session.tenantId },
        include: { aiControlTest: { select: { aiSystemControl: { select: { aiSystemId: true } } } } },
      });
      if (!finding) {
        return reply.status(404).send({ error: "Finding not found" });
      }
      if (finding.status !== "OPEN") {
        return reply.status(400).send({ error: "Only an OPEN Finding can be linked as context" });
      }
      if (finding.aiControlTest?.aiSystemControl.aiSystemId !== risk.assessment.aiSystemId) {
        return reply.status(400).send({ error: "The Finding must belong to the same AI system as the risk" });
      }
      governanceFindingId = finding.id;
    }
    const blocking = await blockingAcceptance(session.tenantId, risk.id);
    if (blocking.pending) {
      return reply.status(409).send({ error: "This risk already has a Risk Acceptance request pending review" });
    }
    if (blocking.active) {
      return reply.status(409).send({ error: "This risk already has an ACTIVE Risk Acceptance. A new request can be made after it expires." });
    }
    const created = await prisma.riskAcceptance.create({
      data: {
        tenantId: session.tenantId,
        aiRiskId: risk.id,
        governanceFindingId,
        status: "PENDING_REVIEW",
        requestedByUserId: userId,
        justification,
        residualRiskStatement,
        residualScoreAtRequest: residualScore,
        residualRatingAtRequest: residualRating,
        conditions,
        expiresAt,
      },
    });
    await audit(session, "risk_acceptance.requested", "RiskAcceptance", created.id, {
      aiRiskId: risk.id,
      residualScoreAtRequest: residualScore,
      expiresAt: expiresAt.toISOString(),
      governanceFindingId,
    });
    return reply.status(201).send(await loadAcceptance(created.id, session.tenantId));
  });

  // 3. Edit a pending request (requestor only). Decided records are immutable.
  app.patch("/risk-acceptances/:id", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to edit Risk Acceptance requests" });
    }
    const { id } = request.params as { id: string };
    const row = await prisma.riskAcceptance.findFirst({ where: { id, tenantId: session.tenantId, aiRiskId: { not: null } } });
    if (!row) {
      return reply.status(404).send({ error: "Risk Acceptance not found" });
    }
    if (row.status !== "PENDING_REVIEW") {
      return reply.status(409).send({ error: "Decided Risk Acceptance records are immutable. Create a new request instead." });
    }
    if (!session.userId || row.requestedByUserId !== session.userId) {
      return reply.status(403).send({ error: "Only the requestor can edit a pending request" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: { justification?: string; residualRiskStatement?: string; conditions?: string | null; expiresAt?: Date } = {};
    if ("justification" in body) {
      const v = cleanText(body.justification, 4000);
      if (!v) {
        return reply.status(400).send({ error: "justification is required (max 4000 characters)" });
      }
      data.justification = v;
    }
    if ("residualRiskStatement" in body) {
      const v = cleanText(body.residualRiskStatement, 4000);
      if (!v) {
        return reply.status(400).send({ error: "residualRiskStatement is required (max 4000 characters)" });
      }
      data.residualRiskStatement = v;
    }
    if ("conditions" in body) {
      if (body.conditions === null || body.conditions === "") {
        data.conditions = null;
      } else {
        const v = cleanText(body.conditions, 2000);
        if (!v) {
          return reply.status(400).send({ error: "conditions must be text of at most 2000 characters" });
        }
        data.conditions = v;
      }
    }
    if ("expiresAt" in body) {
      const v = futureDate(body.expiresAt);
      if (!v) {
        return reply.status(400).send({ error: "expiresAt must be a future date" });
      }
      data.expiresAt = v;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const updated = await prisma.riskAcceptance.updateMany({ where: { id: row.id, tenantId: session.tenantId, status: "PENDING_REVIEW" }, data });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This request was decided by someone else" });
    }
    await audit(session, "risk_acceptance.updated", "RiskAcceptance", row.id, { fields: Object.keys(data).join(",") });
    return reply.send(await loadAcceptance(row.id, session.tenantId));
  });

  // 4. Independent decision: APPROVE or REJECT (risk:accept, requestor != approver, rationale required).
  app.post("/risk-acceptances/:id/decision", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "risk:accept")) {
      return reply.status(403).send({ error: "Only ADMIN or REVIEWER users can decide Risk Acceptance" });
    }
    const deciderUserId = session.userId;
    if (!deciderUserId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { decision?: unknown; rationale?: unknown };
    if (body.decision !== "APPROVE" && body.decision !== "REJECT") {
      return reply.status(400).send({ error: "decision must be APPROVE or REJECT" });
    }
    const approve = body.decision === "APPROVE";
    const rationale = cleanText(body.rationale, 4000);
    if (!rationale) {
      return reply.status(400).send({ error: "A decision rationale (max 4000 characters) is required" });
    }
    const row = await prisma.riskAcceptance.findFirst({ where: { id, tenantId: session.tenantId, aiRiskId: { not: null } } });
    const aiRiskId = row?.aiRiskId;
    if (!row || !aiRiskId) {
      return reply.status(404).send({ error: "Risk Acceptance not found" });
    }
    if (row.requestedByUserId === deciderUserId) {
      await denyDecision(session, row.id, "decider_is_requestor");
      return reply.status(403).send({ error: "Separation of duties: you cannot decide a Risk Acceptance you requested" });
    }
    if (row.status !== "PENDING_REVIEW") {
      return reply.status(409).send({ error: "Only requests pending review can be decided" });
    }
    if (approve) {
      if (!row.expiresAt || row.expiresAt.getTime() <= Date.now()) {
        return reply.status(400).send({ error: "The requested expiration date has passed. Submit a new request." });
      }
      if ((await blockingAcceptance(session.tenantId, aiRiskId, row.id)).active) {
        return reply.status(409).send({ error: "This risk already has an ACTIVE Risk Acceptance" });
      }
    }
    const decidedAt = new Date();
    const data = approve
      ? { status: "APPROVED" as const, decidedByUserId: deciderUserId, approvedByUserId: deciderUserId, decidedAt, decisionRationale: rationale }
      : { status: "REJECTED" as const, decidedByUserId: deciderUserId, decidedAt, decisionRationale: rationale };
    const updated = await prisma.riskAcceptance.updateMany({ where: { id: row.id, tenantId: session.tenantId, status: "PENDING_REVIEW" }, data });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This request was already decided" });
    }
    await audit(session, approve ? "risk_acceptance.approved" : "risk_acceptance.rejected", "RiskAcceptance", row.id, {
      aiRiskId,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    });
    return reply.send(await loadAcceptance(row.id, session.tenantId));
  });

  // 5. Risk Acceptance list across AI risks.
  app.get("/risk-acceptances", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view Risk Acceptance" });
    }
    const rows = await prisma.riskAcceptance.findMany({
      where: { tenantId: session.tenantId, aiRiskId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: ACCEPTANCE_INCLUDE,
    });
    return reply.send({ riskAcceptances: await decorateAll(rows) });
  });
}