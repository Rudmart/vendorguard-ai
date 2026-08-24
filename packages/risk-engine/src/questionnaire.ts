/**
 * AI Vendor Risk Questionnaire - canonical question definitions.
 *
 * DESIGN PRINCIPLE: Question definitions are code-defined (not DB-configurable),
 * consistent with AI_RISK_FACTOR_WEIGHTS and AI_IMPACT_FACTOR_WEIGHTS in scoring.ts.
 * Each question's answer is stored as a QuestionnaireResponse (questionKey + answerJson).
 */

export type QuestionCategory =
  | "customerDataTraining"
  | "sensitiveData"
  | "generativeAI"
  | "automatedDecisionMaking"
  | "rag"
  | "aiAgents"
  | "externalApisTools"
  | "aiInventory"
  | "aiImpactAssessments"
  | "modelDocumentation"
  | "aiSecurityTesting"
  | "humanOversight"
  | "aiIncidentReporting"
  | "aiGovernancePolicies";

export type QuestionAnswerType = "boolean" | "scale" | "text" | "multiSelect";

export interface QuestionDefinition {
  key: string;
  category: QuestionCategory;
  prompt: string;
  answerType: QuestionAnswerType;
}

export const QUESTIONNAIRE_QUESTIONS: QuestionDefinition[] = [
  { key: "customerDataTraining", category: "customerDataTraining", answerType: "boolean",
    prompt: "Does this AI system train or fine-tune on customer data?" },
  { key: "sensitiveDataCategories", category: "sensitiveData", answerType: "multiSelect",
    prompt: "What categories of sensitive data does this system process (PII, financial, health, biometric, none)?" },
  { key: "usesGenerativeAI", category: "generativeAI", answerType: "boolean",
    prompt: "Does this system use generative AI (LLMs, image or audio generation)?" },
  { key: "decisionAutonomyLevel", category: "automatedDecisionMaking", answerType: "scale",
    prompt: "What level of automated decision-making does the system perform (none, advisory, partial automation, full automation)?" },
  { key: "usesRAG", category: "rag", answerType: "boolean",
    prompt: "Does this system use retrieval-augmented generation against your data?" },
  { key: "usesAIAgents", category: "aiAgents", answerType: "boolean",
    prompt: "Does this system use autonomous AI agents that can take actions?" },
  { key: "callsExternalApis", category: "externalApisTools", answerType: "boolean",
    prompt: "Does the AI call external APIs or tools autonomously?" },
  { key: "registeredInInventory", category: "aiInventory", answerType: "boolean",
    prompt: "Is this AI system registered in the vendor's AI inventory?" },
  { key: "vendorImpactAssessmentComplete", category: "aiImpactAssessments", answerType: "text",
    prompt: "Has the vendor completed their own AI impact assessment (yes, no, in progress)?" },
  { key: "modelDocumentationAvailable", category: "modelDocumentation", answerType: "boolean",
    prompt: "Is model documentation (model card, data sheet) available?" },
  { key: "securityTestingStatus", category: "aiSecurityTesting", answerType: "text",
    prompt: "Has the model undergone adversarial or security testing (yes, no, scheduled)?" },
  { key: "humanOversightLevel", category: "humanOversight", answerType: "scale",
    prompt: "What level of human oversight exists (none, spot-check, full review)?" },
  { key: "hasIncidentReportingProcess", category: "aiIncidentReporting", answerType: "boolean",
    prompt: "Does the vendor have an AI incident reporting process?" },
  { key: "hasGovernancePolicies", category: "aiGovernancePolicies", answerType: "boolean",
    prompt: "Does the vendor have documented AI governance policies?" },
];

// -----------------------------------------------------------------------
// Mapping questionnaire responses to AI risk / AI impact factor inputs
// -----------------------------------------------------------------------

export interface QuestionnaireAnswerValue {
  value: boolean | string | string[];
}

export type QuestionnaireAnswers = Record<string, QuestionnaireAnswerValue>;

function boolScore(answers: QuestionnaireAnswers, key: string, trueScore: number, falseScore: number): number | undefined {
  const answer = answers[key];
  if (!answer || typeof answer.value !== "boolean") return undefined;
  return answer.value ? trueScore : falseScore;
}

function levelScore(answers: QuestionnaireAnswers, key: string, levelMap: Record<string, number>): number | undefined {
  const answer = answers[key];
  if (!answer || typeof answer.value !== "string") return undefined;
  return levelMap[answer.value];
}

function multiSelectScore(answers: QuestionnaireAnswers, key: string): number | undefined {
  const answer = answers[key];
  if (!answer || !Array.isArray(answer.value)) return undefined;
  const values = answer.value.filter((v) => v !== "none");
  return Math.min(100, (values.length / 4) * 100);
}

function average(values: (number | undefined)[]): number | undefined {
  const present = values.filter((v): v is number => typeof v === "number");
  if (present.length === 0) return undefined;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

const HUMAN_OVERSIGHT_LEVELS: Record<string, number> = {
  "none": 90,
  "spot-check": 50,
  "full review": 10,
};

const DECISION_AUTONOMY_LEVELS: Record<string, number> = {
  "none": 10,
  "advisory": 30,
  "partial automation": 60,
  "full automation": 90,
};

/**
 * Maps AI Vendor Questionnaire answers to partial inputs for the AI risk
 * (M2) and AI impact (M3) scoring engines. Only questions with a provided
 * answer produce a value - unanswered questions leave that factor
 * undefined, which calculateAIInherentRisk/calculateAIImpactScore treat
 * as missing input (0, flagged), never silently assumed safe.
 */
export function mapQuestionnaireToRiskFactors(answers: QuestionnaireAnswers) {
  const dataRisk = average([
    boolScore(answers, "customerDataTraining", 70, 20),
    multiSelectScore(answers, "sensitiveDataCategories"),
  ]);

  const securityRisk = average([
    boolScore(answers, "callsExternalApis", 70, 20),
    boolScore(answers, "usesAIAgents", 70, 20),
  ]);

  const aiRiskFactors = {
    modelRisk: boolScore(answers, "usesGenerativeAI", 70, 20),
    dataRisk,
    securityRisk,
    regulatoryRisk: boolScore(answers, "hasIncidentReportingProcess", 20, 80),
    humanOversightRisk: levelScore(answers, "humanOversightLevel", HUMAN_OVERSIGHT_LEVELS),
    governanceRisk: boolScore(answers, "hasGovernancePolicies", 20, 80),
  };

  const aiImpactFactors = {
    decisionAutonomyLevel: levelScore(answers, "decisionAutonomyLevel", DECISION_AUTONOMY_LEVELS),
    sensitiveDataInvolved: multiSelectScore(answers, "sensitiveDataCategories"),
    regulatoryExposureLevel: boolScore(answers, "hasIncidentReportingProcess", 20, 80),
    explainabilityLevel: boolScore(answers, "modelDocumentationAvailable", 20, 80),
  };

  return { aiRiskFactors, aiImpactFactors };
}
