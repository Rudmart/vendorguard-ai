/**
 * Alignment Phase C - read-only aggregation for Dashboard, My Work and Pending Reviews.
 * No task/review table: everything is derived from existing authoritative records.
 * Identity, tenant and permissions come only from the verified signed session.
 * Pending Reviews applies the SAME permission + lifecycle + separation-of-duties rules
 * as each authoritative decision endpoint (the endpoints still enforce them on submit).
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, type Session } from "./aiControlEvidence.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";
import { nextDueDate, dueState, ACCEPTANCE_EXPIRING_DAYS } from "./aiMonitoring.js";

const DAY = 24 * 3600 * 1000;

export type PendingItem = { type: string; id: string; title: string; context: string; since: Date | null; why: string; href: string };
export type WorkItem = { type: string; id: string; title: string; context: string; state: string; due: Date | null; href: string; priority: number };

function field(row: unknown, name: string): string {
  const v = (row as Record<string, unknown>)[name];
  return typeof v === "string" ? v : "";
}

/** Latest COMPLETED risk assessment per AI system (latest-assessed posture). */
async function latestCompletedRiskAssessmentIds(tenantId: string, aiSystemIds?: string[]): Promise<Set<string>> {
  const list = await prisma.aiRiskAssessment.findMany({
    where: { tenantId, ...(aiSystemIds ? { aiSystemId: { in: aiSystemIds } } : {}) },
    orderBy: { version: "desc" },
    select: { id: true, aiSystemId: true, status: true },
  });
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const a of list) {
    if (a.status === "COMPLETED" && !seen.has(a.aiSystemId)) {
      seen.add(a.aiSystemId);
      ids.add(a.id);
    }
  }
  return ids;
}

