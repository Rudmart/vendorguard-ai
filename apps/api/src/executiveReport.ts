/**
 * apps/api/src/executiveReport.ts
 *
 * Aggregates existing VendorGuard data into an Executive Report shape.
 * No new risk calculations - everything here reads directly from
 * RiskRating, ControlFinding, ReviewDecision, RemediationAction, and
 * EvidenceDocument, per M9's "reuse existing functionality" instruction.
 *
 * OPEN QUESTION FLAGGED FOR REVIEW: ControlFinding has no simple
 * open/closed field. This module currently treats PASS and NOT_APPLICABLE
 * as "closed" and FAIL / PARTIAL / INSUFFICIENT_EVIDENCE / CONFLICTING_EVIDENCE
 * as "open." Revisit this definition if that's not the right call.
 */

import { prisma } from "@vendorguard/database";
import { resolveApplicableRequirements } from "@vendorguard/framework-engine";

const OPEN_FINDING_STATUSES = new Set([
  "FAIL",
  "PARTIAL",
  "INSUFFICIENT_EVIDENCE",
  "CONFLICTING_EVIDENCE",
]);

function isFindingOpen(status: string): boolean {
  return OPEN_FINDING_STATUSES.has(status);
}

export async function buildExecutiveReport(tenantId: string, vendorId: string) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId },
  });
  if (!vendor) {
    return null;
  }

  const latestAssessment = await prisma.assessment.findFirst({
    where: { vendorId, tenantId },
    orderBy: { createdAt: "desc" },
  });

  const recentRiskRatings = await prisma.riskRating.findMany({
    where: { tenantId, assessment: { vendorId } },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  const currentRiskRating = recentRiskRatings[0] ?? null;
  const previousRiskRating = recentRiskRatings[1] ?? null;

  const findings = latestAssessment
    ? await prisma.controlFinding.findMany({
        where: { tenantId, assessmentId: latestAssessment.id },
        include: {
          control: true,
          reviewDecisions: true,
          remediations: true,
        },
      })
    : [];

  const findingsByControlId = new Map(findings.map((f) => [f.controlId, f]));

  const openFindings = findings.filter((f) => isFindingOpen(f.status));
  const closedFindings = findings.filter((f) => !isFindingOpen(f.status));

  const highCriticalOpenFindings = openFindings.filter(
    (f) => f.control.severity === "HIGH" || f.control.severity === "CRITICAL"
  );

  const reviewedOpenCount = openFindings.filter((f) => f.reviewDecisions.length > 0).length;

  const remediations = await prisma.remediationAction.findMany({
    where: { tenantId, vendorId },
    include: { finding: { include: { control: true } } },
  });

  const now = new Date();
  const isOverdue = (r: (typeof remediations)[number]) =>
    r.status === "OVERDUE" || (!!r.dueDate && r.dueDate < now && r.status !== "CLOSED");

  const remediationCounts = {
    open: remediations.filter((r) => r.status === "OPEN").length,
    inProgress: remediations.filter((r) => r.status === "IN_PROGRESS").length,
    overdue: remediations.filter(isOverdue).length,
    closed: remediations.filter((r) => r.status === "CLOSED").length,
    total: remediations.length,
  };

  const overdueItems = remediations.filter(isOverdue).map((r) => ({
    id: r.id,
    title: r.title,
    dueDate: r.dueDate,
    ownerUserId: r.ownerUserId,
    linkedFindingControlId: r.finding?.control.controlId ?? null,
    linkedFindingSeverity: r.finding?.control.severity ?? null,
  }));

  // Framework / control coverage - reuses the same resolveApplicableRequirements
  // logic as the existing /assessments/:id/framework-mapping route (M6).
  let frameworkCoverage: { framework: string; applicable: number; assessed: number; coveragePercent: number }[] = [];
  if (latestAssessment) {
    const allControls = await prisma.control.findMany({
      include: { frameworkVersion: { include: { framework: true } } },
    });
    const applicabilityControls = allControls.map((c) => ({
      id: c.id,
      controlId: c.controlId,
      title: c.title,
      frameworkCatalogId: c.frameworkVersion.framework.catalogId,
    }));
    const vendorProfile = {
      serviceCategory: vendor.serviceCategory ?? undefined,
      category: vendor.category ?? undefined,
      dataClassifications: vendor.dataClassifications ?? [],
      aiFunctionality: vendor.aiFunctionality,
      aiProductType: (vendor.aiProductType ?? "NONE") as
        | "GENERATIVE"
        | "PREDICTIVE"
        | "ML"
        | "AGENT"
        | "NONE",
      servesGovernmentCustomers: vendor.servesGovernmentCustomers ?? false,
      processingLocations: vendor.processingLocations ?? [],
      processesSwiftMessaging: vendor.processesSwiftMessaging ?? false,
      affectsFinancialReporting: vendor.affectsFinancialReporting ?? false,
      processesMedicareMedicaidClaims: vendor.processesMedicareMedicaidClaims ?? false,
    };

    const applicableRequirements = resolveApplicableRequirements(vendorProfile, applicabilityControls)
      .filter((req) => req.applicable);

    const byFramework = new Map<string, { applicable: number; assessed: number }>();
    for (const req of applicableRequirements) {
      const entry = byFramework.get(req.framework.name) ?? { applicable: 0, assessed: 0 };
      entry.applicable += 1;
      if (findingsByControlId.has(req.control.id)) {
        entry.assessed += 1;
      }
      byFramework.set(req.framework.name, entry);
    }

    frameworkCoverage = Array.from(byFramework.entries()).map(([framework, counts]) => ({
      framework,
      applicable: counts.applicable,
      assessed: counts.assessed,
      coveragePercent: counts.applicable > 0 ? Math.round((counts.assessed / counts.applicable) * 100) : 0,
    }));
  }

  const evidenceDocuments = await prisma.evidenceDocument.findMany({
    where: { vendorId, tenantId, deletedAt: null },
  });
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const soonCutoff = new Date(now.getTime() + THIRTY_DAYS_MS);
  const evidenceStatus = {
    total: evidenceDocuments.length,
    current: evidenceDocuments.filter((d) => !d.expirationDate || d.expirationDate > soonCutoff).length,
    expiringSoon: evidenceDocuments.filter(
      (d) => d.expirationDate && d.expirationDate > now && d.expirationDate <= soonCutoff
    ).length,
    expired: evidenceDocuments.filter((d) => d.expirationDate && d.expirationDate <= now).length,
  };

  return {
    vendor: {
      id: vendor.id,
      legalName: vendor.legalName,
      tradingName: vendor.tradingName,
    },
    assessment: latestAssessment
      ? { id: latestAssessment.id, status: latestAssessment.status, createdAt: latestAssessment.createdAt }
      : null,
    riskRating: currentRiskRating
      ? {
          inherentScore: currentRiskRating.inherentScore,
          controlEffectiveness: currentRiskRating.controlEffectiveness,
          residualScore: currentRiskRating.residualScore,
          finalRating: currentRiskRating.finalRating,
        }
      : null,
    previousRiskRating: previousRiskRating
      ? {
          inherentScore: previousRiskRating.inherentScore,
          controlEffectiveness: previousRiskRating.controlEffectiveness,
          residualScore: previousRiskRating.residualScore,
          finalRating: previousRiskRating.finalRating,
        }
      : null,
    findings: {
      total: findings.length,
      openCount: openFindings.length,
      closedCount: closedFindings.length,
      reviewedOpenCount,
      highCriticalOpen: highCriticalOpenFindings.map((f) => ({
        id: f.id,
        controlId: f.control.controlId,
        controlTitle: f.control.title,
        severity: f.control.severity,
        impactType: f.control.impactType,
        status: f.status,
        reviewed: f.reviewDecisions.length > 0,
        gaps: f.gaps,
        recommendations: f.recommendations,
      })),
    },
    remediation: {
      counts: remediationCounts,
      overdueItems,
    },
    frameworkCoverage,
    evidenceStatus,
  };
}