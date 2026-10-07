import { describe, expect, it } from "vitest";
import { ROLES, roleHasPermission } from "./domain.js";

// D3b pins the role -> permission behaviour the Third-Party AI Risk (AI TPRM) UI relies on.
// The web app reuses this exact catalog via "@vendorguard/shared/domain"; the API enforces the same catalog.
const EXPECTED: Record<string, string[]> = {
  "vendor:create": ["ADMIN", "ANALYST"],
  "vendor:update": ["ADMIN", "ANALYST"],
  "vendor:delete": ["ADMIN"],
  "assessment:create": ["ADMIN", "ANALYST"],
  "evidence:upload": ["ADMIN", "ANALYST"],
  "evidence:read": ["ADMIN", "ANALYST"],
  "evidence:read-metadata": ["ADMIN", "AUDITOR"],
  "finding:propose": ["ADMIN", "ANALYST"],
  "finding:review": ["ADMIN", "REVIEWER"],
  "questionnaire:review": ["ADMIN", "REVIEWER"],
  "remediation:read": ["ADMIN", "ANALYST", "REVIEWER", "AUDITOR"],
  "remediation:update": ["ADMIN", "REVIEWER"],
};

describe("D3b - AI TPRM permissions in the shared catalog", () => {
  for (const [permission, allowed] of Object.entries(EXPECTED)) {
    it(`${permission} -> ${allowed.join(", ")}`, () => {
      const actual = ROLES.filter((role) => roleHasPermission(role, permission));
      expect(actual).toEqual(allowed);
    });
  }

  it("evidence metadata is visible to ADMIN, ANALYST and AUDITOR; REVIEWER and READ_ONLY have no evidence access", () => {
    const metadata = ROLES.filter((role) => roleHasPermission(role, "evidence:read") || roleHasPermission(role, "evidence:read-metadata"));
    expect(metadata).toEqual(["ADMIN", "ANALYST", "AUDITOR"]);
  });
});