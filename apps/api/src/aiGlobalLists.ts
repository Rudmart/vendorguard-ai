/**
 * Alignment Phase B - global, READ-ONLY discovery lists over existing authoritative records.
 * No writes, no new sources of truth. Every route: verified signed session + ai-system:read +
 * server-side tenant scoping (session.tenantId). Detail workflows stay where they are.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, type Session } from "./aiControlEvidence.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";
import { nextDueDate, dueState, type DueState } from "./aiMonitoring.js";

const USER_SELECT = { id: true, displayName: true, email: true } as const;
const DAY_MS = 24 * 3600 * 1000;
type UserRef = { id: string; displayName: string; email: string };

export type RiskPosture = "LATEST_ASSESSED" | "DRAFT_NO_COMPLETED_ASSESSMENT" | "OTHER_VERSION";

async function readSession(request: FastifyRequest, reply: FastifyReply): Promise<Session | null> {
  const session = await sessionOf(request);
  if (!session) {
    void reply.status(401).send({ error: "Not logged in" });
    return null;
  }
  if (!hasPermission(session, "ai-system:read")) {
    void reply.status(403).send({ error: "Not authorized to view AI governance records" });
    return null;
  }
  return session;
}

async function userMap(ids: Array<string | null>): Promise<Map<string, UserRef>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => typeof v === "string")));
  if (unique.length === 0) {
    return new Map();
  }
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: USER_SELECT });
  return new Map(users.map((u) => [u.id, u]));
}

const POSTURE_ORDER: Record<RiskPosture, number> = { LATEST_ASSESSED: 0, DRAFT_NO_COMPLETED_ASSESSMENT: 1, OTHER_VERSION: 2 };
const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const DUE_ORDER: Record<DueState, number> = { OVERDUE: 0, DUE_SOON: 1, NOT_DUE: 2, INACTIVE: 3 };

export async function registerGlobalListRoutes(app: FastifyInstance): Promise<void> {
  // Risk Register: default = latest COMPLETED assessment per AI system ("latest assessed posture");
  // no completed version -> latest version as an explicitly labeled draft. scope=all -> every version.
  app.get("/ai-risks", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const scope = (request.query as { scope?: string }).scope === "all" ? "all" : "latest";
    const assessments = await prisma.aiRiskAssessment.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { version: "desc" },
      include: {
        aiSystem: { select: { id: true, name: true } },
        risks: {
          include: {
            treatmentOwner: { select: USER_SELECT },
            riskAcceptances: { where: { status: "APPROVED" }, select: { status: true, expiresAt: true } },
          },
        },
      },
    });
    const bySystem = new Map<string, typeof assessments>();
    for (const a of assessments) {
      const list = bySystem.get(a.aiSystemId) ?? [];
      list.push(a);
      bySystem.set(a.aiSystemId, list);
    }
    const rows = [];
    for (const list of bySystem.values()) {
      const latestCompleted = list.find((a) => a.status === "COMPLETED") ?? null;
      const draft = latestCompleted ? null : (list[0] ?? null);
      for (const a of list) {
        const posture: RiskPosture = a === latestCompleted ? "LATEST_ASSESSED" : a === draft ? "DRAFT_NO_COMPLETED_ASSESSMENT" : "OTHER_VERSION";
        if (scope === "latest" && posture === "OTHER_VERSION") {
          continue;
        }
        for (const r of a.risks) {
          const states = r.riskAcceptances.map((x) => deriveAcceptanceState(x.status, x.expiresAt));
          rows.push({
            id: r.id,
            title: r.title,
            category: r.category,
            inherentScore: r.inherentScore,
            inherentRating: r.inherentRating,
            residualScore: r.residualScore,
            residualRating: r.residualRating,
            treatment: r.treatment,
            treatmentOwner: r.treatmentOwner,
            acceptanceState: states.includes("ACTIVE") ? "ACTIVE" : states.includes("EXPIRED") ? "EXPIRED" : "NONE",
            aiSystem: a.aiSystem,
            assessment: { id: a.id, version: a.version, status: a.status, posture },
          });
        }
      }
    }
    rows.sort(
      (x, y) =>
        POSTURE_ORDER[x.assessment.posture] - POSTURE_ORDER[y.assessment.posture] ||
        x.aiSystem.name.localeCompare(y.aiSystem.name) ||
        y.assessment.version - x.assessment.version ||
        (y.residualScore ?? -1) - (x.residualScore ?? -1),
    );
    return reply.send({ scope, risks: rows });
  });

  // Risk Assessment versions (latest completed per AI system marked).
  app.get("/ai-risk-assessments", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const list = await prisma.aiRiskAssessment.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { version: "desc" },
      select: { id: true, name: true, version: true, status: true, reviewDecision: true, createdAt: true, completedAt: true, aiSystemId: true, aiSystem: { select: { id: true, name: true } }, assessor: { select: USER_SELECT } },
    });
    const latest = new Map<string, string>();
    for (const a of list) {
      if (a.status === "COMPLETED" && !latest.has(a.aiSystemId)) {
        latest.set(a.aiSystemId, a.id);
      }
    }
    const rows = list.map((a) => ({ ...a, isLatestCompleted: latest.get(a.aiSystemId) === a.id }));
    rows.sort((x, y) => x.aiSystem.name.localeCompare(y.aiSystem.name) || y.version - x.version);
    return reply.send({ assessments: rows });
  });

  // Impact Assessment versions (same conventions).
  app.get("/ai-impact-assessments", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const list = await prisma.aiImpactAssessment.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { version: "desc" },
      select: { id: true, name: true, version: true, status: true, reviewDecision: true, createdAt: true, completedAt: true, aiSystemId: true, aiSystem: { select: { id: true, name: true } }, assessor: { select: USER_SELECT } },
    });
    const latest = new Map<string, string>();
    for (const a of list) {
      if (a.status === "COMPLETED" && !latest.has(a.aiSystemId)) {
        latest.set(a.aiSystemId, a.id);
      }
    }
    const rows = list.map((a) => ({ ...a, isLatestCompleted: latest.get(a.aiSystemId) === a.id }));
    rows.sort((x, y) => x.aiSystem.name.localeCompare(y.aiSystem.name) || y.version - x.version);
    return reply.send({ assessments: rows });
  });

  // AI governance Findings only (vendor ControlFinding stays in the vendor workflow).
  app.get("/governance-findings", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const all = (request.query as { status?: string }).status === "all";
    const findings = await prisma.governanceFinding.findMany({
      where: { tenantId: session.tenantId, ...(all ? {} : { status: { in: ["OPEN", "PENDING_REVIEW"] } }) },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        ownerUserId: true,
        createdAt: true,
        aiControlTest: {
          select: {
            id: true,
            aiSystemControl: { select: { id: true, aiSystem: { select: { id: true, name: true } }, control: { select: { controlId: true, title: true } } } },
          },
        },
      },
    });
    const remediations = await prisma.remediationAction.findMany({
      where: { tenantId: session.tenantId, governanceFindingId: { in: findings.map((f) => f.id) } },
      select: { id: true, status: true, governanceFindingId: true },
    });
    const remByFinding = new Map(remediations.map((r) => [r.governanceFindingId ?? "", { id: r.id, status: r.status }]));
    const users = await userMap(findings.map((f) => f.ownerUserId));
    const now = Date.now();
    const rows = findings.map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      status: f.status,
      owner: f.ownerUserId ? (users.get(f.ownerUserId) ?? null) : null,
      ageDays: Math.floor((now - f.createdAt.getTime()) / DAY_MS),
      aiSystem: f.aiControlTest?.aiSystemControl.aiSystem ?? null,
      control: f.aiControlTest?.aiSystemControl.control ?? null,
      controlRecordId: f.aiControlTest?.aiSystemControl.id ?? null,
      testId: f.aiControlTest?.id ?? null,
      remediation: remByFinding.get(f.id) ?? null,
    }));
    rows.sort((x, y) => (SEVERITY_ORDER[x.severity] ?? 9) - (SEVERITY_ORDER[y.severity] ?? 9) || y.ageDays - x.ageDays);
    return reply.send({ status: all ? "all" : "active", findings: rows });
  });

  // Governance monitoring obligations across AI systems (Step 15 due helpers reused).
  app.get("/ai-monitoring-checks", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const includeInactive = (request.query as { active?: string }).active === "all";
    const checks = await prisma.aiMonitoringCheck.findMany({
      where: { tenantId: session.tenantId, ...(includeInactive ? {} : { active: true }) },
      include: { aiSystem: { select: { id: true, name: true } }, reviews: { orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true, result: true } } },
    });
    const users = await userMap(checks.map((c) => c.ownerUserId));
    const rows = checks.map((c) => {
      const last = c.reviews[0] ?? null;
      const nextDueAt = nextDueDate(last ? last.reviewedAt : c.createdAt, c.cadence);
      return {
        id: c.id,
        title: c.title,
        category: c.category,
        cadence: c.cadence,
        active: c.active,
        aiSystem: c.aiSystem,
        owner: users.get(c.ownerUserId) ?? null,
        nextDueAt,
        dueState: dueState(nextDueAt, c.active),
        lastReview: last,
      };
    });
    rows.sort((x, y) => DUE_ORDER[x.dueState] - DUE_ORDER[y.dueState] || x.nextDueAt.getTime() - y.nextDueAt.getTime());
    return reply.send({ checks: rows });
  });

  // Reassessments across AI systems: in progress first, then completed newest first.
  app.get("/ai-reassessments", async (request, reply) => {
    const session = await readSession(request, reply);
    if (!session) {
      return reply;
    }
    const list = await prisma.aiReassessment.findMany({
      where: { tenantId: session.tenantId },
      select: { id: true, reason: true, status: true, materialChange: true, targetDate: true, conclusion: true, initiatedByUserId: true, createdAt: true, completedAt: true, aiSystem: { select: { id: true, name: true } } },
    });
    const users = await userMap(list.map((r) => r.initiatedByUserId));
    const now = Date.now();
    const rows = list.map((r) => ({
      ...r,
      initiatedBy: users.get(r.initiatedByUserId) ?? null,
      pastTarget: r.status === "IN_PROGRESS" && r.targetDate !== null && r.targetDate.getTime() < now,
    }));
    const key = (r: (typeof rows)[number]) => (r.status === "IN_PROGRESS" ? r.createdAt.getTime() : (r.completedAt ?? r.createdAt).getTime());
    rows.sort((x, y) => (x.status === "IN_PROGRESS" ? 0 : 1) - (y.status === "IN_PROGRESS" ? 0 : 1) || key(y) - key(x));
    return reply.send({ reassessments: rows });
  });
}