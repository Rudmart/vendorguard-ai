import { databaseClient, Prisma } from "@vendorguard/database";
import type { ReportScope } from "@vendorguard/shared";
import { hasPermission, type Session } from "./aiControlEvidence.js";
export class ReportError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const SOURCE_LIMIT = 5000;
function bounded<T>(rows: T[]): T[] {
  if (rows.length > SOURCE_LIMIT)
    throw new ReportError(
      413,
      "Report source limit exceeded; narrow the AI system filter",
    );
  return rows;
}
/** All reads use one repeatable-read connection. No storage/PDF I/O or governance writes. */
export async function loadReportData(session: Session, aiSystemId?: string) {
  return databaseClient.$transaction(
    async (tx) => {
      const generatedAt = new Date(),
        tenantId = session.tenantId;
      const take = SOURCE_LIMIT + 1;
      const systems = bounded(
        await tx.aiSystem.findMany({
          where: { tenantId, ...(aiSystemId ? { id: aiSystemId } : {}) },
          take,
          select: {
            id: true,
            name: true,
            lifecycleStatus: true,
            ownerUserId: true,
            retiredAt: true,
          },
        }),
      );
      if (aiSystemId && !systems.length)
        throw new ReportError(404, "AI system not found");
      const ids = systems.map((s) => s.id),
        systemWhere = { tenantId, aiSystemId: { in: ids } };
      const assessmentSelect = {
        id: true,
        aiSystemId: true,
        name: true,
        status: true,
        version: true,
        reviewDecision: true,
        reviewerUserId: true,
        reviewedAt: true,
      } as const;
      const reviewSelect = {
        id: true,
        decision: true,
        reviewerUserId: true,
        createdAt: true,
      } as const;
      const riskAssessments = bounded(
        await tx.aiRiskAssessment.findMany({
          where: systemWhere,
          take,
          select: assessmentSelect,
        }),
      );
      const impactAssessments = bounded(
        await tx.aiImpactAssessment.findMany({
          where: systemWhere,
          take,
          select: assessmentSelect,
        }),
      );
      const risks = bounded(
        await tx.aiRisk.findMany({
          where: {
            tenantId,
            assessmentId: { in: riskAssessments.map((a) => a.id) },
          },
          take,
          select: {
            id: true,
            assessmentId: true,
            title: true,
            residualRating: true,
            treatmentOwnerUserId: true,
          },
        }),
      );
      const impacts = bounded(
        await tx.aiImpact.findMany({
          where: {
            tenantId,
            assessmentId: { in: impactAssessments.map((a) => a.id) },
          },
          take,
          select: {
            id: true,
            assessmentId: true,
            title: true,
            direction: true,
            severity: true,
          },
        }),
      );
      const useCases = bounded(
        await tx.aiUseCase.findMany({
          where: systemWhere,
          take,
          select: {
            id: true,
            aiSystemId: true,
            name: true,
            status: true,
            ownerUserId: true,
            reviewerUserId: true,
            reviewDecision: true,
            reviewedAt: true,
          },
        }),
      );
      const frameworks = bounded(
        await tx.aiSystemFrameworkApplicability.findMany({
          where: {
            ...systemWhere,
            framework: { OR: [{ tenantId: null }, { tenantId }] },
          },
          take,
          select: {
            id: true,
            aiSystemId: true,
            status: true,
            determinedByUserId: true,
            determinedAt: true,
            framework: { select: { name: true } },
          },
        }),
      );
      const controls = bounded(
        await tx.aiSystemControl.findMany({
          where: {
            ...systemWhere,
            sourceApplicability: {
              tenantId,
              aiSystemId: { in: ids },
              framework: { OR: [{ tenantId: null }, { tenantId }] },
            },
            control: {
              frameworkVersion: {
                framework: { OR: [{ tenantId: null }, { tenantId }] },
              },
            },
          },
          take,
          select: {
            id: true,
            aiSystemId: true,
            sourceApplicabilityId: true,
            applicability: true,
            implementationStatus: true,
            ownerUserId: true,
            sourceApplicability: { select: { aiSystemId: true } },
            control: { select: { title: true } },
          },
        }),
      ).filter((c) => c.aiSystemId === c.sourceApplicability.aiSystemId);
      const tests = bounded(
        await tx.aiControlTest.findMany({
          where: {
            tenantId,
            aiSystemControlId: { in: controls.map((c) => c.id) },
          },
          take,
          select: {
            id: true,
            aiSystemControlId: true,
            status: true,
            overallEffectiveness: true,
            testDate: true,
            nextTestDate: true,
            createdAt: true,
            testerUserId: true,
          },
        }),
      );
      const incidents = bounded(
        await tx.aiIncident.findMany({
          where: systemWhere,
          take,
          select: {
            id: true,
            aiSystemId: true,
            title: true,
            status: true,
            severity: true,
            ownerUserId: true,
            reviews: {
              where: { tenantId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: reviewSelect,
            },
          },
        }),
      );
      const incidentLinks = bounded(
        await tx.aiIncidentFinding.findMany({
          where: {
            tenantId,
            incidentId: { in: incidents.map((i) => i.id) },
            finding: { tenantId },
          },
          take,
          select: { incidentId: true, findingId: true },
        }),
      );
      const findings = bounded(
        await tx.governanceFinding.findMany({
          where: {
            tenantId,
            OR: [
              { aiControlTestId: { in: tests.map((t) => t.id) } },
              { id: { in: incidentLinks.map((l) => l.findingId) } },
            ],
          },
          take,
          select: {
            id: true,
            aiControlTestId: true,
            title: true,
            status: true,
            severity: true,
            ownerUserId: true,
            reviews: {
              where: { tenantId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: reviewSelect,
            },
          },
        }),
      );
      const remediations = bounded(
        await tx.remediationAction.findMany({
          where: {
            tenantId,
            OR: [
              { aiRiskId: { in: risks.map((r) => r.id) } },
              { governanceFindingId: { in: findings.map((f) => f.id) } },
            ],
          },
          take,
          select: {
            id: true,
            aiRiskId: true,
            governanceFindingId: true,
            title: true,
            status: true,
            ownerUserId: true,
            dueDate: true,
            verifications: {
              where: { tenantId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                decision: true,
                verifierUserId: true,
                createdAt: true,
              },
            },
          },
        }),
      );
      const acceptances = bounded(
        await tx.riskAcceptance.findMany({
          where: { tenantId, aiRiskId: { in: risks.map((r) => r.id) } },
          take,
          select: {
            id: true,
            aiRiskId: true,
            status: true,
            expiresAt: true,
            decidedByUserId: true,
            decidedAt: true,
            residualRatingAtRequest: true,
          },
        }),
      );
      const monitoring = bounded(
        await tx.aiMonitoringCheck.findMany({
          where: systemWhere,
          take,
          select: {
            id: true,
            aiSystemId: true,
            title: true,
            active: true,
            cadence: true,
            ownerUserId: true,
            createdAt: true,
            reviews: {
              where: { tenantId },
              orderBy: { reviewedAt: "desc" },
              take: 1,
              select: {
                id: true,
                result: true,
                reviewerUserId: true,
                reviewedAt: true,
              },
            },
          },
        }),
      );
      const reassessments = bounded(
        await tx.aiReassessment.findMany({
          where: systemWhere,
          take,
          select: {
            id: true,
            aiSystemId: true,
            reason: true,
            status: true,
            targetDate: true,
            initiatedByUserId: true,
            conclusion: true,
            completedByUserId: true,
            completedAt: true,
          },
        }),
      );
      const retirements = bounded(
        await tx.aiSystemRetirement.findMany({
          where: systemWhere,
          take,
          select: {
            id: true,
            aiSystemId: true,
            status: true,
            reason: true,
            requesterUserId: true,
            requestedRetirementDate: true,
            reviews: {
              where: { tenantId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: reviewSelect,
            },
          },
        }),
      );
      const vendorLinks = bounded(
        await tx.aiSystemVendor.findMany({
          where: { ...systemWhere, vendor: { tenantId, deletedAt: null } },
          take,
          select: { id: true, aiSystemId: true, vendorId: true, role: true },
        }),
      );
      const evidenceAllowed =
        hasPermission(session, "evidence:read") ||
        hasPermission(session, "evidence:read-metadata");
      const evidenceLinks = evidenceAllowed
        ? bounded(
            await tx.aiSystemControlEvidence.findMany({
              where: {
                tenantId,
                aiSystemControlId: { in: controls.map((c) => c.id) },
                evidenceDocument: { tenantId, deletedAt: null },
              },
              take,
              select: {
                id: true,
                aiSystemControlId: true,
                evidenceDocumentId: true,
                status: true,
                reviews: {
                  where: { tenantId },
                  orderBy: { createdAt: "desc" },
                  take: 20,
                  select: reviewSelect,
                },
              },
            }),
          )
        : [];
      const incidentEvidence = evidenceAllowed
        ? bounded(
            await tx.aiIncidentEvidence.findMany({
              where: {
                tenantId,
                incidentId: { in: incidents.map((i) => i.id) },
                evidenceDocument: { tenantId, deletedAt: null },
              },
              take,
              select: { incidentId: true, evidenceDocumentId: true },
            }),
          )
        : [];
      const retirementEvidence = evidenceAllowed
        ? bounded(
            await tx.aiSystemRetirementEvidence.findMany({
              where: {
                tenantId,
                retirementId: { in: retirements.map((r) => r.id) },
                evidenceDocument: { tenantId, deletedAt: null },
              },
              take,
              select: { retirementId: true, evidenceDocumentId: true },
            }),
          )
        : [];
      const linkedDocumentIds = [
        ...evidenceLinks,
        ...incidentEvidence,
        ...retirementEvidence,
      ].map((l) => l.evidenceDocumentId);
      const evidence = evidenceAllowed
        ? bounded(
            await tx.evidenceDocument.findMany({
              where: {
                tenantId,
                deletedAt: null,
                OR: [
                  { aiSystemId: { in: ids } },
                  { id: { in: linkedDocumentIds } },
                ],
              },
              take,
              select: {
                id: true,
                aiSystemId: true,
                displayFilename: true,
                state: true,
                expirationDate: true,
              },
            }),
          )
        : [];
      return {
        generatedAt,
        systems,
        riskAssessments,
        impactAssessments,
        risks,
        impacts,
        useCases,
        frameworks,
        controls,
        tests,
        incidents,
        incidentLinks,
        findings,
        remediations,
        acceptances,
        monitoring,
        reassessments,
        retirements,
        vendorLinks,
        evidence,
        evidenceLinks,
        incidentEvidence,
        retirementEvidence,
        evidenceAllowed,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: 5000,
      timeout: 15000,
    },
  );
}
export type ReportData = Awaited<ReturnType<typeof loadReportData>>;
export type ReportFilter = { aiSystemId?: string; lifecycleScope: ReportScope };
