import { describe, expect, it } from "vitest";
import { ROLES, roleHasPermission } from "./domain.js";

// D3a: the web app now reuses this exact catalog through "@vendorguard/shared/domain".
// These checks pin the role -> permission behaviour the UI relies on (backend uses the same function).
describe("D3a - shared permission catalog used by the frontend", () => {
  it("READ_ONLY can read AI systems but cannot mutate or decide anything", () => {
    expect(roleHasPermission("READ_ONLY", "ai-system:read")).toBe(true);
    for (const p of ["ai-system:create", "ai-system:update", "ai-risk-assessment:review", "ai-control-evidence:review", "ai-control-test:perform", "finding:review", "remediation:verify", "risk:accept", "ai-monitoring:review"]) {
      expect(roleHasPermission("READ_ONLY", p)).toBe(false);
    }
  });

  it("REVIEWER can review, test, verify and decide risk acceptance, but cannot update AI systems", () => {
    for (const p of ["ai-risk-assessment:review", "ai-impact-assessment:review", "ai-control-evidence:review", "ai-control-test:perform", "finding:review", "remediation:verify", "risk:accept", "ai-monitoring:review"]) {
      expect(roleHasPermission("REVIEWER", p)).toBe(true);
    }
    expect(roleHasPermission("REVIEWER", "ai-system:update")).toBe(false);
  });

  it("ANALYST can create and update governance work but not review, verify or accept", () => {
    expect(roleHasPermission("ANALYST", "ai-system:update")).toBe(true);
    expect(roleHasPermission("ANALYST", "remediation:create")).toBe(true);
    for (const p of ["ai-risk-assessment:review", "ai-control-evidence:review", "finding:review", "remediation:verify", "risk:accept"]) {
      expect(roleHasPermission("ANALYST", p)).toBe(false);
    }
  });

  it("AUDITOR gets only its explicit testing / Finding / verification grants", () => {
    expect(roleHasPermission("AUDITOR", "ai-control-test:perform")).toBe(true);
    expect(roleHasPermission("AUDITOR", "ai-finding:create")).toBe(true);
    expect(roleHasPermission("AUDITOR", "remediation:verify")).toBe(true);
    expect(roleHasPermission("AUDITOR", "ai-system:update")).toBe(false);
    expect(roleHasPermission("AUDITOR", "risk:accept")).toBe(false);
  });

  it("ADMIN wildcard grants cover AI governance mutations", () => {
    expect(roleHasPermission("ADMIN", "ai-system:update")).toBe(true);
    expect(roleHasPermission("ADMIN", "remediation:verify")).toBe(true);
  });

  it("exposes exactly the five roles", () => {
    expect([...ROLES]).toEqual(["ADMIN", "ANALYST", "REVIEWER", "AUDITOR", "READ_ONLY"]);
  });
});