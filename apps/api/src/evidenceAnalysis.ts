import { prisma, controlVisibility } from "@vendorguard/database";
import { evidenceAllowed } from "@vendorguard/auth";
import { roleHasPermission, type Role } from "@vendorguard/shared";
import { proposeLegacyFinding } from "./legacyFindingGovernance.js";
import { analyzeEvidence } from "@vendorguard/ai-client";

export interface RunEvidenceAnalysisParams {
  actor: { userId: string; role: Role };
  tenantId: string;
  assessmentId: string;
  evidenceDocumentId: string;
}

export async function runEvidenceAnalysis(params: RunEvidenceAnalysisParams) {
  const { tenantId, assessmentId, evidenceDocumentId, actor } = params;
  if (!evidenceAllowed(actor.role, "analysis") || !roleHasPermission(actor.role, "finding:propose")) throw new Error("Not authorized to analyze evidence");

  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, tenantId },
  });
  if (!assessment) {
    throw new Error("Assessment not found");
  }

  const document = await prisma.evidenceDocument.findFirst({
    where: { id: evidenceDocumentId, tenantId },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
  });
  if (!document) {
    throw new Error("Evidence document not found");
  }

  const candidateControls = await prisma.control.findMany({
    where: { ...controlVisibility(tenantId), expectedEvidenceTypes: { has: document.documentType } },
  });

  const evidenceText =
    document.chunks.length > 0
      ? document.chunks.map((c: (typeof document.chunks)[number]) => c.text).join("\n\n")
      : `[No extracted text available for ${document.displayFilename}. Document type: ${document.documentType}.]`;

  const analysis = await analyzeEvidence({
    documentType: document.documentType,
    evidenceText,
    candidateControls: candidateControls.map((c: (typeof candidateControls)[number]) => ({
      id: c.id,
      controlId: c.controlId,
      title: c.title,
      summary: c.summary,
    })),
  });

  const controlByControlId = new Map<string, (typeof candidateControls)[number]>(candidateControls.map((c: (typeof candidateControls)[number]) => [c.controlId, c]));
  const findings = [];
  const firstChunk = document.chunks[0];

  for (const relevantControlId of analysis.relevantControlIds) {
    const control = controlByControlId.get(relevantControlId);
    if (!control) continue;

    const existing = await prisma.controlFinding.findFirst({
      where: { tenantId, assessmentId, controlId: control.id },
    });

    if (existing && (existing.proposedByUserId !== actor.userId || !existing.requiresHumanReview || await prisma.reviewDecision.count({ where: { findingId: existing.id } }))) continue;
    const finding = await proposeLegacyFinding({ ...actor, tenantId, email: "", displayName: "" }, assessmentId, control.id, "INSUFFICIENT_EVIDENCE", undefined, { confidence: analysis.confidence, gaps: analysis.gaps, recommendations: analysis.recommendations, ...(firstChunk ? { evidence: { tenantId, evidenceDocumentId: document.id, page: firstChunk.page, section: firstChunk.section, chunkId: firstChunk.id, excerpt: firstChunk.text.slice(0, 280), contentHash: firstChunk.contentHash } } : {}) });

    findings.push(finding);
  }

  return { analysis, findings };
}