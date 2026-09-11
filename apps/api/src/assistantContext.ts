/**
 * apps/api/src/assistantContext.ts
 *
 * Gathers real VendorGuard data for a vendor into the VendorGuardContext
 * shape the AI Assistant (packages/ai-client/src/assistant.ts) requires.
 * No new calculations here - reuses the same data sources as
 * executiveReport.ts (M9), reshaped for the Assistant's grounding context.
 */

import { prisma } from "@vendorguard/database";
import type { VendorGuardContext } from "@vendorguard/ai-client";

export async function buildAssistantContext(
  tenantId: string,
  vendorId: string
): Promise<VendorGuardContext> {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, tenantId },
  });

  const latestAssessment = await prisma.assessment.findFirst({
    where: { vendorId, tenantId },
    orderBy: { createdAt: "desc" },
  });

  const latestRiskRating = await prisma.riskRating.findFirst({
    where: { tenantId, assessment: { vendorId } },
    orderBy: { createdAt: "desc" },
  });

  const findings = latestAssessment
    ? await prisma.controlFinding.findMany({
        where: { tenantId, assessmentId: latestAssessment.id },
        include: { control: true },
      })
    : [];

  const evidenceDocuments = await prisma.evidenceDocument.findMany({
    where: { vendorId, tenantId, deletedAt: null },
    select: { id: true, documentType: true },
  });
  const documentIds = evidenceDocuments.map((d) => d.id);
  const documentTypeById = new Map(evidenceDocuments.map((d) => [d.id, d.documentType]));

  const evidenceChunks = documentIds.length
    ? await prisma.evidenceChunk.findMany({
        where: { tenantId, documentId: { in: documentIds } },
        take: 10,
        orderBy: { createdAt: "desc" },
      })
    : [];

  const frameworkCoverageRows: { framework: string; applicable: number; assessed: number }[] = [];

  return {
    vendor: vendor
      ? {
          legalName: vendor.legalName,
          serviceCategory: vendor.serviceCategory ?? null,
          criticality: vendor.businessCriticality !== null ? String(vendor.businessCriticality) : null,
        }
      : null,
    riskRating: latestRiskRating
      ? {
          inherentScore: latestRiskRating.inherentScore,
          controlEffectiveness: latestRiskRating.controlEffectiveness,
          residualScore: latestRiskRating.residualScore,
          finalRating: latestRiskRating.finalRating,
        }
      : null,
    findings: findings.map((f) => ({
      controlId: f.control.controlId,
      controlTitle: f.control.title,
      severity: f.control.severity,
      status: f.status,
      gaps: f.gaps,
    })),
    evidenceExcerpts: evidenceChunks.map((c) => ({
      documentType: documentTypeById.get(c.documentId) ?? "unknown",
      // NOTE: c.text originates from a third-party document and is UNTRUSTED
      // content - it is passed through to the Assistant's prompt inside the
      // clearly delimited <VENDORGUARD_DATA> block, which instructs the
      // model to treat it as data, never as instructions. See
      // packages/ai-client/src/assistant.ts buildSystemPrompt().
      excerpt: c.text.slice(0, 500),
    })),
    frameworkCoverage: frameworkCoverageRows,
  };
}