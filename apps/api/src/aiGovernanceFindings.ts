/**
 * Step 11 - Governance Findings (UI term: "Finding").
 *
 *   ControlFinding    = vendor assessment control-evaluation result (NOT touched here)
 *   AiControlTest     = AI-system control evaluation/test result
 *   GovernanceFinding = formal governance record of a deficiency to track and dispose
 *
 * A Finding is created MANUALLY by a human from a COMPLETED control test whose overall
 * result is PARTIALLY_EFFECTIVE or INEFFECTIVE. Lifecycle: PENDING_REVIEW -> OPEN | DISMISSED.
 * CLOSED is reserved for Step 12 (remediation). Reviewing a Finding is NOT risk acceptance.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, audit, type Session } from "./aiControlEvidence.js";

export const FINDING_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type Severity = (typeof FINDING_SEVERITIES)[number];
const ELIGIBLE_RESULTS: ReadonlySet<string> = new Set(["PARTIALLY_EFFECTIVE", "INEFFECTIVE"]);

const USER_SELECT = { id: true, displayName: true, email: true } as const;
const FINDING_INCLUDE = {
  createdBy: { select: USER_SELECT },
  owner: { select: USER_SELECT },
  aiControlTest: {
    select: {
      id: true,
      status: true,
      method: true,
      testDate: true,
      designEffectiveness: true,
      operatingEffectiveness: true,
      overallEffectiveness: true,
      completedAt: true,
      aiSystemControl: {
        select: {
          id: true,
          aiSystemId: true,
          aiSystem: { select: { id: true, name: true } },
          control: { select: { id: true, controlId: true, title: true } },
        },
      },
    },
  },
  reviews: { orderBy: { createdAt: "desc" }, include: { reviewer: { select: USER_SELECT } } },
} as const;

function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (FINDING_SEVERITIES as readonly string[]).includes(value);
}

async function resolveOwner(value: unknown, tenantId: string): Promise<string | null | "invalid"> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return "invalid";
  }
  const membership = await prisma.tenantMembership.findFirst({ where: { userId: value, tenantId } });
  return membership ? value : "invalid";
}

async function loadFinding(id: string, tenantId: string) {
  return prisma.governanceFinding.findFirst({ where: { id, tenantId }, include: FINDING_INCLUDE });
}

async function deny(session: Session, targetId: string, reason: string): Promise<void> {
  await audit(session, "governance_finding.denied", "GovernanceFinding", targetId, { reason }, "DENIED");
}

const NOT_A_CREATOR = "Only ADMIN, REVIEWER or AUDITOR users can create findings";

export async function registerGovernanceFindingRoutes(app: FastifyInstance): Promise<void> {
  // 1. Create a Finding from a completed, deficient control test (manual, human decision).
  app.post("/ai-control-tests/:testId/findings", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-finding:create")) {
      return reply.status(403).send({ error: NOT_A_CREATOR });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { testId } = request.params as { testId: string };
    const test = await prisma.aiControlTest.findFirst({ where: { id: testId, tenantId: session.tenantId } });
    if (!test) {
      return reply.status(404).send({ error: "Control test not found" });
    }
    if (test.status !== "COMPLETED") {
      return reply.status(400).send({ error: "Findings can only be created from a completed control test" });
    }
    if (!ELIGIBLE_RESULTS.has(test.overallEffectiveness)) {
      return reply.status(400).send({ error: "A Finding documents a deficiency: the source test must be Partially Effective or Ineffective" });
    }
    const body = (request.body ?? {}) as { title?: unknown; description?: unknown; severity?: unknown; ownerUserId?: unknown };
    const title = cleanText(body.title, 200);
    const description = cleanText(body.description, 4000);
    if (!title || !description) {
      return reply.status(400).send({ error: "title (max 200) and description of the deficiency (max 4000) are required" });
    }
    if (!isSeverity(body.severity)) {
      return reply.status(400).send({ error: "severity must be one of: " + FINDING_SEVERITIES.join(", ") });
    }
    const owner = await resolveOwner(body.ownerUserId, session.tenantId);
    if (owner === "invalid") {
      return reply.status(400).send({ error: "ownerUserId must be a user in this organization" });
    }
    try {
      const created = await prisma.governanceFinding.create({
        data: {
          tenantId: session.tenantId,
          aiControlTestId: test.id,
          title,
          description,
          severity: body.severity,
          ownerUserId: owner,
          createdByUserId: userId,
        },
      });
      await audit(session, "governance_finding.created", "GovernanceFinding", created.id, {
        aiControlTestId: test.id,
        severity: body.severity,
        testOverallEffectiveness: test.overallEffectiveness,
      });
      return reply.status(201).send(await loadFinding(created.id, session.tenantId));
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "A Finding already exists for this control test" });
      }
      throw err;
    }
  });

  // 2. Finding detail (with source test, control and AI system traceability + review history).
  app.get("/governance-findings/:id", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view findings" });
    }
    const { id } = request.params as { id: string };
    const finding = await loadFinding(id, session.tenantId);
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    return reply.send(finding);
  });

  // 3. Findings for an AI system.
  app.get("/ai-systems/:id/findings", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view findings" });
    }
    const { id } = request.params as { id: string };
    const aiSystem = await prisma.aiSystem.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true, name: true } });
    if (!aiSystem) {
      return reply.status(404).send({ error: "AI system not found" });
    }
    const findings = await prisma.governanceFinding.findMany({
      where: { tenantId: session.tenantId, aiControlTest: { aiSystemControl: { aiSystemId: aiSystem.id } } },
      orderBy: { createdAt: "desc" },
      include: FINDING_INCLUDE,
    });
    return reply.send({
      aiSystem,
      summary: {
        total: findings.length,
        pendingReview: findings.filter((f) => f.status === "PENDING_REVIEW").length,
        open: findings.filter((f) => f.status === "OPEN").length,
        dismissed: findings.filter((f) => f.status === "DISMISSED").length,
      },
      findings,
    });
  });

  // 4. Findings for one mapped control.
  app.get("/ai-system-controls/:controlRecordId/findings", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view findings" });
    }
    const { controlRecordId } = request.params as { controlRecordId: string };
    const record = await prisma.aiSystemControl.findFirst({ where: { id: controlRecordId, tenantId: session.tenantId } });
    if (!record) {
      return reply.status(404).send({ error: "AI system control not found" });
    }
    const findings = await prisma.governanceFinding.findMany({
      where: { tenantId: session.tenantId, aiControlTest: { aiSystemControlId: record.id } },
      orderBy: { createdAt: "desc" },
      include: FINDING_INCLUDE,
    });
    return reply.send({ aiSystemControlId: record.id, findings });
  });

  // 5. Update allowed fields. Content (title/description/severity) only while PENDING_REVIEW and only by
  //    the creator; owner can be set while PENDING_REVIEW or OPEN. Status changes only through review.
  app.patch("/governance-findings/:id", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-finding:create")) {
      return reply.status(403).send({ error: "Not authorized to update findings" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const finding = await loadFinding(id, session.tenantId);
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    if ("status" in body) {
      return reply.status(400).send({ error: "Status changes only through review" });
    }
    if (finding.status !== "PENDING_REVIEW" && finding.status !== "OPEN") {
      return reply.status(409).send({ error: "This Finding is locked" });
    }
    const data: { title?: string; description?: string; severity?: Severity; ownerUserId?: string | null } = {};
    const contentChange = "title" in body || "description" in body || "severity" in body;
    if (contentChange) {
      if (finding.status !== "PENDING_REVIEW") {
        return reply.status(409).send({ error: "Title, description and severity are locked after review" });
      }
      if (finding.createdByUserId !== userId) {
        return reply.status(403).send({ error: "Only the creator can edit the Finding before review" });
      }
      if ("title" in body) {
        const title = cleanText(body.title, 200);
        if (!title) {
          return reply.status(400).send({ error: "title is required (max 200 characters)" });
        }
        data.title = title;
      }
      if ("description" in body) {
        const description = cleanText(body.description, 4000);
        if (!description) {
          return reply.status(400).send({ error: "description is required (max 4000 characters)" });
        }
        data.description = description;
      }
      if ("severity" in body) {
        if (!isSeverity(body.severity)) {
          return reply.status(400).send({ error: "severity must be one of: " + FINDING_SEVERITIES.join(", ") });
        }
        data.severity = body.severity;
      }
    }
    if ("ownerUserId" in body) {
      const owner = await resolveOwner(body.ownerUserId, session.tenantId);
      if (owner === "invalid") {
        return reply.status(400).send({ error: "ownerUserId must be a user in this organization" });
      }
      data.ownerUserId = owner;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const updated = await prisma.governanceFinding.updateMany({
      where: { id: finding.id, tenantId: session.tenantId, status: finding.status },
      data,
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This Finding was changed by someone else" });
    }
    await audit(session, "governance_finding.updated", "GovernanceFinding", finding.id, { fields: Object.keys(data).join(",") });
    if ("ownerUserId" in data && data.ownerUserId !== finding.ownerUserId) {
      await audit(session, "governance_finding.owner_changed", "GovernanceFinding", finding.id, {
        from: finding.ownerUserId,
        to: data.ownerUserId ?? null,
      });
    }
    return reply.send(await loadFinding(finding.id, session.tenantId));
  });

  // 6. Human review: CONFIRM (-> OPEN) or DISMISS (-> DISMISSED). Rationale required. Reviewer != creator.
  app.post("/governance-findings/:id/review", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "finding:review")) {
      return reply.status(403).send({ error: "Only ADMIN or REVIEWER users can review findings" });
    }
    const reviewerUserId = session.userId;
    if (!reviewerUserId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { decision?: unknown; rationale?: unknown };
    if (body.decision !== "CONFIRM" && body.decision !== "DISMISS") {
      return reply.status(400).send({ error: "decision must be CONFIRM or DISMISS" });
    }
    const decision = body.decision;
    const rationale = cleanText(body.rationale, 4000);
    if (!rationale) {
      return reply.status(400).send({ error: "A rationale (max 4000 characters) is required" });
    }
    const finding = await prisma.governanceFinding.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    if (finding.createdByUserId === reviewerUserId) {
      await deny(session, finding.id, "reviewer_is_creator");
      return reply.status(403).send({ error: "Separation of duties: you cannot review a Finding you created" });
    }
    if (finding.status !== "PENDING_REVIEW") {
      return reply.status(409).send({ error: "Only Findings pending review can be reviewed" });
    }
    const newStatus = decision === "CONFIRM" ? ("OPEN" as const) : ("DISMISSED" as const);
    const review = await prisma.$transaction(async (tx) => {
      const updated = await tx.governanceFinding.updateMany({
        where: { id: finding.id, tenantId: session.tenantId, status: "PENDING_REVIEW" },
        data: { status: newStatus },
      });
      if (updated.count === 0) {
        return null;
      }
      return tx.governanceFindingReview.create({
        data: {
          tenantId: session.tenantId,
          findingId: finding.id,
          reviewerUserId,
          decision,
          rationale,
          previousStatus: "PENDING_REVIEW",
          newStatus,
        },
      });
    });
    if (!review) {
      return reply.status(409).send({ error: "This Finding was already reviewed" });
    }
    await audit(session, "governance_finding.reviewed", "GovernanceFinding", finding.id, {
      decision,
      from: "PENDING_REVIEW",
      to: newStatus,
      reviewId: review.id,
    });
    return reply.send(await loadFinding(finding.id, session.tenantId));
  });
}