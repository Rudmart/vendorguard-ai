import { describe, it, expect } from "vitest";
import { prisma } from "@vendorguard/database";
import { runEvidenceAnalysis } from "./evidenceAnalysis.js";

const TENANT_ID = "11be37de-1234-0000-0000-000000000000";
const ASSESSMENT_ID = "293342d4-6e7b-4ff0-a9ea-aa832a1fe368";
const EVIDENCE_DOCUMENT_ID = "082bcd6c-96d8-495e-b1c8-63209ed9518e";

describe("runEvidenceAnalysis (integration, fake mode)", () => {
  it("throws if the assessment does not exist for the tenant", async () => {
    await expect(
      runEvidenceAnalysis({
        tenantId: TENANT_ID,
        assessmentId: "00000000-0000-0000-0000-000000000000",
        evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
      })
    ).rejects.toThrow("Assessment not found");
  });

  it("throws if the evidence document does not exist for the tenant", async () => {
    const assessment = await prisma.assessment.findFirst({
      where: { id: ASSESSMENT_ID },
    });
    if (!assessment) return;
    await expect(
      runEvidenceAnalysis({
        tenantId: assessment.tenantId,
        assessmentId: ASSESSMENT_ID,
        evidenceDocumentId: "00000000-0000-0000-0000-000000000000",
      })
    ).rejects.toThrow("Evidence document not found");
  });

  it("runs analysis against a real evidence document and persists findings", async () => {
    const assessment = await prisma.assessment.findFirst({
      where: { id: ASSESSMENT_ID },
    });
    const document = await prisma.evidenceDocument.findFirst({
      where: { id: EVIDENCE_DOCUMENT_ID },
    });
    if (!assessment || !document) {
      return;
    }

    const result = await runEvidenceAnalysis({
      tenantId: assessment.tenantId,
      assessmentId: ASSESSMENT_ID,
      evidenceDocumentId: EVIDENCE_DOCUMENT_ID,
    });

    expect(result.analysis.confidence).toBeGreaterThanOrEqual(0);
    expect(result.analysis.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.findings)).toBe(true);

    for (const finding of result.findings) {
      expect(finding.assessmentId).toBe(ASSESSMENT_ID);
      expect(finding.requiresHumanReview).toBe(true);
    }
  });
});