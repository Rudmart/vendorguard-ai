import { describe, expect, it } from "vitest";
import {
  calculateInherentRiskRating,
  calculateFullRiskRating,
  DEFAULT_RISK_RATING_WEIGHTS,
} from "./riskRating.js";

describe("DEFAULT_RISK_RATING_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const sum = Object.values(DEFAULT_RISK_RATING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 9);
  });

  it("has exactly 7 factors", () => {
    expect(Object.keys(DEFAULT_RISK_RATING_WEIGHTS)).toHaveLength(7);
  });
});

describe("calculateInherentRiskRating", () => {
  it("returns 0 when all factors are 0", () => {
    const result = calculateInherentRiskRating({
      businessCriticality: 0,
      dataSensitivity: 0,
      aiAutonomy: 0,
      regulatoryExposure: 0,
      securityPosture: 0,
      modelRisk: 0,
      vendorMaturity: 0,
    });
    expect(result.score).toBe(0);
    expect(result.missingInputs).toHaveLength(0);
  });

  it("returns 100 when all factors are 100", () => {
    const result = calculateInherentRiskRating({
      businessCriticality: 100,
      dataSensitivity: 100,
      aiAutonomy: 100,
      regulatoryExposure: 100,
      securityPosture: 100,
      modelRisk: 100,
      vendorMaturity: 100,
    });
    expect(result.score).toBe(100);
  });

  it("computes the documented weighted formula precisely", () => {
    const result = calculateInherentRiskRating({
      businessCriticality: 80,
      dataSensitivity: 60,
      aiAutonomy: 40,
      regulatoryExposure: 20,
      securityPosture: 50,
      modelRisk: 30,
      vendorMaturity: 10,
    });
    // 80*.20 + 60*.20 + 40*.15 + 20*.15 + 50*.15 + 30*.10 + 10*.05
    // = 16 + 12 + 6 + 3 + 7.5 + 3 + 0.5 = 48
    expect(result.score).toBe(48);
  });

  it("treats missing inputs as 0 and flags them", () => {
    const result = calculateInherentRiskRating({ businessCriticality: 100 });
    expect(result.missingInputs).toContain("dataSensitivity");
    expect(result.missingInputs).toContain("vendorMaturity");
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("accepts custom weights for future Administration configurability", () => {
    const customWeights = {
      businessCriticality: 0.5,
      dataSensitivity: 0.5,
      aiAutonomy: 0,
      regulatoryExposure: 0,
      securityPosture: 0,
      modelRisk: 0,
      vendorMaturity: 0,
    };
    const result = calculateInherentRiskRating(
      { businessCriticality: 100, dataSensitivity: 0 },
      customWeights,
    );
    expect(result.score).toBe(50);
    expect(result.weights).toEqual(customWeights);
  });

  it("throws if custom weights do not sum to 1.0", () => {
    const badWeights = {
      businessCriticality: 0.5,
      dataSensitivity: 0.5,
      aiAutonomy: 0.5,
      regulatoryExposure: 0,
      securityPosture: 0,
      modelRisk: 0,
      vendorMaturity: 0,
    };
    expect(() => calculateInherentRiskRating({}, badWeights)).toThrow();
  });

  it("rejects out-of-range factor values via schema validation", () => {
    expect(() => calculateInherentRiskRating({ businessCriticality: 150 })).toThrow();
    expect(() => calculateInherentRiskRating({ businessCriticality: -10 })).toThrow();
  });
});

describe("calculateFullRiskRating", () => {
  it("runs the full 4-stage pipeline: inherent -> control effectiveness -> residual -> final rating", () => {
    const result = calculateFullRiskRating(
      {
        businessCriticality: 100,
        dataSensitivity: 100,
        aiAutonomy: 100,
        regulatoryExposure: 100,
        securityPosture: 100,
        modelRisk: 100,
        vendorMaturity: 100,
      },
      0.5,
    );
    expect(result.inherent.score).toBe(100);
    expect(result.controlEffectiveness).toBe(0.5);
    expect(result.residualScore).toBe(50);
    expect(result.finalRating).toBe("HIGH");
  });

  it("produces LOW when inherent risk is 0 regardless of controls", () => {
    const result = calculateFullRiskRating(
      {
        businessCriticality: 0,
        dataSensitivity: 0,
        aiAutonomy: 0,
        regulatoryExposure: 0,
        securityPosture: 0,
        modelRisk: 0,
        vendorMaturity: 0,
      },
      0,
    );
    expect(result.residualScore).toBe(0);
    expect(result.finalRating).toBe("LOW");
  });

  it("produces CRITICAL when inherent risk is high and controls are ineffective", () => {
    const result = calculateFullRiskRating(
      {
        businessCriticality: 100,
        dataSensitivity: 100,
        aiAutonomy: 100,
        regulatoryExposure: 100,
        securityPosture: 100,
        modelRisk: 100,
        vendorMaturity: 100,
      },
      0,
    );
    expect(result.residualScore).toBe(100);
    expect(result.finalRating).toBe("CRITICAL");
  });

  it("fully mitigates risk when control effectiveness is 1.0", () => {
    const result = calculateFullRiskRating(
      {
        businessCriticality: 100,
        dataSensitivity: 100,
        aiAutonomy: 100,
        regulatoryExposure: 100,
        securityPosture: 100,
        modelRisk: 100,
        vendorMaturity: 100,
      },
      1,
    );
    expect(result.residualScore).toBe(0);
    expect(result.finalRating).toBe("LOW");
  });
});