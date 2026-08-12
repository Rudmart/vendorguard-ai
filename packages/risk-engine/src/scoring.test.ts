import { describe, expect, it } from "vitest";
import { calculateInherentRisk, calculateResidualRisk, RISK_FACTOR_WEIGHTS } from "./scoring.js";

describe("calculateInherentRisk", () => {
  it("returns 0 / LOW when all factors are 0", () => {
    const result = calculateInherentRisk({
      dataSensitivity: 0,
      businessCriticality: 0,
      accessPrivilege: 0,
      operationalDependency: 0,
      fourthPartyConcentration: 0,
      geographicRegulatoryExposure: 0,
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe("LOW");
    expect(result.missingInputs).toHaveLength(0);
  });

  it("returns 100 / CRITICAL when all factors are 100", () => {
    const result = calculateInherentRisk({
      dataSensitivity: 100,
      businessCriticality: 100,
      accessPrivilege: 100,
      operationalDependency: 100,
      fourthPartyConcentration: 100,
      geographicRegulatoryExposure: 100,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe("CRITICAL");
  });

  it("computes the documented weighted formula precisely", () => {
    const result = calculateInherentRisk({
      dataSensitivity: 80,
      businessCriticality: 60,
      accessPrivilege: 40,
      operationalDependency: 20,
      fourthPartyConcentration: 50,
      geographicRegulatoryExposure: 30,
    });
    const expected =
      0.25 * 80 + 0.2 * 60 + 0.15 * 40 + 0.15 * 20 + 0.15 * 50 + 0.1 * 30;
    expect(result.score).toBeCloseTo(expected, 5);
  });

  it("treats missing factors as 0 and reports them as missing/assumed", () => {
    const result = calculateInherentRisk({ dataSensitivity: 100 });
    expect(result.missingInputs).toEqual(
      expect.arrayContaining([
        "businessCriticality",
        "accessPrivilege",
        "operationalDependency",
        "fourthPartyConcentration",
        "geographicRegulatoryExposure",
      ]),
    );
    expect(result.score).toBeCloseTo(25, 5); // only dataSensitivity weight * 100
    expect(result.assumptions.length).toBeGreaterThan(0);
  });

  it("rejects out-of-range factor inputs", () => {
    expect(() => calculateInherentRisk({ dataSensitivity: 150 })).toThrow();
    expect(() => calculateInherentRisk({ businessCriticality: -1 })).toThrow();
  });

  it.each([
    [24, "LOW"],
    [25, "MODERATE"],
    [49, "MODERATE"],
    [50, "HIGH"],
    [74, "HIGH"],
    [75, "CRITICAL"],
  ])("bands a composite score of %i as %s", (target, expectedBand) => {
    // Drive the whole score via dataSensitivity + businessCriticality only
    // is imprecise due to weights; instead use uniform inputs scaled so the
    // weighted sum equals `target` exactly (weights sum to 1).
    const result = calculateInherentRisk({
      dataSensitivity: target,
      businessCriticality: target,
      accessPrivilege: target,
      operationalDependency: target,
      fourthPartyConcentration: target,
      geographicRegulatoryExposure: target,
    });
    expect(result.score).toBe(target);
    expect(result.band).toBe(expectedBand);
  });

  it("reports every factor's individual contribution and the shared weights", () => {
    const result = calculateInherentRisk({ dataSensitivity: 40 });
    const dataSensitivityFactor = result.factors.find((f) => f.factor === "dataSensitivity");
    expect(dataSensitivityFactor?.contribution).toBeCloseTo(0.25 * 40, 5);
    expect(result.weights).toEqual(RISK_FACTOR_WEIGHTS);
  });
});

describe("calculateResidualRisk", () => {
  it("returns the full inherent score when controlEffectiveness is 0", () => {
    const result = calculateResidualRisk(80, 0);
    expect(result.score).toBe(80);
    expect(result.band).toBe("CRITICAL");
  });

  it("returns 0 when controlEffectiveness is 1 (fully effective controls)", () => {
    const result = calculateResidualRisk(80, 1);
    expect(result.score).toBe(0);
    expect(result.band).toBe("LOW");
  });

  it("computes a partial reduction correctly", () => {
    const result = calculateResidualRisk(80, 0.5);
    expect(result.score).toBe(40);
    expect(result.band).toBe("MODERATE");
  });

  it("clamps out-of-range controlEffectiveness and records an assumption", () => {
    const over = calculateResidualRisk(80, 1.5);
    expect(over.controlEffectiveness).toBe(1);
    expect(over.score).toBe(0);
    expect(over.assumptions.length).toBeGreaterThan(0);

    const under = calculateResidualRisk(80, -0.5);
    expect(under.controlEffectiveness).toBe(0);
    expect(under.score).toBe(80);
  });

  it("clamps inherent scores outside [0,100] defensively", () => {
    const result = calculateResidualRisk(150, 0.5);
    expect(result.inherentScore).toBe(100);
    expect(result.score).toBe(50);
  });
});
