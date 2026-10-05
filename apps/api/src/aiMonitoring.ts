/**
 * Step 15 - Production Governance & Monitoring (governance monitoring, NOT telemetry).
 *
 * AiMonitoringCheck  = a monitoring obligation: what must be reviewed, the expectation, owner, cadence.
 * AiMonitoringReview = one human observation + governance judgment. Recorded once, immutable.
 * Due state and governance context are DERIVED on read and never stored. No scheduler, no signal table,
 * no automatic consequences. Escalation to Reassessment is an explicit human action (ai-system:update).
 *
 * RBAC: checks = ai-system:update; reviews = ai-monitoring:review (ADMIN, ANALYST, REVIEWER - not AUDITOR);
 * start reassessment = ai-system:update; view = ai-system:read.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, audit } from "./aiControlEvidence.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";
import { snapshotOf } from "./aiReassessments.js";

export const MONITORING_CATEGORIES = [
  "HUMAN_OVERSIGHT",
  "USE_AND_SCOPE",
  "OUTCOMES_PERFORMANCE",
  "FAIRNESS",
  "COMPLAINTS_FEEDBACK",
  "CONTROL_OPERATION",
  "REGULATORY",
  "OTHER",
] as const;
export const MONITORING_CADENCES = ["MONTHLY", "QUARTERLY", "SEMIANNUALLY", "ANNUALLY"] as const;
export const MONITORING_RESULTS = ["ACCEPTABLE", "ATTENTION_REQUIRED", "REASSESSMENT_REQUIRED"] as const;
type Cadence = (typeof MONITORING_CADENCES)[number];

const CADENCE_MONTHS: Record<Cadence, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUALLY: 6, ANNUALLY: 12 };
/** A check is DUE_SOON within this many days of its next due date. */
export const DUE_SOON_DAYS = 7;
/** An ACTIVE Risk Acceptance is "expiring soon" within this many days (display context only). */
export const ACCEPTANCE_EXPIRING_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;
const ESCALATABLE: readonly string[] = ["ATTENTION_REQUIRED", "REASSESSMENT_REQUIRED"];
const USER_SELECT = { id: true, displayName: true, email: true } as const;

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function nextDueDate(base: Date, cadence: Cadence): Date {
  const next = new Date(base.getTime());
  next.setUTCMonth(next.getUTCMonth() + CADENCE_MONTHS[cadence]);
  return next;
}

export type DueState = "INACTIVE" | "OVERDUE" | "DUE_SOON" | "NOT_DUE";

export function dueState(nextDue: Date, active: boolean, now: number = Date.now()): DueState {
  if (!active) {
    return "INACTIVE";
  }
  const diff = nextDue.getTime() - now;
  if (diff < 0) {
    return "OVERDUE";
  }
  return diff <= DUE_SOON_DAYS * DAY_MS ? "DUE_SOON" : "NOT_DUE";
}

function withDue(c: { createdAt: Date; active: boolean; cadence: Cadence }, last: { reviewedAt: Date; result: string } | null) {
  const nextDueAt = nextDueDate(last ? last.reviewedAt : c.createdAt, c.cadence);
  return { nextDueAt, dueState: dueState(nextDueAt, c.active), lastReview: last };
}

async function userMap(ids: Array<string | null>) {
  const unique = Array.from(new Set(ids.filter((v): v is string => typeof v === "string")));
  if (unique.length === 0) {
    return new Map<string, { id: string; displayName: string; email: string }>();
  }
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: USER_SELECT });
  return new Map(users.map((u) => [u.id, u]));
}

type OwnerResult = { ok: true; id: string } | { ok: false; error: string };

async function resolveOwner(tenantId: string, body: Record<string, unknown>, fallback: string | null): Promise<OwnerResult> {
  let candidate: string | null = fallback;
  if (typeof body.ownerUserId === "string" && body.ownerUserId) {
    candidate = body.ownerUserId;
  } else if (typeof body.ownerEmail === "string" && body.ownerEmail.trim()) {
    const user = await prisma.user.findFirst({ where: { email: { equals: body.ownerEmail.trim(), mode: "insensitive" } }, select: { id: true } });
    if (!user) {
      return { ok: false, error: "No user with that email" };
    }
    candidate = user.id;
  }
  if (!candidate) {
    return { ok: false, error: "A monitoring owner is required" };
  }
  const membership = await prisma.tenantMembership.findFirst({ where: { userId: candidate, tenantId }, select: { userId: true } });
  if (!membership) {
    return { ok: false, error: "The monitoring owner must be a member of this organization" };
  }
  return { ok: true, id: candidate };
}

