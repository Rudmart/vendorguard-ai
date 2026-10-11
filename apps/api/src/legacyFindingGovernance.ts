import { randomUUID } from "node:crypto";
import { prisma, controlVisibility } from "@vendorguard/database";
import type {
  FindingStatus,
  ReviewDecisionType,
  Prisma,
} from "@vendorguard/database";
import type { Session } from "./aiControlEvidence.js";

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export async function proposeLegacyFinding(
  session: Session,
  assessmentId: string,
  controlId: string,
  proposedStatus: FindingStatus,
  reconciliationRationale?: string,
  analysis?: {
    confidence: number;
    gaps: string[];
    recommendations: string[];
    evidence?: Prisma.FindingEvidenceUncheckedCreateWithoutFindingInput;
  },
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${session.tenantId + assessmentId + controlId}, 0))`;
    const assessment = await tx.assessment.findFirst({
      where: { id: assessmentId, tenantId: session.tenantId },
    });
    const control = await tx.control.findFirst({
      where: { id: controlId, ...controlVisibility(session.tenantId) },
    });
    if (!assessment || !control) fail(404, "Assessment or control not found");
    let existing = await tx.controlFinding.findFirst({
      where: { tenantId: session.tenantId, assessmentId, controlId },
      include: { reviewDecisions: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (existing) {
      await tx.$queryRaw`SELECT id FROM control_findings WHERE id=${existing.id} FOR UPDATE`;
      existing = (await tx.controlFinding.findUnique({
        where: { id: existing.id },
        include: {
          reviewDecisions: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }))!;
      if (
        (existing.proposedByUserId && !existing.requiresHumanReview) ||
        (existing.reviewDecisions[0] &&
          existing.reviewDecisions[0]?.decision !== "REQUEST_MORE_EVIDENCE" &&
          existing.reviewDecisions.length > 0)
      )
        fail(409, "Reviewed findings cannot be overwritten by proposals");
      if (!existing.proposedByUserId && !reconciliationRationale)
        fail(
          409,
          "Legacy attribution requires an explicit audited reconciliation proposal",
        );
      if (
        existing.proposedByUserId &&
        existing.proposedByUserId !== session.userId
      )
        fail(403, "Only the attributable proposer may revise this proposal");
    }
    const data = {
      ...(analysis
        ? {
            confidence: analysis.confidence,
            gaps: analysis.gaps,
            recommendations: analysis.recommendations,
          }
        : {}),
      proposedStatus,
      proposedByUserId: session.userId,
      status: "INSUFFICIENT_EVIDENCE" as const,
      requiresHumanReview: true,
    };
    const finding = existing
      ? await tx.controlFinding.update({ where: { id: existing.id }, data })
      : await tx.controlFinding.create({
          data: {
            ...data,
            tenantId: session.tenantId,
            assessmentId,
            vendorId: assessment.vendorId,
            controlId,
          },
        });
    if (analysis?.evidence)
      await tx.findingEvidence.create({
        data: { ...analysis.evidence, findingId: finding.id },
      });
    await tx.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: reconciliationRationale
          ? "legacy_finding.reconciled_proposal"
          : "legacy_finding.proposed",
        targetType: "ControlFinding",
        targetId: finding.id,
        outcome: "SUCCESS",
        correlationId: randomUUID(),
        metadataJson: {
          proposedStatus,
          ...(reconciliationRationale
            ? { reconciliationRationale, attributionScope: "new_proposal_only" }
            : {}),
        },
      },
    });
    return finding;
  });
}

export async function reviewLegacyFinding(
  session: Session,
  assessmentId: string,
  findingId: string,
  decision: ReviewDecisionType,
  rationale: string,
  finalStatus?: FindingStatus,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM control_findings WHERE id=${findingId} AND "tenantId"=${session.tenantId} FOR UPDATE`;
    const finding = await tx.controlFinding.findFirst({
      where: { id: findingId, assessmentId, tenantId: session.tenantId },
      include: { assessment: true },
    });
    if (!finding) fail(404, "Finding not found");
    if (!finding.proposedByUserId)
      fail(409, "Legacy attribution must be reconciled before review");
    if (!finding.requiresHumanReview)
      fail(409, "This finding already has a final decision");
    if (
      finding.proposedByUserId === session.userId ||
      finding.assessment.startedByUserId === session.userId
    ) {
      await tx.auditEvent.create({
        data: {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "legacy_finding.review_denied",
          targetType: "ControlFinding",
          targetId: findingId,
          outcome: "DENIED",
          metadataJson: { reason: "separation_of_duties" },
        },
      });
      return { denied: true as const };
    }
    const status =
      finalStatus ??
      (decision === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE"
        : decision === "ACCEPT" || decision === "OVERRIDE"
          ? (finding.proposedStatus ?? "INSUFFICIENT_EVIDENCE")
          : "INSUFFICIENT_EVIDENCE");
    const correlationId = randomUUID();
    const reviewDecision = await tx.reviewDecision.create({
      data: {
        tenantId: session.tenantId,
        findingId,
        reviewerUserId: session.userId,
        decision,
        rationale,
        correlationId,
        changedValuesJson: { status: { from: finding.status, to: status } },
      },
    });
    const updated = await tx.controlFinding.update({
      where: { id: findingId },
      data: {
        status,
        requiresHumanReview: decision === "REQUEST_MORE_EVIDENCE",
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "legacy_finding.review_recorded",
        targetType: "ControlFinding",
        targetId: findingId,
        correlationId,
        outcome: "SUCCESS",
        metadataJson: { decision, reviewDecisionId: reviewDecision.id },
      },
    });
    return { reviewDecision, finding: updated };
  });
}
