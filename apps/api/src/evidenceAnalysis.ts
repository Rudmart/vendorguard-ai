import { prisma } from "@vendorguard/database";
import { analyzeEvidence } from "@vendorguard/ai-client";

export interface RunEvidenceAnalysisParams {
  tenantId: string;
  assessmentId: string;
  evidenceDocumentId: string;
}

export async function runEvidenceAnalysis(params: RunEvidenceAnalysisParams) {
  const { tenantId, assessmentId, evidenceDocumentId } = params;

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
    where: { expectedEvidenceTypes: { has: document.documentType } },
  });

  const evidenceText =
    document.chunks.length > 0
      ? document.chunks.map((c) => c.text).join("\n\n")
      : `[No extracted text available for ${document.displayFilename}. Document type: ${document.documentType}.]`;

  const analysis = await analyzeEvidence({
    documentType: document.documentType,
    evidenceText,
    candidateControls: candidateControls.map((c) => ({
      id: c.id,
      controlId: c.controlId,
      title: c.title,
      summary: c.summary,
    })),
  });

  const controlByControlId = new Map(candidateControls.map((c) => [c.controlId, c]));
  const findings = [];
  const firstChunk = document.chunks[0];

  for (const relevantControlId of analysis.relevantControlIds) {
    const control = controlByControlId.get(relevantControlId);
    if (!control) continue;

    const existing = await prisma.controlFinding.findFirst({
      where: { tenantId, assessmentId, controlId: control.id },
    });

    const findingData = {
      status: "INSUFFICIENT_EVIDENCE" as const,
      confidence: analysis.confidence,
      gaps: analysis.gaps,
      recommendations: analysis.recommendations,
      requiresHumanReview: true,
    };

    const finding = existing
      ? await prisma.controlFinding.update({
          where: { id: existing.id },
          data: findingData,
        })
      : await prisma.controlFinding.create({
          data: {
            tenantId,
            vendorId: assessment.vendorId,
            assessmentId,
            controlId: control.id,
            ...findingData,
          },
        });

    if (firstChunk) {
      await prisma.findingEvidence.create({
        data: {
          tenantId,
          findingId: finding.id,
          evidenceDocumentId: document.id,
          page: firstChunk.page,
          section: firstChunk.section,
          chunkId: firstChunk.id,
          excerpt: firstChunk.text.slice(0, 280),
          contentHash: firstChunk.contentHash,
        },
      });
    }

    findings.push(finding);
  }

  return { analysis, findings };
}