export async function pendingReviewsFor(session: Session): Promise<PendingItem[]> {
  const me = session.userId ?? "";
  const t = session.tenantId;
  const items: PendingItem[] = [];

  if (hasPermission(session, "ai-control-evidence:review")) {
    const links = await prisma.aiSystemControlEvidence.findMany({
      where: { tenantId: t, status: "PENDING_REVIEW", aiSystemControl: {aiSystem:{lifecycleStatus:{not:"RETIRED"}}} },
      include: { evidenceDocument: { select: { uploadedByUserId: true, displayFilename: true } } },
    });
    const eligible = links.filter((l) => l.submittedByUserId !== me && l.evidenceDocument.uploadedByUserId !== me);
    const recIds = eligible.map((l) => field(l, "aiSystemControlId"));
    const recs = await prisma.aiSystemControl.findMany({ where: { tenantId: t, id: { in: recIds } }, select: { id: true, aiSystem: { select: { name: true } }, control: { select: { controlId: true } } } });
    const recMap = new Map(recs.map((r) => [r.id, r]));
    for (const l of eligible) {
      const recId = field(l, "aiSystemControlId");
      const rec = recMap.get(recId);
      items.push({ type: "EVIDENCE_REVIEW", id: l.id, title: l.evidenceDocument.displayFilename, context: rec ? `${rec.aiSystem.name} - ${rec.control.controlId}` : "AI control", since: l.submittedAt ?? null, why: "Evidence awaiting independent review (you did not submit or upload it)", href: `/ai-system-controls/${recId}/evidence` });
    }
  }

  if (hasPermission(session, "finding:review")) {
    const findings = await prisma.governanceFinding.findMany({
      where: { tenantId: t, status: "PENDING_REVIEW" },
      select: { id: true, title: true, createdAt: true, createdByUserId: true, aiControlTest: { select: { aiSystemControl: { select: { aiSystem: { select: { id: true, name: true } } } } } } },
    });
    for (const f of findings.filter((x) => x.createdByUserId !== me)) {
      const sys = f.aiControlTest?.aiSystemControl.aiSystem;
      items.push({ type: "FINDING_REVIEW", id: f.id, title: f.title, context: sys?.name ?? "AI system", since: f.createdAt, why: "Finding awaiting confirmation or dismissal (you did not raise it)", href: sys ? `/ai-systems/${sys.id}/findings` : "/findings" });
    }
  }

  if (hasPermission(session, "remediation:verify")) {
    const rems = await prisma.remediationAction.findMany({
      where: { tenantId: t, status: "PENDING_VERIFICATION", governanceFindingId: { not: null } },
      select: { id: true, title: true, createdAt: true, ownerUserId: true, governanceFinding: { select: { aiControlTest: { select: { aiSystemControl: { select: { aiSystem: { select: { id: true, name: true } } } } } } } } },
    });
    for (const r of rems.filter((x) => x.ownerUserId !== me)) {
      const sys = r.governanceFinding?.aiControlTest?.aiSystemControl.aiSystem;
      items.push({ type: "REMEDIATION_VERIFICATION", id: r.id, title: r.title, context: sys?.name ?? "AI system", since: r.createdAt, why: "Remediation submitted for independent verification (you do not own it)", href: sys ? `/ai-systems/${sys.id}/findings` : "/remediation" });
    }
  }

  if (hasPermission(session, "risk:accept")) {
    const reqs = await prisma.riskAcceptance.findMany({
      where: { tenantId: t, status: "PENDING_REVIEW", aiRiskId: { not: null } },
      select: { id: true, createdAt: true, requestedByUserId: true, aiRiskId: true, aiRisk: { select: { title: true, assessment: { select: { aiSystem: { select: { name: true } } } } } } },
    });
    for (const r of reqs.filter((x) => x.requestedByUserId !== me)) {
      items.push({ type: "RISK_ACCEPTANCE_DECISION", id: r.id, title: r.aiRisk?.title ?? "Risk", context: r.aiRisk?.assessment.aiSystem.name ?? "AI system", since: r.createdAt, why: "Risk Acceptance request awaiting an independent decision (you did not request it)", href: `/risk-acceptance/${r.aiRiskId ?? ""}` });
    }
  }

  if (hasPermission(session, "ai-risk-assessment:review")) {
    const list = await prisma.aiRiskAssessment.findMany({ where: { tenantId: t, status: "READY_FOR_REVIEW" }, select: { id: true, name: true, version: true, updatedAt: true, assessorUserId: true, aiSystem: { select: { name: true } } } });
    for (const a of list.filter((x) => x.assessorUserId !== null && x.assessorUserId !== me)) {
      items.push({ type: "RISK_ASSESSMENT_REVIEW", id: a.id, title: `${a.name} (v${a.version})`, context: a.aiSystem.name, since: a.updatedAt, why: "Risk assessment ready for independent review (you are not the assessor)", href: `/ai-risk-assessments/${a.id}` });
    }
  }

  if (hasPermission(session, "ai-impact-assessment:review")) {
    const list = await prisma.aiImpactAssessment.findMany({ where: { tenantId: t, status: "READY_FOR_REVIEW" }, select: { id: true, name: true, version: true, updatedAt: true, assessorUserId: true, aiSystem: { select: { name: true } } } });
    for (const a of list.filter((x) => x.assessorUserId !== null && x.assessorUserId !== me)) {
      items.push({ type: "IMPACT_ASSESSMENT_REVIEW", id: a.id, title: `${a.name} (v${a.version})`, context: a.aiSystem.name, since: a.updatedAt, why: "Impact assessment ready for independent review (you are not the assessor)", href: `/ai-impact-assessments/${a.id}` });
    }
  }

  if (hasPermission(session, "ai-incident:review")) {
    const incidents = await prisma.aiIncident.findMany({ where: { tenantId: t, status: "PENDING_REVIEW", ownerUserId: { not: me }, reporterUserId: { not: me }, closureSubmitterUserId: { not: me } }, include: { aiSystem: { select: { name: true } } } });
    for (const i of incidents) if (i.ownerUserId && i.closureSubmitterUserId) items.push({ type: "INCIDENT_CLOSURE_REVIEW", id: i.id, title: i.title, context: i.aiSystem.name, since: i.submittedAt, why: "Incident closure awaiting independent review", href: `/ai-incidents/${i.id}` });
  }
  if (hasPermission(session, "ai-retirement:review")) {
    const requests = await prisma.aiSystemRetirement.findMany({ where: { tenantId: t, status: "PENDING_REVIEW" }, include: { aiSystem: true } });
    for (const r of requests) if (![r.requesterUserId, r.submitterUserId, r.ownerAtSubmissionUserId, r.aiSystem.ownerUserId].includes(me)) items.push({ type: "AI_RETIREMENT_REVIEW", id: r.id, title: `Retirement: ${r.aiSystem.name}`, context: r.aiSystem.name, since: r.submittedAt, why: "Permanent retirement awaiting independent human review", href: `/ai-retirements/${r.id}` });
  }
  // Unfinished work remains historical after retirement, rather than executable.
  const retired = await prisma.aiSystem.findMany({ where: { tenantId: t, lifecycleStatus: "RETIRED" }, select: { id: true } });
  const riskIds = await prisma.aiRiskAssessment.findMany({ where: { tenantId: t, aiSystemId: { in: retired.map(x=>x.id) } }, select: { id:true } });
  const impactIds = await prisma.aiImpactAssessment.findMany({ where: { tenantId: t, aiSystemId: { in: retired.map(x=>x.id) } }, select: { id:true } });
  const blocked = new Set([...riskIds, ...impactIds].map(x=>x.id));
  for (let n=items.length-1;n>=0;n--) if (["RISK_ASSESSMENT_REVIEW", "IMPACT_ASSESSMENT_REVIEW"].includes(items[n]!.type) && blocked.has(items[n]!.id)) items.splice(n,1);
  items.sort((x, y) => (x.since?.getTime() ?? 0) - (y.since?.getTime() ?? 0));
  return items;
}

