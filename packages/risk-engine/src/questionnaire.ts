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