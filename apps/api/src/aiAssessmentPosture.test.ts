import { describe, expect, it } from "vitest";
import { deriveAssessmentPosture, type AssessmentVersionRow } from "./aiAssessmentPosture.js";

const row = (version: number, status: string): AssessmentVersionRow => ({
  id: `id-${status}-${version}`,
  version,
  status,
  completedAt: status === "COMPLETED" ? new Date("2026-09-01T00:00:00Z") : null,
});

describe("Phase D1 - derived assessment posture", () => {
  it("is NOT_ASSESSED with no assessments", () => {
    const p = deriveAssessmentPosture([], [], null);
    expect(p.state).toBe("NOT_ASSESSED");
    expect(p.latestRisk).toBeNull();
    expect(p.latestImpact).toBeNull();
  });

  it("is NOT_ASSESSED when only drafts exist, and reports the drafts", () => {
    const p = deriveAssessmentPosture([row(1, "DRAFT")], [row(1, "IN_PROGRESS")], null);
    expect(p.state).toBe("NOT_ASSESSED");
    expect(p.riskInProgress?.version).toBe(1);
    expect(p.impactInProgress?.version).toBe(1);
  });

  it("is ASSESSMENT_REQUIRED when only risk is completed", () => {
    const p = deriveAssessmentPosture([row(1, "COMPLETED")], [], null);
    expect(p.state).toBe("ASSESSMENT_REQUIRED");
    expect(p.latestRisk?.version).toBe(1);
  });

  it("is ASSESSMENT_REQUIRED when only impact is completed", () => {
    expect(deriveAssessmentPosture([], [row(1, "COMPLETED")], null).state).toBe("ASSESSMENT_REQUIRED");
  });

  it("is ASSESSED when both risk and impact have a completed version", () => {
    expect(deriveAssessmentPosture([row(1, "COMPLETED")], [row(1, "COMPLETED")], null).state).toBe("ASSESSED");
  });

  it("is ASSESSMENT_REQUIRED while a reassessment is in progress", () => {
    const p = deriveAssessmentPosture([row(1, "COMPLETED")], [row(1, "COMPLETED")], { id: "re-1" });
    expect(p.state).toBe("ASSESSMENT_REQUIRED");
    expect(p.reassessmentInProgress?.id).toBe("re-1");
  });

  it("a newer draft does not downgrade the latest assessed posture", () => {
    const p = deriveAssessmentPosture([row(1, "COMPLETED"), row(2, "DRAFT")], [row(1, "COMPLETED")], null);
    expect(p.state).toBe("ASSESSED");
    expect(p.latestRisk?.version).toBe(1);
    expect(p.riskInProgress?.version).toBe(2);
  });

  it("uses the highest completed version as latest assessed, regardless of input order", () => {
    const p = deriveAssessmentPosture([row(3, "READY_FOR_REVIEW"), row(1, "COMPLETED"), row(2, "COMPLETED")], [row(1, "COMPLETED")], null);
    expect(p.latestRisk?.version).toBe(2);
    expect(p.riskInProgress?.version).toBe(3);
  });

  it("reports no in-progress version when the latest version is completed", () => {
    const p = deriveAssessmentPosture([row(1, "COMPLETED"), row(2, "COMPLETED")], [row(1, "COMPLETED")], null);
    expect(p.riskInProgress).toBeNull();
  });
});