const SEVERITY_PRIORITY: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export async function myWorkFor(session: Session): Promise<WorkItem[]> {
  const me = session.userId;
  if (!me) {
    return [];
  }
  const t = session.tenantId;
  const now = Date.now();
  const items: WorkItem[] = [];

  if (hasPermission(session, "ai-system:update")) {
    const incidents = await prisma.aiIncident.findMany({ where: { tenantId: t, ownerUserId: me, status: { in: ["OPEN", "IN_PROGRESS"] } }, include: { aiSystem: { select: { name: true } } } });
    for (const i of incidents) items.push({ type: "AI_INCIDENT", id: i.id, title: i.title, context: i.aiSystem.name, state: i.status, due: null, href: `/ai-incidents/${i.id}`, priority: SEVERITY_PRIORITY[i.severity] ?? 3 });
  }

  const findings = await prisma.governanceFinding.findMany({
    where: { tenantId: t, ownerUserId: me, status: "OPEN" },
    select: { id: true, title: true, severity: true, aiControlTest: { select: { aiSystemControl: { select: { aiSystem: { select: { id: true, name: true } } } } } } },
  });
  for (const f of findings) {
    const sys = f.aiControlTest?.aiSystemControl.aiSystem;
    items.push({ type: "FINDING", id: f.id, title: f.title, context: sys?.name ?? "AI system", state: `open - ${f.severity.toLowerCase()}`, due: null, href: sys ? `/ai-systems/${sys.id}/findings` : "/findings", priority: 10 + (SEVERITY_PRIORITY[f.severity] ?? 5) });
  }

  const rems = await prisma.remediationAction.findMany({
    where: { tenantId: t, ownerUserId: me, status: { not: "CLOSED" } },
    select: { id: true, title: true, status: true, dueDate: true, governanceFinding: { select: { aiControlTest: { select: { aiSystemControl: { select: { aiSystem: { select: { id: true, name: true } } } } } } } }, vendor: { select: { legalName: true } } },
  });
  for (const r of rems) {
    const sys = r.governanceFinding?.aiControlTest?.aiSystemControl.aiSystem;
    const overdue = r.dueDate !== null && r.dueDate.getTime() < now;
    const waiting = r.status === "PENDING_VERIFICATION";
    items.push({ type: "REMEDIATION", id: r.id, title: r.title, context: sys?.name ?? r.vendor?.legalName ?? "Remediation", state: waiting ? "waiting for independent verification" : overdue ? "overdue" : r.status.toLowerCase().replace(/_/g, " "), due: r.dueDate, href: sys ? `/ai-systems/${sys.id}/findings` : "/remediation", priority: waiting ? 60 : overdue ? 0 : 20 });
  }

  const risks = await prisma.aiRisk.findMany({
    where: { tenantId: t, treatmentOwnerUserId: me, assessment: { aiSystem: { lifecycleStatus: { not: "RETIRED" } } } },
    select: { id: true, title: true, treatment: true, residualRating: true, treatmentTargetDate: true, assessmentId: true, assessment: { select: { aiSystemId: true, version: true, aiSystem: { select: { name: true } } } } },
  });
  const latest = await latestCompletedRiskAssessmentIds(t, Array.from(new Set(risks.map((r) => r.assessment.aiSystemId))));
  for (const r of risks.filter((x) => latest.has(x.assessmentId))) {
    items.push({ type: "RISK_TREATMENT", id: r.id, title: r.title, context: `${r.assessment.aiSystem.name} (v${r.assessment.version})`, state: `planned treatment: ${(r.treatment ?? "not set").toLowerCase()}`, due: r.treatmentTargetDate ?? null, href: `/ai-risk-assessments/${r.assessmentId}`, priority: 30 });
  }

  const checks = await prisma.aiMonitoringCheck.findMany({
    where: { tenantId: t, ownerUserId: me, active: true },
    include: { aiSystem: { select: { id: true, name: true } }, reviews: { orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true } } },
  });
  for (const c of checks) {
    const next = nextDueDate(c.reviews[0]?.reviewedAt ?? c.createdAt, c.cadence);
    const state = dueState(next, c.active);
    items.push({ type: "MONITORING_CHECK", id: c.id, title: c.title, context: c.aiSystem.name, state: state.toLowerCase().replace(/_/g, " "), due: next, href: `/ai-systems/${c.aiSystem.id}/monitoring/${c.id}`, priority: state === "OVERDUE" ? 1 : state === "DUE_SOON" ? 15 : 50 });
  }

  const riskAsmts = await prisma.aiRiskAssessment.findMany({ where: { tenantId: t, assessorUserId: me, aiSystem: { lifecycleStatus: { not: "RETIRED" } }, status: { in: ["DRAFT", "IN_PROGRESS"] } }, select: { id: true, name: true, version: true, status: true, aiSystem: { select: { name: true } } } });
  for (const a of riskAsmts) {
    items.push({ type: "RISK_ASSESSMENT", id: a.id, title: `${a.name} (v${a.version})`, context: a.aiSystem.name, state: a.status.toLowerCase().replace(/_/g, " "), due: null, href: `/ai-risk-assessments/${a.id}`, priority: 25 });
  }
  const impactAsmts = await prisma.aiImpactAssessment.findMany({ where: { tenantId: t, assessorUserId: me, aiSystem: { lifecycleStatus: { not: "RETIRED" } }, status: { in: ["DRAFT", "IN_PROGRESS"] } }, select: { id: true, name: true, version: true, status: true, aiSystem: { select: { name: true } } } });
  for (const a of impactAsmts) {
    items.push({ type: "IMPACT_ASSESSMENT", id: a.id, title: `${a.name} (v${a.version})`, context: a.aiSystem.name, state: a.status.toLowerCase().replace(/_/g, " "), due: null, href: `/ai-impact-assessments/${a.id}`, priority: 25 });
  }

  if (hasPermission(session, "ai-system:update")) {
    const requests = await prisma.aiSystemRetirement.findMany({ where: { tenantId: t, status: "DRAFT", OR: [{ requesterUserId: me }, { aiSystem: { ownerUserId: me } }] }, include: { aiSystem: true } });
    for (const r of requests) items.push({ type: "AI_RETIREMENT", id: r.id, title: `Retirement: ${r.aiSystem.name}`, context: r.aiSystem.name, state: "draft preparation", due: r.requestedRetirementDate, href: `/ai-retirements/${r.id}`, priority: 25 });
  }
  items.sort((x, y) => x.priority - y.priority || (x.due?.getTime() ?? Infinity) - (y.due?.getTime() ?? Infinity));
  return items;
}

