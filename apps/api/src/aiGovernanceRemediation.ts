/**
 * Step 12 - Remediation, Verification & Finding Closure (GovernanceFinding remediation).
 *
 * Remediation completion != verified remediation != Finding closure. Risk acceptance is separate (not here).
 * Lifecycle: OPEN -> IN_PROGRESS -> PENDING_VERIFICATION (owner submits) -> independent verification:
 *   VERIFIED -> remediation CLOSED + GovernanceFinding CLOSED (one atomic transition)
 *   REJECTED -> remediation back to IN_PROGRESS, Finding stays OPEN
 * One RemediationAction per GovernanceFinding. Verification history is append-only.
 * Vendor and AI-risk remediation keep their existing behaviour.
 */
import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { sessionOf, hasPermission, cleanText, parseOptionalDate, audit, type Session } from "./aiControlEvidence.js";

const USER_SELECT = { id: true, displayName: true, email: true } as const;
const REMEDIATION_INCLUDE = {
  governanceFinding: {
    select: {
      id: true,
      title: true,
      status: true,
      severity: true,
      aiControlTest: {
        select: {
          id: true,
          aiSystemControl: {
            select: { id: true, aiSystem: { select: { id: true, name: true } }, control: { select: { controlId: true, title: true } } },
          },
        },
      },
    },
  },
  verifications: { orderBy: { createdAt: "desc" }, include: { verifier: { select: USER_SELECT } } },
} as const;
const FINDING_NOT_OPEN = "FINDING_NOT_OPEN";

async function resolveOwner(body: { ownerUserId?: unknown; ownerEmail?: unknown }, tenantId: string): Promise<string | null | "invalid"> {
  let userId: string | null = null;
  if (typeof body.ownerUserId === "string" && body.ownerUserId.length > 0) {
    userId = body.ownerUserId;
  } else if (typeof body.ownerEmail === "string" && body.ownerEmail.trim().length > 0) {
    const user = await prisma.user.findFirst({ where: { email: { equals: body.ownerEmail.trim(), mode: "insensitive" } } });
    if (!user) {
      return "invalid";
    }
    userId = user.id;
  } else {
    return null;
  }
  const membership = await prisma.tenantMembership.findFirst({ where: { userId, tenantId } });
  return membership ? userId : "invalid";
}

async function decorate<T extends { ownerUserId: string | null; dueDate: Date | null; status: string }>(rem: T) {
  const owner = rem.ownerUserId ? await prisma.user.findUnique({ where: { id: rem.ownerUserId }, select: USER_SELECT }) : null;
  const overdue = rem.dueDate !== null && rem.dueDate.getTime() < Date.now() && rem.status !== "CLOSED";
  return { ...rem, owner, overdue };
}

async function loadRemediation(id: string, tenantId: string) {
  const rem = await prisma.remediationAction.findFirst({
    where: { id, tenantId, governanceFindingId: { not: null } },
    include: REMEDIATION_INCLUDE,
  });
  return rem ? decorate(rem) : null;
}

async function denyVerification(session: Session, remediationId: string, reason: string): Promise<void> {
  await audit(session, "governance_remediation.verification_denied", "RemediationAction", remediationId, { reason }, "DENIED");
}

