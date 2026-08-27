import { describe, expect, it } from "vitest";
import { calculateRequirementRisk } from "./requirementRisk.js";

const highContext = {
  businessCriticality: 90,
  dataSensitivity: 90,
  decisionAutonomyLevel: 90,
  geographicRegulatoryExposure: 90,
};

const lowContext = {
  businessCriticality: 10,
  dataSensitivity: 10,
  decisionAutonomyLevel: 10,
  geographicRegulatoryExposure: 10,
};

describe("calculateRequirementRisk", () => {
  it("returns applicable: false and a zero score for NOT_APPLICABLE status", () => {
    const result = calculateRequirementRisk("NOT_APPLICABLE", highContext);
    expect(result.applicable).toBe(false);
    expect(result.score).toBe(0);
    expect(result.band).toBeNull();
  });

  it("PASS always scores 0 regardless of context, since statusSeverity is 0", () => {
    const result = calculateRequirementRisk("PASS", highContext);
    expect(result.score).toBe(0);
  });

  it("the same FAIL status scores higher at a high-criticality vendor than a low-criticality one", () => {
    const high = calculateRequirementRisk("FAIL", highContext);
    const low = calculateRequirementRisk("FAIL", lowContext);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("FAIL at maximum context (all factors 100) scores the maximum possible 100", () => {
    const result = calculateRequirementRisk("FAIL", {
      businessCriticality: 100,
      dataSensitivity: 100,
      decisionAutonomyLevel: 100,
      geographicRegulatoryExposure: 100,
    });
    expect(result.score).toBe(100);
    expect(result.band).toBe("CRITICAL");
  });

  it("orders severity correctly: FAIL > CONFLICTING_EVIDENCE > INSUFFICIENT_EVIDENCE > PARTIAL > PASS, at the same context", () => {
    const fail = calculateRequirementRisk("FAIL", highContext).score;
    const conflicting = calculateRequirementRisk("CONFLICTING_EVIDENCE", highContext).score;
    const insufficient = calculateRequirementRisk("INSUFFICIENT_EVIDENCE", highContext).score;
    const partial = calculateRequirementRisk("PARTIAL", highContext).score;
    const pass = calculateRequirementRisk("PASS", highContext).score;
    expect(fail).toBeGreaterThan(conflicting);
    expect(conflicting).toBeGreaterThan(insufficient);
    expect(insufficient).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(pass);
  });

  it("uses a neutral 0.5 multiplier when no context factors are provided at all", () => {
    const result = calculateRequirementRisk("FAIL", {});
    expect(result.contextualMultiplier).toBe(0.5);
    expect(result.score).toBe(50);
  });

  it("averages only the context factors that are actually present, ignoring missing ones", () => {
    const result = calculateRequirementRisk("FAIL", { businessCriticality: 80 });
    expect(result.contextualMultiplier).toBe(0.8);
    expect(result.score).toBe(80);
  });

  it("clamps out-of-range context values into [0,100] before averaging", () => {
    const result = calculateRequirementRisk("FAIL", { businessCriticality: 150, dataSensitivity: -20 });
    expect(result.contextualMultiplier).toBe(0.65);
  });
});
