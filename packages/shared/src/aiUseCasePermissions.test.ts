import { describe, expect, it } from "vitest";
import { ROLES, roleHasPermission } from "./domain.js";

// AI Use Cases V1: the only permission-catalog addition is "ai-use-case:review" (ADMIN + REVIEWER).
// Create / update / submit reuse "ai-system:update"; read reuses "ai-system:read".
describe("AI Use Cases V1 - permission catalog", () => {
  it("ai-use-case:review is granted only to ADMIN and REVIEWER", () => {
    const holders = ROLES.filter((role) => roleHasPermission(role, "ai-use-case:review"));
    expect(holders).toEqual(["ADMIN", "REVIEWER"]);
  });

  it("ANALYST, AUDITOR and READ_ONLY cannot review use cases", () => {
    for (const role of ["ANALYST", "AUDITOR", "READ_ONLY"] as const) {
      expect(roleHasPermission(role, "ai-use-case:review")).toBe(false);
    }
  });

  it("create / edit / submit (ai-system:update) is ADMIN and ANALYST only", () => {
    expect(ROLES.filter((role) => roleHasPermission(role, "ai-system:update"))).toEqual(["ADMIN", "ANALYST"]);
  });

  it("every role can read use cases (ai-system:read)", () => {
    expect(ROLES.every((role) => roleHasPermission(role, "ai-system:read"))).toBe(true);
  });
});
