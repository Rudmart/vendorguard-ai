import { z } from "zod";

export const evidenceAnalysisResultSchema = z.object({
  relevantControlIds: z.array(z.string()),
  gaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  expirationDate: z.string().nullable(),
  summary: z.string(),
});

export type EvidenceAnalysisResult = z.infer<typeof evidenceAnalysisResultSchema>;

export interface ControlForAnalysis {
  id: string;
  controlId: string;
  title: string;
  summary: string;
}

export interface AnalyzeEvidenceInput {
  documentType: string;
  evidenceText: string;
  candidateControls: ControlForAnalysis[];
}

function analyzeFake(input: AnalyzeEvidenceInput): EvidenceAnalysisResult {
  const firstTwoControls = input.candidateControls.slice(0, 2).map((c) => c.controlId);
  return {
    relevantControlIds: firstTwoControls,
    gaps: [
      "[FAKE MODE] Evidence does not explicitly state testing frequency.",
      "[FAKE MODE] No mention of who reviews exceptions.",
    ],
    recommendations: [
      "[FAKE MODE] Ask the vendor to clarify control testing cadence.",
      "[FAKE MODE] Request the most recent exception log, if any.",
    ],
    confidence: 0.42,
    expirationDate: null,
    summary: `[FAKE MODE] This is a placeholder analysis of a ${input.documentType} document. Replace AI_PROVIDER=fake with AI_PROVIDER=azure-ai to run a real analysis.`,
  };
}

async function analyzeAzureAi(_input: AnalyzeEvidenceInput): Promise<EvidenceAnalysisResult> {
  throw new Error("AI_PROVIDER=azure-ai is not yet implemented - see M8 Phase 1 follow-up");
}

export async function analyzeEvidence(input: AnalyzeEvidenceInput): Promise<EvidenceAnalysisResult> {
  const provider = process.env.AI_PROVIDER ?? "fake";
  if (provider === "azure-ai") {
    return analyzeAzureAi(input);
  }
  return analyzeFake(input);
}