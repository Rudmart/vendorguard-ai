import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolveMcpContext } from "./context.js";
import { requestContextSchema } from "@vendorguard/auth";
import { prisma } from "@vendorguard/database";

let tenantId: string;
let userId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({ data: { name: "MCP Test Tenant" } });
  const user = await prisma.user.create({
    data: {
      externalId: `mcp-test-${Date.now()}`,
      email: `mcp-test-${Date.now()}@example.com`,
      displayName: "MCP Test User",
    },
  });
  await prisma.tenantMembership.create({
    data: { userId: user.id, tenantId: tenant.id, role: "ADMIN" },
  });
  tenantId = tenant.id;
  userId = user.id;
});

afterAll(async () => {
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
});
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
    const tamperedSession = JSON.stringify({
      userId,
      tenantId,
      email: "attacker-controlled@example.com",
      displayName: "Tampered Session",
      role: "READ_ONLY_EXECUTIVE",
    });
    const context = await resolveMcpContext(tamperedSession);
    expect(context.role).toBe("ADMIN");
  });

  it("assigns a fresh, unique correlation ID to every single request, even for the same user", async () => {
    const validSession = JSON.stringify({
      userId,
      tenantId,
      email: "test@vendorguard.dev",
      displayName: "Test",
      role: "ADMIN",
    });
    const first = await resolveMcpContext(validSession);
    const second = await resolveMcpContext(validSession);
    expect(first.correlationId).not.toBe(second.correlationId);
  });

  it("fails closed if the final context does not pass schema validation, rather than silently accepting bad data", () => {
    expect(() =>
      requestContextSchema.parse({
        userId: "not-a-valid-uuid",
        tenantId,
        role: "NOT_A_REAL_ROLE",
        correlationId: "abc",
      }),
    ).toThrow();
  });
});
