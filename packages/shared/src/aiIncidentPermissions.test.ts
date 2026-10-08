import { describe, it, expect } from "vitest";
import { ROLES, roleHasPermission } from "./domain.js";
describe("AI Incident permissions", () => {
  it("closure review is ADMIN and REVIEWER only", () =>
    expect(
      ROLES.filter((r) => roleHasPermission(r, "ai-incident:review")),
    ).toEqual(["ADMIN", "REVIEWER"]));
  it("incident updates reuse ADMIN and ANALYST permissions", () =>
    expect(
      ROLES.filter((r) => roleHasPermission(r, "ai-system:update")),
    ).toEqual(["ADMIN", "ANALYST"]));
  it("incident access does not grant evidence content access", () => {
    for (const r of ["REVIEWER", "AUDITOR", "READ_ONLY"] as const) {
      expect(roleHasPermission(r, "ai-system:read")).toBe(true);
      expect(roleHasPermission(r, "evidence:read")).toBe(false);
    }
  });
});
