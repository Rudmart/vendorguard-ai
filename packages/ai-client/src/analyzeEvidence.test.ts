import { describe, it, expect } from "vitest";
import { analyzeEvidence } from "./analyzeEvidence.js";

describe("analyzeEvidence (fake mode)", () => {
  it("returns a fake analysis result matching the schema shape", async () => {
    const result = await analyzeEvidence({
      documentType: "SOC 2 report",
      evidenceText: "Sample evidence text for testing.",
      candidateControls: [
        { id: "1", controlId: "GV.SC-05", title: "Supplier requirements", summary: "Test summary" },
        { id: "2", controlId: "PR.AA-01", title: "Access control", summary: "Test summary" },
      ],
    });

    expect(result.relevantControlIds).toEqual(["GV.SC-05", "PR.AA-01"]);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.summary).toContain("FAKE MODE");
  });

  it("defaults to fake mode when AI_PROVIDER is unset", async () => {
    delete process.env.AI_PROVIDER;
    const result = await analyzeEvidence({
      documentType: "ISO certificate",
      evidenceText: "Another sample.",
      candidateControls: [],
    });
    expect(result.summary).toContain("FAKE MODE");
  });
});