import { describe, expect, it } from "vitest";
import { mapQuestionnaireToRiskFactors, QUESTIONNAIRE_QUESTIONS } from "./questionnaire.js";

describe("QUESTIONNAIRE_QUESTIONS", () => {
  it("defines exactly 14 questions, one per category", () => {
    expect(QUESTIONNAIRE_QUESTIONS).toHaveLength(14);
    const categories = new Set(QUESTIONNAIRE_QUESTIONS.map((q) => q.category));
    expect(categories.size).toBe(14);
  });

  it("gives every question a unique key", () => {
    const keys = QUESTIONNAIRE_QUESTIONS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("mapQuestionnaireToRiskFactors", () => {
  it("returns all-undefined factors when no answers are provided", () => {
    const { aiRiskFactors, aiImpactFactors } = mapQuestionnaireToRiskFactors({});
    expect(aiRiskFactors.modelRisk).toBeUndefined();
    expect(aiRiskFactors.dataRisk).toBeUndefined();
    expect(aiImpactFactors.decisionAutonomyLevel).toBeUndefined();
  });

  it("maps usesGenerativeAI: true to a high modelRisk value", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      usesGenerativeAI: { value: true },
    });
    expect(aiRiskFactors.modelRisk).toBe(70);
  });

  it("maps usesGenerativeAI: false to a low modelRisk value", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      usesGenerativeAI: { value: false },
    });
    expect(aiRiskFactors.modelRisk).toBe(20);
  });

  it("maps hasGovernancePolicies: false to a high governanceRisk value (inverted)", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      hasGovernancePolicies: { value: false },
    });
    expect(aiRiskFactors.governanceRisk).toBe(80);
  });

  it("maps humanOversightLevel through the level map", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      humanOversightLevel: { value: "none" },
    });
    expect(aiRiskFactors.humanOversightRisk).toBe(90);
  });

  it("maps decisionAutonomyLevel through the level map into aiImpactFactors", () => {
    const { aiImpactFactors } = mapQuestionnaireToRiskFactors({
      decisionAutonomyLevel: { value: "full automation" },
    });
    expect(aiImpactFactors.decisionAutonomyLevel).toBe(90);
  });

  it("averages dataRisk from customerDataTraining and sensitiveDataCategories", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      customerDataTraining: { value: true },
      sensitiveDataCategories: { value: ["PII", "health"] },
    });
    // customerDataTraining true -> 70; 2 sensitive categories -> (2/4)*100 = 50; average = 60
    expect(aiRiskFactors.dataRisk).toBe(60);
  });

  it("treats sensitiveDataCategories: [\"none\"] as zero sensitive data", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      sensitiveDataCategories: { value: ["none"] },
    });
    expect(aiRiskFactors.dataRisk).toBe(0);
  });

  it("ignores malformed answer values instead of throwing", () => {
    const { aiRiskFactors } = mapQuestionnaireToRiskFactors({
      usesGenerativeAI: { value: "not-a-boolean" as unknown as boolean },
    });
    expect(aiRiskFactors.modelRisk).toBeUndefined();
  });
});