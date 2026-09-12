import { describe, it, expect } from "vitest";
import { resolveMcpContext } from "./context.js";

describe("resolveMcpContext (MCP authentication boundary)", () => {
  it("rejects a request with no session cookie at all", async () => {
    await expect(resolveMcpContext(undefined)).rejects.toThrow("UNAUTHENTICATED");
  });

  it("rejects a request with an unparseable/malformed cookie value", async () => {
    await expect(resolveMcpContext("not-valid-json")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("rejects a session whose user/tenant has no real TenantMembership row", async () => {
    const fakeSession = JSON.stringify({
      userId: "00000000-0000-0000-0000-000000000000",
      tenantId: "00000000-0000-0000-0000-000000000000",
      email: "nobody@example.com",
      displayName: "Nobody",
      role: "ADMIN",
    });
    await expect(resolveMcpContext(fakeSession)).rejects.toThrow("NO_MEMBERSHIP");
  });

  it("always uses the role from the real TenantMembership row, never a role claimed in the cookie itself", async () => {
    // Real user/tenant/membership from this dev database, confirmed to
    // actually be ADMIN. The cookie below lies and claims a different
    // role - if the resolved context ever trusted that claim, this test
    // would fail, proving the security-critical guarantee documented in
    // tenant-context.ts: "the role in the resulting context comes from
    // the membership row, never from the claims/session directly."
    const tamperedSession = JSON.stringify({
      userId: "c0393886-6a05-48b9-9a53-0ad738ffa0f1",
      tenantId: "11be37de-e687-459c-97b0-abc7304008c8",
      email: "attacker-controlled@example.com",
      displayName: "Tampered Session",
      role: "READ_ONLY_EXECUTIVE",
    });
    const context = await resolveMcpContext(tamperedSession);
    expect(context.role).toBe("ADMIN");
  });
});