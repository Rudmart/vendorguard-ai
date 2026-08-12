import { describe, expect, it } from "vitest";
import type { RequestContext } from "./tenant-context.js";
import {
  requirePermission,
  requireRole,
  requireRiskAcceptanceAuthority,
  requireFindingReviewAuthority,
  AuthorizationError,
} from "./rbac.js";
import { ROLES, type Role } from "@vendorguard/shared";

function ctxWithRole(role: Role): RequestContext {
  return { userId: "u1", tenantId: "t1", role, correlationId: "c1" };
}

describe("requirePermission", () => {
  it("allows ADMIN to manage frameworks", () => {
    expect(() => requirePermission(ctxWithRole("ADMIN"), "framework:manage")).not.toThrow();
  });

  it("denies READ_ONLY from uploading evidence", () => {
    expect(() => requirePermission(ctxWithRole("READ_ONLY"), "evidence:upload")).toThrow(AuthorizationError);
  });

  it("denies AUDITOR from creating vendors (read-only role)", () => {
    expect(() => requirePermission(ctxWithRole("AUDITOR"), "vendor:create")).toThrow(AuthorizationError);
  });

  it("allows ANALYST to create vendors and upload evidence", () => {
    expect(() => requirePermission(ctxWithRole("ANALYST"), "vendor:create")).not.toThrow();
    expect(() => requirePermission(ctxWithRole("ANALYST"), "evidence:upload")).not.toThrow();
  });

  it("denies ANALYST from reviewing findings (proposer cannot also be reviewer)", () => {
    expect(() => requirePermission(ctxWithRole("ANALYST"), "finding:review")).toThrow(AuthorizationError);
  });
});

describe("requireRole", () => {
  it("passes when the role is in the allowed list", () => {
    expect(() => requireRole(ctxWithRole("REVIEWER"), ["ADMIN", "REVIEWER"])).not.toThrow();
  });

  it("throws when the role is not in the allowed list", () => {
    expect(() => requireRole(ctxWithRole("ANALYST"), ["ADMIN", "REVIEWER"])).toThrow(AuthorizationError);
  });
});

describe("requireRiskAcceptanceAuthority — spec §6: risk acceptance requires REVIEWER or ADMIN", () => {
  it("allows REVIEWER", () => {
    expect(() => requireRiskAcceptanceAuthority(ctxWithRole("REVIEWER"))).not.toThrow();
  });

  it("allows ADMIN", () => {
    expect(() => requireRiskAcceptanceAuthority(ctxWithRole("ADMIN"))).not.toThrow();
  });

  it.each(["ANALYST", "AUDITOR", "READ_ONLY"] as const)("denies %s", (role) => {
    expect(() => requireRiskAcceptanceAuthority(ctxWithRole(role))).toThrow(AuthorizationError);
  });

  it("covers every role exactly once with a deterministic allow/deny outcome", () => {
    const allowed = ROLES.filter((r) => {
      try {
        requireRiskAcceptanceAuthority(ctxWithRole(r));
        return true;
      } catch {
        return false;
      }
    });
    expect(allowed.sort()).toEqual(["ADMIN", "REVIEWER"].sort());
  });
});

describe("requireFindingReviewAuthority", () => {
  it("allows REVIEWER and ADMIN", () => {
    expect(() => requireFindingReviewAuthority(ctxWithRole("REVIEWER"))).not.toThrow();
    expect(() => requireFindingReviewAuthority(ctxWithRole("ADMIN"))).not.toThrow();
  });

  it("denies ANALYST, AUDITOR, and READ_ONLY", () => {
    expect(() => requireFindingReviewAuthority(ctxWithRole("ANALYST"))).toThrow(AuthorizationError);
    expect(() => requireFindingReviewAuthority(ctxWithRole("AUDITOR"))).toThrow(AuthorizationError);
    expect(() => requireFindingReviewAuthority(ctxWithRole("READ_ONLY"))).toThrow(AuthorizationError);
  });
});

describe("AuthorizationError shape", () => {
  it("carries the required permission for observability/logging", () => {
    try {
      requirePermission(ctxWithRole("READ_ONLY"), "evidence:upload");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).requiredPermission).toBe("evidence:upload");
    }
  });
});
