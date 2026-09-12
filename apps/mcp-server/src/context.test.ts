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
});