import { randomUUID } from "node:crypto";
import { prisma, type AiAssessmentReviewDecision } from "@vendorguard/database";
import type { Session } from "./aiControlEvidence.js";

type ReviewedRecord = {
  id: string;
  reviewerUserId: string | null;
  reviewedAt: Date | null;
  reviewDecision: AiAssessmentReviewDecision | null;
  reviewRationale: string | null;
  version?: number;
};
export async function appendGovernanceDecision(
  session: Session,
  kind: "AiUseCase" | "AiRiskAssessment" | "AiImpactAssessment",
  previous: ReviewedRecord,
  decision: AiAssessmentReviewDecision,
  rationale: string,
  status: string,
  reconciliationRationale?: unknown,
) {
  const parent =
    kind === "AiUseCase"
      ? { useCaseId: previous.id }
      : kind === "AiRiskAssessment"
        ? { riskAssessmentId: previous.id }
        : { impactAssessmentId: previous.id };
  const completeAttribution = Boolean(
    previous.reviewerUserId &&
      previous.reviewedAt &&
      previous.reviewDecision &&
      previous.reviewRationale?.trim(),
  );
  const hasLegacyFields = Boolean(
    previous.reviewerUserId ||
      previous.reviewedAt ||
      previous.reviewDecision ||
      previous.reviewRationale,
  );
  const legacySnapshot =
    hasLegacyFields && !completeAttribution
      ? {
          reviewerUserId: previous.reviewerUserId,
          reviewedAt: previous.reviewedAt?.toISOString() ?? null,
          decision: previous.reviewDecision,
          rationale: previous.reviewRationale,
          version: previous.version ?? null,
          origin: "actual_stored_fields_with_incomplete_attribution",
        }
      : null;
  const recordedHistory = legacySnapshot
    ? await prisma.governanceDecision.count({
        where: {
          tenantId: session.tenantId,
          ...parent,
          ...(previous.reviewerUserId
            ? { actorUserId: previous.reviewerUserId }
            : {}),
          ...(previous.reviewDecision
            ? { decision: previous.reviewDecision }
            : {}),
          ...(previous.reviewRationale?.trim()
            ? { rationale: previous.reviewRationale }
            : {}),
        },
      })
    : 0;
  const needsReconciliation = Boolean(legacySnapshot && !recordedHistory);
  const reconciliation =
    typeof reconciliationRationale === "string"
      ? reconciliationRationale.trim()
      : "";
  if (needsReconciliation && (!reconciliation || reconciliation.length > 4000))
    throw Object.assign(
      new Error(
        "Legacy review attribution requires an explicit reconciliationRationale before another decision",
      ),
      { statusCode: 409 },
    );
  // Preserve only an actual stored decision; missing historical attribution is never invented.
  if (
    previous.reviewerUserId &&
    previous.reviewedAt &&
    previous.reviewDecision &&
    previous.reviewRationale?.trim()
  ) {
    const exists = await prisma.governanceDecision.findFirst({
      where: {
        tenantId: session.tenantId,
        ...parent,
        actorUserId: previous.reviewerUserId,
        decision: previous.reviewDecision,
        rationale: previous.reviewRationale,
      },
    });
    if (!exists) {
      const correlationId = randomUUID();
      await prisma.governanceDecision.create({
        data: {
          tenantId: session.tenantId,
          ...parent,
          actorUserId: previous.reviewerUserId,
          createdAt: previous.reviewedAt,
          decision: previous.reviewDecision,
          rationale: previous.reviewRationale,
          version: previous.version,
          correlationId,
          context: { origin: "preserved_stored_decision" },
        },
      });
      await prisma.auditEvent.create({
        data: {
          tenantId: session.tenantId,
          actorUserId: session.userId,
          action: "governance_decision.history_preserved",
          targetType: kind,
          targetId: previous.id,
          correlationId,
          outcome: "SUCCESS",
          metadataJson: {
            origin: "stored_fields",
            originalAuditCorrelationUnavailable: true,
          },
        },
      });
    }
  }
  const correlationId = randomUUID();
  const record = await prisma.governanceDecision.create({
    data: {
      tenantId: session.tenantId,
      ...parent,
      actorUserId: session.userId,
      decision,
      rationale,
      version: previous.version,
      correlationId,
      context: {
        status,
        origin: needsReconciliation
          ? "audited_human_legacy_reconciliation"
          : "human_review",
        ...(legacySnapshot ? { legacyReviewSnapshot: legacySnapshot } : {}),
        ...(needsReconciliation
          ? { reconciliationRationale: reconciliation }
          : {}),
      },
    },
  });
  const action =
    kind === "AiUseCase"
      ? "ai_use_case.review_recorded"
      : kind === "AiRiskAssessment"
        ? "ai_risk_assessment.review_recorded"
        : "ai_impact_assessment.review_recorded";
  await prisma.auditEvent.create({
    data: {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action,
      targetType: kind,
      targetId: previous.id,
      correlationId,
      outcome: "SUCCESS",
      metadataJson: {
        decision,
        status,
        governanceDecisionId: record.id,
        ...(needsReconciliation
          ? {
              legacyAttributionReconciled: true,
              reconciliationRationale: reconciliation,
            }
          : {}),
      },
    },
  });
}