async function listChecks(tenantId: string, aiSystemId: string) {
  const checks = await prisma.aiMonitoringCheck.findMany({
    where: { tenantId, aiSystemId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: { reviews: { orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true, result: true } } },
  });
  const users = await userMap(checks.map((c) => c.ownerUserId));
  return checks.map(({ reviews, ...c }) => ({ ...c, owner: users.get(c.ownerUserId) ?? null, ...withDue(c, reviews[0] ?? null) }));
}

/** Facts VendorGuard already knows - shown as context, never copied into monitoring records. */
export async function buildGovernanceContext(tenantId: string, aiSystemId: string, now: number = Date.now()) {
  const tests = await prisma.aiControlTest.findMany({
    where: { tenantId, status: "COMPLETED", aiSystemControl: { aiSystemId } },
    orderBy: [{ testDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, aiSystemControlId: true, testDate: true, nextTestDate: true, overallEffectiveness: true, aiSystemControl: { select: { control: { select: { controlId: true, title: true } } } } },
  });
  const latest = new Map<string, (typeof tests)[number]>();
  for (const t of tests) {
    if (!latest.has(t.aiSystemControlId)) {
      latest.set(t.aiSystemControlId, t);
    }
  }
  const retestsOverdue = Array.from(latest.values())
    .filter((t) => t.nextTestDate !== null && t.nextTestDate.getTime() < now)
    .map((t) => ({ testId: t.id, control: t.aiSystemControl.control, nextTestDate: t.nextTestDate, overallEffectiveness: t.overallEffectiveness }));
  const expiredEvidence = await prisma.evidenceDocument.findMany({
    where: { tenantId, aiSystemId, deletedAt: null, expirationDate: { lt: new Date(now) } },
    select: { id: true, displayFilename: true, expirationDate: true },
  });
  const findings = await prisma.governanceFinding.findMany({
    where: { tenantId, status: "OPEN", aiControlTest: { aiSystemControl: { aiSystemId } } },
    select: { id: true, title: true, severity: true, createdAt: true },
  });
  const overdueRemediation = await prisma.remediationAction.findMany({
    where: {
      tenantId,
      status: { not: "CLOSED" },
      dueDate: { lt: new Date(now) },
      OR: [{ governanceFinding: { aiControlTest: { aiSystemControl: { aiSystemId } } } }, { aiRisk: { assessment: { aiSystemId } } }],
    },
    select: { id: true, title: true, status: true, dueDate: true },
  });
  const acceptances = await prisma.riskAcceptance.findMany({
    where: { tenantId, status: "APPROVED", aiRisk: { assessment: { aiSystemId } } },
    select: { id: true, status: true, expiresAt: true, aiRisk: { select: { id: true, title: true } } },
  });
  const reassessments = await prisma.aiReassessment.findMany({
    where: { tenantId, aiSystemId, status: "IN_PROGRESS" },
    select: { id: true, reason: true, targetDate: true, createdAt: true },
  });
  return {
    retestsOverdue,
    expiredEvidence,
    openFindings: findings.map((f) => ({ ...f, ageDays: Math.floor((now - f.createdAt.getTime()) / DAY_MS) })),
    overdueRemediation,
    riskAcceptances: acceptances.map((a) => {
      const state = deriveAcceptanceState(a.status, a.expiresAt, now);
      const expiringSoon = state === "ACTIVE" && a.expiresAt !== null && a.expiresAt.getTime() - now <= ACCEPTANCE_EXPIRING_DAYS * DAY_MS;
      return { ...a, state, expiringSoon };
    }),
    reassessmentsInProgress: reassessments.map((r) => ({ ...r, pastTarget: r.targetDate !== null && r.targetDate.getTime() < now })),
  };
}

export async function registerMonitoringRoutes(app: FastifyInstance): Promise<void> {
  // 1. Monitoring overview for an AI system: checks with derived due state + governance context.
  app.get("/ai-systems/:id/monitoring", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view monitoring" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true, name: true, lifecycleStatus: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    return reply.send({
      aiSystem,
      dueSoonDays: DUE_SOON_DAYS,
      acceptanceExpiringDays: ACCEPTANCE_EXPIRING_DAYS,
      checks: await listChecks(session.tenantId, aiSystem.id),
      context: await buildGovernanceContext(session.tenantId, aiSystem.id),
    });
  });

  // 2. List checks.
  app.get("/ai-systems/:id/monitoring-checks", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view monitoring" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    return reply.send({ checks: await listChecks(session.tenantId, aiSystem.id) });
  });

  // 3. Create a monitoring check (obligation).
  app.post("/ai-systems/:id/monitoring-checks", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to configure monitoring checks" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const title = cleanText(body.title, 200);
    const whatToReview = cleanText(body.whatToReview, 4000);
    const expectation = cleanText(body.expectation, 4000);
    if (!title || !whatToReview || !expectation) {
      return reply.status(400).send({ error: "title (max 200), whatToReview and expectation (max 4000 each) are required" });
    }
    if (!isOneOf(MONITORING_CATEGORIES, body.category)) {
      return reply.status(400).send({ error: "category must be one of: " + MONITORING_CATEGORIES.join(", ") });
    }
    if (!isOneOf(MONITORING_CADENCES, body.cadence)) {
      return reply.status(400).send({ error: "cadence must be one of: " + MONITORING_CADENCES.join(", ") });
    }
    const owner = await resolveOwner(session.tenantId, body, userId);
    if (!owner.ok) {
      return reply.status(400).send({ error: owner.error });
    }
    const created = await prisma.aiMonitoringCheck.create({
      data: {
        tenantId: session.tenantId,
        aiSystemId: aiSystem.id,
        title,
        whatToReview,
        expectation,
        category: body.category,
        cadence: body.cadence,
        ownerUserId: owner.id,
        createdByUserId: userId,
      },
    });
    await audit(session, "ai_monitoring_check.created", "AiMonitoringCheck", created.id, {
      aiSystemId: aiSystem.id,
      category: body.category,
      cadence: body.cadence,
      ownerUserId: owner.id,
    });
    return reply.status(201).send({ ...created, ...withDue(created, null) });
  });

  // 4. Update / deactivate a check (no delete - review history is preserved).
  app.patch("/ai-monitoring-checks/:id", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to configure monitoring checks" });
    }
    const { id } = request.params as { id: string };
    const existing = await prisma.aiMonitoringCheck.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!existing) {
      return reply.status(404).send({ error: "Monitoring check not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: {
      title?: string;
      whatToReview?: string;
      expectation?: string;
      category?: (typeof MONITORING_CATEGORIES)[number];
      cadence?: Cadence;
      ownerUserId?: string;
      active?: boolean;
      deactivatedAt?: Date | null;
    } = {};
    for (const [field, max] of [["title", 200], ["whatToReview", 4000], ["expectation", 4000]] as const) {
      if (field in body) {
        const v = cleanText(body[field], max);
        if (!v) {
          return reply.status(400).send({ error: `${field} cannot be empty (max ${max} characters)` });
        }
        data[field] = v;
      }
    }
    if ("category" in body) {
      if (!isOneOf(MONITORING_CATEGORIES, body.category)) {
        return reply.status(400).send({ error: "Invalid category" });
      }
      data.category = body.category;
    }
    if ("cadence" in body) {
      if (!isOneOf(MONITORING_CADENCES, body.cadence)) {
        return reply.status(400).send({ error: "Invalid cadence" });
      }
      data.cadence = body.cadence;
    }
    if ("ownerUserId" in body || "ownerEmail" in body) {
      const owner = await resolveOwner(session.tenantId, body, null);
      if (!owner.ok) {
        return reply.status(400).send({ error: owner.error });
      }
      data.ownerUserId = owner.id;
    }
    if ("active" in body) {
      if (typeof body.active !== "boolean") {
        return reply.status(400).send({ error: "active must be true or false" });
      }
      data.active = body.active;
      data.deactivatedAt = body.active ? null : (existing.deactivatedAt ?? new Date());
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const updated = await prisma.aiMonitoringCheck.update({ where: { id: existing.id }, data });
    const fields = Object.keys(data).filter((k) => k !== "active" && k !== "deactivatedAt");
    if (data.active === false && existing.active) {
      await audit(session, "ai_monitoring_check.deactivated", "AiMonitoringCheck", existing.id, { aiSystemId: existing.aiSystemId });
    }
    if (fields.length > 0 || (data.active === true && !existing.active)) {
      await audit(session, "ai_monitoring_check.updated", "AiMonitoringCheck", existing.id, { fields: fields.concat(data.active === true && !existing.active ? ["active"] : []).join(",") });
    }
    return reply.send(updated);
  });

  // 5. Check detail + full review history.
  app.get("/ai-monitoring-checks/:id/reviews", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view monitoring" });
    }
    const { id } = request.params as { id: string };
    const check = await prisma.aiMonitoringCheck.findFirst({
      where: { id, tenantId: session.tenantId },
      include: { aiSystem: { select: { id: true, name: true, lifecycleStatus: true } }, reviews: { orderBy: { reviewedAt: "desc" } } },
    });
    if (!check) {
      return reply.status(404).send({ error: "Monitoring check not found" });
    }
    const users = await userMap([check.ownerUserId, ...check.reviews.map((r) => r.reviewerUserId)]);
    const { reviews, ...rest } = check;
    return reply.send({
      check: { ...rest, owner: users.get(check.ownerUserId) ?? null, ...withDue(rest, reviews[0] ?? null) },
      reviews: reviews.map((r) => ({ ...r, reviewer: users.get(r.reviewerUserId) ?? null })),
    });
  });

  // 6. Record a monitoring review (observation + judgment). Immutable once recorded.
  app.post("/ai-monitoring-checks/:id/reviews", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-monitoring:review")) {
      return reply.status(403).send({ error: "Not authorized to record monitoring reviews" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const check = await prisma.aiMonitoringCheck.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!check) {
      return reply.status(404).send({ error: "Monitoring check not found" });
    }
    if (!check.active) {
      return reply.status(409).send({ error: "This monitoring check is inactive" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const observation = cleanText(body.observation, 4000);
    const rationale = cleanText(body.rationale, 4000);
    if (!observation || !rationale) {
      return reply.status(400).send({ error: "An observation and a rationale are required (max 4000 characters each)" });
    }
    if (!isOneOf(MONITORING_RESULTS, body.result)) {
      return reply.status(400).send({ error: "result must be one of: " + MONITORING_RESULTS.join(", ") });
    }
    let observedValue: number | null = null;
    if (body.observedValue !== undefined && body.observedValue !== null && body.observedValue !== "") {
      if (typeof body.observedValue !== "number" || !Number.isFinite(body.observedValue)) {
        return reply.status(400).send({ error: "observedValue must be a number" });
      }
      observedValue = body.observedValue;
    }
    let unit: string | null = null;
    if (body.unit !== undefined && body.unit !== null && body.unit !== "") {
      unit = cleanText(body.unit, 50);
      if (!unit) {
        return reply.status(400).send({ error: "unit must be text of at most 50 characters" });
      }
    }
    let periodCovered: string | null = null;
    if (body.periodCovered !== undefined && body.periodCovered !== null && body.periodCovered !== "") {
      periodCovered = cleanText(body.periodCovered, 200);
      if (!periodCovered) {
        return reply.status(400).send({ error: "periodCovered must be text of at most 200 characters" });
      }
    }
    const created = await prisma.aiMonitoringReview.create({
      data: { tenantId: session.tenantId, checkId: check.id, observation, observedValue, unit, periodCovered, result: body.result, rationale, reviewerUserId: userId },
    });
    await audit(session, "ai_monitoring_review.recorded", "AiMonitoringReview", created.id, {
      checkId: check.id,
      aiSystemId: check.aiSystemId,
      result: body.result,
      quantitative: observedValue !== null,
    });
    return reply.status(201).send(created);
  });

  // 7. Explicit human escalation: start a Step 14 reassessment from a review (never automatic).
  app.post("/ai-monitoring-reviews/:id/start-reassessment", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:update")) {
      return reply.status(403).send({ error: "Not authorized to start a reassessment" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const review = await prisma.aiMonitoringReview.findFirst({ where: { id, tenantId: session.tenantId }, include: { check: true } });
    if (!review) {
      return reply.status(404).send({ error: "Monitoring review not found" });
    }
    if (!ESCALATABLE.includes(review.result)) {
      return reply.status(400).send({ error: "Only ATTENTION_REQUIRED or REASSESSMENT_REQUIRED reviews can start a reassessment" });
    }
    if (review.reassessmentId) {
      return reply.status(409).send({ error: "A reassessment was already started from this review" });
    }
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id: review.check.aiSystemId, tenantId: session.tenantId } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
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
    const valueText = review.observedValue !== null ? ` (observed ${review.observedValue}${review.unit ? " " + review.unit : ""})` : "";
    const whatChanged = `Monitoring review of "${review.check.title}": ${review.observation}${valueText}`.slice(0, 4000);
    try {
      const created = await prisma.$transaction(async (tx) => {
        const r = await tx.aiReassessment.create({
          data: {
            tenantId: session.tenantId,
            aiSystemId: aiSystem.id,
            reason: "MONITORING_REVIEW",
            status: "IN_PROGRESS",
            openCycleKey: aiSystem.id,
            whatChanged,
            materialChange: false,
            priorRiskAssessmentId: priorRisk?.id ?? null,
            priorImpactAssessmentId: priorImpact?.id ?? null,
            snapshotAtStart: snapshotOf(aiSystem) as never,
            initiatedByUserId: userId,
          },
        });
        const linked = await tx.aiMonitoringReview.updateMany({ where: { id: review.id, tenantId: session.tenantId, reassessmentId: null }, data: { reassessmentId: r.id } });
        if (linked.count === 0) {
          throw new Error("ALREADY_LINKED");
        }
        return r;
      });
      await audit(session, "ai_reassessment.initiated", "AiReassessment", created.id, { aiSystemId: aiSystem.id, reason: "MONITORING_REVIEW", monitoringReviewId: review.id });
      await audit(session, "ai_monitoring_review.reassessment_started", "AiMonitoringReview", review.id, { reassessmentId: created.id });
      return reply.status(201).send(created);
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "This AI system already has a reassessment in progress" });
      }
      if ((err as Error).message === "ALREADY_LINKED") {
        return reply.status(409).send({ error: "A reassessment was already started from this review" });
      }
      throw err;
    }
  });
}