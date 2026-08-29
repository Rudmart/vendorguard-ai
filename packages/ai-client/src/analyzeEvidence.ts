import { z } from "zod";
import { getAnthropicClient } from "./anthropicClient.js";

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

const SYSTEM_PROMPT = `You are an evidence review assistant for a Third-Party Risk Management platform.
You analyze vendor-submitted evidence documents (SOC 2 reports, ISO certificates, security assessments,
AI governance policies, penetration tests, model documentation, vendor questionnaires) and propose which
compliance controls the evidence supports, what gaps exist, and how confident you are.

Your output is ALWAYS advisory and ALWAYS subject to human review before it affects any risk score or
compliance status. You are not making a final determination - you are proposing a starting point for a
human reviewer.

Respond with ONLY a JSON object matching this exact shape, no other text:
{
  "relevantControlIds": string[],   // controlId values (not internal ids) this evidence appears to support
  "gaps": string[],                 // specific things the evidence does NOT demonstrate or leaves unclear
  "recommendations": string[],      // concrete next steps for a human reviewer
  "confidence": number,             // 0 to 1, your confidence in this analysis overall
  "expirationDate": string | null,  // ISO 8601 date if the document states an expiration/validity end date, else null
  "summary": string                 // 2-3 sentence plain-language summary of what this evidence shows
}`;

export async function analyzeEvidence(input: AnalyzeEvidenceInput): Promise<EvidenceAnalysisResult> {
  const client = getAnthropicClient();

  const controlsList = input.candidateControls
    .map((c) => `- ${c.controlId}: ${c.title} - ${c.summary}`)
    .join("\n");

  const userPrompt = `Document type: ${input.documentType}

Candidate controls to evaluate against:
${controlsList}

Evidence text:
"""
${input.evidenceText}
"""

Analyze this evidence and respond with the JSON object described in your instructions.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response contained no text block");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(textBlock.text);
  } catch (err) {
    throw new Error(`Failed to parse model output as JSON: ${(err as Error).message}`);
  }

  return evidenceAnalysisResultSchema.parse(parsedJson);
}