export async function registerGovernanceRemediationRoutes(app: FastifyInstance): Promise<void> {
  // 1. Create remediation for an OPEN Finding (owner required).
  app.post("/governance-findings/:id/remediation", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "remediation:create")) {
      return reply.status(403).send({ error: "Not authorized to create remediation" });
    }
    if (!session.userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const finding = await prisma.governanceFinding.findFirst({ where: { id, tenantId: session.tenantId } });
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    if (finding.status !== "OPEN") {
      return reply.status(400).send({ error: "Remediation can only be created for an OPEN (confirmed) Finding" });
    }
    const body = (request.body ?? {}) as { title?: unknown; description?: unknown; dueDate?: unknown; ownerUserId?: unknown; ownerEmail?: unknown };
    const title = cleanText(body.title, 200);
    const description = cleanText(body.description, 4000);
    if (!title || !description) {
      return reply.status(400).send({ error: "title (max 200) and corrective action description (max 4000) are required" });
    }
    const owner = await resolveOwner(body, session.tenantId);
    if (owner === null || owner === "invalid") {
      return reply.status(400).send({ error: "An accountable owner who is a member of this organization is required" });
    }
    const dueDate = parseOptionalDate(body.dueDate);
    if (dueDate === "invalid") {
      return reply.status(400).send({ error: "dueDate must be a valid date" });
    }
    try {
      const created = await prisma.remediationAction.create({
        data: { tenantId: session.tenantId, governanceFindingId: finding.id, title, description, ownerUserId: owner, dueDate, status: "OPEN" },
      });
      await audit(session, "governance_remediation.created", "RemediationAction", created.id, { governanceFindingId: finding.id, ownerUserId: owner });
      return reply.status(201).send(await loadRemediation(created.id, session.tenantId));
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        return reply.status(409).send({ error: "This Finding already has a remediation" });
      }
      throw err;
    }
  });

  // 2. The remediation (with verification history) for a Finding.
  app.get("/governance-findings/:id/remediation", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view remediation" });
    }
    const { id } = request.params as { id: string };
    const finding = await prisma.governanceFinding.findFirst({ where: { id, tenantId: session.tenantId }, select: { id: true } });
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    const rem = await prisma.remediationAction.findFirst({ where: { tenantId: session.tenantId, governanceFindingId: finding.id }, select: { id: true } });
    return reply.send({ remediation: rem ? await loadRemediation(rem.id, session.tenantId) : null });
  });

  // 3. Remediation detail.
  app.get("/governance-remediations/:id", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "ai-system:read")) {
      return reply.status(403).send({ error: "Not authorized to view remediation" });
    }
    const { id } = request.params as { id: string };
    const rem = await loadRemediation(id, session.tenantId);
    if (!rem) {
      return reply.status(404).send({ error: "Remediation not found" });
    }
    return reply.send(rem);
  });

  // 4. Update details / owner / progress (OPEN <-> IN_PROGRESS only).
  app.patch("/governance-remediations/:id", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    const userId = session.userId;
    if (!userId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const rem = await prisma.remediationAction.findFirst({ where: { id, tenantId: session.tenantId, governanceFindingId: { not: null } } });
    if (!rem) {
      return reply.status(404).send({ error: "Remediation not found" });
    }
    const isOwner = rem.ownerUserId === userId;
    const canUpdate = hasPermission(session, "remediation:update");
    const canManage = canUpdate || hasPermission(session, "remediation:create");
    if (!isOwner && !canManage) {
      return reply.status(403).send({ error: "Not authorized to update this remediation" });
    }
    if (rem.status === "CLOSED") {
      return reply.status(409).send({ error: "Closed remediations are locked" });
    }
    if (rem.status === "PENDING_VERIFICATION") {
      return reply.status(409).send({ error: "This remediation is waiting for independent verification" });
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const data: { title?: string; description?: string; dueDate?: Date | null; ownerUserId?: string; status?: "OPEN" | "IN_PROGRESS" } = {};
    if ("status" in body) {
      if (body.status !== "OPEN" && body.status !== "IN_PROGRESS") {
        return reply.status(400).send({
          error: "Only OPEN or IN_PROGRESS can be set here. Submitting for verification and verification are separate steps.",
        });
      }
      if (!isOwner && !canUpdate) {
        return reply.status(403).send({ error: "Only the owner or a remediation manager can change progress" });
      }
      data.status = body.status;
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
    if ("dueDate" in body) {
      const dueDate = parseOptionalDate(body.dueDate);
      if (dueDate === "invalid") {
        return reply.status(400).send({ error: "dueDate must be a valid date" });
      }
      data.dueDate = dueDate;
    }
    if ("ownerUserId" in body || "ownerEmail" in body) {
      if (!canManage) {
        return reply.status(403).send({ error: "Only a remediation manager can reassign the owner" });
      }
      const owner = await resolveOwner(body, session.tenantId);
      if (owner === null || owner === "invalid") {
        return reply.status(400).send({ error: "The owner must be a member of this organization" });
      }
      data.ownerUserId = owner;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const updated = await prisma.remediationAction.updateMany({ where: { id: rem.id, tenantId: session.tenantId, status: rem.status }, data });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This remediation was changed by someone else" });
    }
    await audit(session, "governance_remediation.updated", "RemediationAction", rem.id, { fields: Object.keys(data).join(",") });
    if (data.status && data.status !== rem.status) {
      await audit(session, "governance_remediation.status_changed", "RemediationAction", rem.id, { from: rem.status, to: data.status });
    }
    if (data.ownerUserId && data.ownerUserId !== rem.ownerUserId) {
      await audit(session, "governance_remediation.owner_changed", "RemediationAction", rem.id, { from: rem.ownerUserId, to: data.ownerUserId });
    }
    return reply.send(await loadRemediation(rem.id, session.tenantId));
  });

  // 5. Owner submits for independent verification (IN_PROGRESS -> PENDING_VERIFICATION).
  app.post("/governance-remediations/:id/submit", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    const { id } = request.params as { id: string };
    const rem = await prisma.remediationAction.findFirst({ where: { id, tenantId: session.tenantId, governanceFindingId: { not: null } } });
    if (!rem) {
      return reply.status(404).send({ error: "Remediation not found" });
    }
    if (!session.userId || rem.ownerUserId !== session.userId) {
      return reply.status(403).send({ error: "Only the remediation owner can submit it for verification" });
    }
    if (rem.status !== "IN_PROGRESS") {
      return reply.status(409).send({ error: "Only remediation that is In Progress can be submitted for verification" });
    }
    const updated = await prisma.remediationAction.updateMany({
      where: { id: rem.id, tenantId: session.tenantId, status: "IN_PROGRESS" },
      data: { status: "PENDING_VERIFICATION" },
    });
    if (updated.count === 0) {
      return reply.status(409).send({ error: "This remediation was changed by someone else" });
    }
    await audit(session, "governance_remediation.submitted_for_verification", "RemediationAction", rem.id, { governanceFindingId: rem.governanceFindingId });
    return reply.send(await loadRemediation(rem.id, session.tenantId));
  });

  // 6. Independent verification: VERIFIED (close remediation + Finding) or REJECTED (back to IN_PROGRESS).
  app.post("/governance-remediations/:id/verify", async (request, reply) => {
    const session = sessionOf(request);
    if (!session) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    if (!hasPermission(session, "remediation:verify")) {
      return reply.status(403).send({ error: "Only ADMIN, REVIEWER or AUDITOR users can verify remediation" });
    }
    const verifierUserId = session.userId;
    if (!verifierUserId) {
      return reply.status(403).send({ error: "A signed-in user identity is required" });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { decision?: unknown; rationale?: unknown };
    if (body.decision !== "VERIFIED" && body.decision !== "REJECTED") {
      return reply.status(400).send({ error: "decision must be VERIFIED or REJECTED" });
    }
    const decision = body.decision;
    const rationale = cleanText(body.rationale, 4000);
    if (!rationale) {
      return reply.status(400).send({ error: "A rationale (max 4000 characters) is required" });
    }
    const rem = await prisma.remediationAction.findFirst({ where: { id, tenantId: session.tenantId, governanceFindingId: { not: null } } });
    const findingId = rem?.governanceFindingId;
    if (!rem || !findingId) {
      return reply.status(404).send({ error: "Remediation not found" });
    }
    if (rem.ownerUserId === verifierUserId) {
      await denyVerification(session, rem.id, "verifier_is_owner");
      return reply.status(403).send({ error: "Separation of duties: the remediation owner cannot verify their own remediation" });
    }
    if (rem.status !== "PENDING_VERIFICATION") {
      return reply.status(409).send({ error: "Only remediation pending verification can be verified" });
    }
    const newStatus = decision === "VERIFIED" ? ("CLOSED" as const) : ("IN_PROGRESS" as const);
    let verification;
    try {
      verification = await prisma.$transaction(async (tx) => {
        const updated = await tx.remediationAction.updateMany({
          where: { id: rem.id, tenantId: session.tenantId, status: "PENDING_VERIFICATION" },
          data:
            decision === "VERIFIED"
              ? { status: "CLOSED" as const, closedAt: new Date(), closedByUserId: verifierUserId }
              : { status: "IN_PROGRESS" as const },
        });
        if (updated.count === 0) {
          return null;
        }
        if (decision === "VERIFIED") {
          const closed = await tx.governanceFinding.updateMany({
            where: { id: findingId, tenantId: session.tenantId, status: "OPEN" },
            data: { status: "CLOSED" },
          });
          if (closed.count === 0) {
            throw new Error(FINDING_NOT_OPEN);
          }
        }
        return tx.remediationVerification.create({
          data: {
            tenantId: session.tenantId,
            remediationId: rem.id,
            verifierUserId,
            decision,
            rationale,
            previousStatus: "PENDING_VERIFICATION",
            newStatus,
          },
        });
      });
    } catch (err) {
      if ((err as Error).message === FINDING_NOT_OPEN) {
        return reply.status(409).send({ error: "The Finding is not OPEN, so it cannot be closed" });
      }
      throw err;
    }
    if (!verification) {
      return reply.status(409).send({ error: "This remediation was already verified" });
    }
    if (decision === "VERIFIED") {
      await audit(session, "governance_remediation.verified", "RemediationAction", rem.id, { verificationId: verification.id });
      await audit(session, "governance_remediation.closed", "RemediationAction", rem.id, { governanceFindingId: findingId });
      await audit(session, "governance_finding.closed", "GovernanceFinding", findingId, { remediationId: rem.id, verificationId: verification.id });
    } else {
      await audit(session, "governance_remediation.rejected", "RemediationAction", rem.id, { verificationId: verification.id });
    }
    return reply.send(await loadRemediation(rem.id, session.tenantId));
  });
}