export async function registerWorkQueueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reviews/pending", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    const items = await pendingReviewsFor(session);
    return reply.send({ count: items.length, items });
  });

  app.get("/my-work", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    const items = await myWorkFor(session);
    return reply.send({ count: items.length, items });
  });

  app.get("/dashboard/summary", async (request, reply) => {
    const session = await sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view the dashboard" });
    }
    const t = session.tenantId;
    const now = Date.now();

    const systems = await prisma.aiSystem.findMany({ where: { tenantId: t }, select: { id: true, lifecycleStatus: true } });
    const riskAs = await prisma.aiRiskAssessment.findMany({ where: { tenantId: t, status: "COMPLETED" }, select: { aiSystemId: true } });
    const impactAs = await prisma.aiImpactAssessment.findMany({ where: { tenantId: t, status: "COMPLETED" }, select: { aiSystemId: true } });
    const withRisk = new Set(riskAs.map((a) => a.aiSystemId));
    const withImpact = new Set(impactAs.map((a) => a.aiSystemId));
    const latestIds = await latestCompletedRiskAssessmentIds(t);
    const latestRisks = await prisma.aiRisk.findMany({ where: { tenantId: t, assessmentId: { in: Array.from(latestIds) } }, select: { residualRating: true } });
    const residual: Record<string, number> = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0, NOT_ASSESSED: 0 };
    for (const r of latestRisks) {
      const key = r.residualRating ?? "NOT_ASSESSED";
      residual[key] = (residual[key] ?? 0) + 1;
    }

    const findings = await prisma.governanceFinding.findMany({ where: { tenantId: t, status: { in: ["OPEN", "PENDING_REVIEW"] } }, select: { status: true, severity: true } });
    const rems = await prisma.remediationAction.findMany({ where: { tenantId: t, status: { not: "CLOSED" } }, select: { status: true, dueDate: true, vendorId: true } });
    const aiRems = rems.filter((r) => r.vendorId === null);
    const acceptances = await prisma.riskAcceptance.findMany({ where: { tenantId: t, aiRiskId: { not: null } }, select: { status: true, expiresAt: true } });
    let active = 0;
    let expiring = 0;
    let expired = 0;
    for (const a of acceptances.filter((x) => x.status === "APPROVED")) {
      const state = deriveAcceptanceState(a.status, a.expiresAt, now);
      if (state === "ACTIVE") {
        active++;
        if (a.expiresAt && a.expiresAt.getTime() - now <= ACCEPTANCE_EXPIRING_DAYS * DAY) {
          expiring++;
        }
      } else {
        expired++;
      }
    }
    const checks = await prisma.aiMonitoringCheck.findMany({ where: { tenantId: t, active: true }, include: { reviews: { orderBy: { reviewedAt: "desc" }, take: 1, select: { reviewedAt: true } } } });
    let monOverdue = 0;
    let monSoon = 0;
    for (const c of checks) {
      const state = dueState(nextDueDate(c.reviews[0]?.reviewedAt ?? c.createdAt, c.cadence), true, now);
      if (state === "OVERDUE") {
        monOverdue++;
      } else if (state === "DUE_SOON") {
        monSoon++;
      }
    }
    const reas = await prisma.aiReassessment.findMany({ where: { tenantId: t, status: "IN_PROGRESS" }, select: { targetDate: true } });

    let thirdParty: { vendors: number; aiVendors: number; openVendorRemediation: number } | null = null;
    if (hasPermission(session, "vendor:read")) {
      const vendors = await prisma.vendor.findMany({ where: { tenantId: t, deletedAt: null }, select: { aiFunctionality: true } });
      thirdParty = { vendors: vendors.length, aiVendors: vendors.filter((v) => v.aiFunctionality).length, openVendorRemediation: rems.length - aiRems.length };
    }

    return reply.send({
      attention: {
        pendingReviewsForMe: (await pendingReviewsFor(session)).length,
        myWork: (await myWorkFor(session)).length,
        findingsOpen: findings.filter((f) => f.status === "OPEN").length,
        findingsPendingReview: findings.filter((f) => f.status === "PENDING_REVIEW").length,
        criticalOrHighOpenFindings: findings.filter((f) => f.status === "OPEN" && (f.severity === "CRITICAL" || f.severity === "HIGH")).length,
        aiRemediationOverdue: aiRems.filter((r) => r.dueDate !== null && r.dueDate.getTime() < now).length,
        remediationAwaitingVerification: aiRems.filter((r) => r.status === "PENDING_VERIFICATION").length,
        monitoringOverdue: monOverdue,
        monitoringDueSoon: monSoon,
        reassessmentsPastTarget: reas.filter((r) => r.targetDate !== null && r.targetDate.getTime() < now).length,
        riskAcceptanceExpiringSoon: expiring,
        riskAcceptanceExpired: expired,
        riskAcceptancePending: acceptances.filter((a) => a.status === "PENDING_REVIEW").length,
      },
      posture: {
        aiSystems: systems.length,
        inProduction: systems.filter((s) => s.lifecycleStatus === "PRODUCTION").length,
        withoutCompletedRiskAssessment: systems.filter((s) => !withRisk.has(s.id)).length,
        withoutCompletedImpactAssessment: systems.filter((s) => !withImpact.has(s.id)).length,
        latestAssessedResidualRisk: residual,
        aiRemediationOpen: aiRems.length,
        riskAcceptanceActive: active,
        reassessmentsInProgress: reas.length,
        monitoringChecksActive: checks.length,
      },
      thirdParty,
      acceptanceExpiringDays: ACCEPTANCE_EXPIRING_DAYS,
    });
  });
}