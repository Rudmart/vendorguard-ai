import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let baseUrl: string;
let tenantAId: string;
let tenantBId: string;
let userAId: string;
let vendorAId: string;
let vendorBId: string;

function cookieHeaderFor(userId: string, tenantId: string, role: string) {
  const cookieValue = JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
  return `vg_session=${encodeURIComponent(cookieValue)}`;
}

async function waitForHealth(url: string, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // server not up yet, retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("MCP server did not become healthy in time");
}

beforeAll(async () => {
  await server.listen({ port: 0, host: "127.0.0.1" });
  const address = server.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  await waitForHealth(baseUrl);

  const tenantA = await prisma.tenant.create({ data: { name: "MCP Auth Regression Tenant A" } });
  tenantAId = tenantA.id;
  const tenantB = await prisma.tenant.create({ data: { name: "MCP Auth Regression Tenant B" } });
  tenantBId = tenantB.id;

  const userA = await prisma.user.create({
    data: { externalId: `mcp-auth-a-${Date.now()}`, email: `mcp-auth-a-${Date.now()}@example.com`, displayName: "Tenant A User" },
  });
  userAId = userA.id;
  await prisma.tenantMembership.create({ data: { userId: userAId, tenantId: tenantAId, role: "ADMIN" } });

  const vendorA = await prisma.vendor.create({
    data: { tenantId: tenantAId, legalName: "Tenant A Vendor", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorAId = vendorA.id;

  const vendorB = await prisma.vendor.create({
    data: { tenantId: tenantBId, legalName: "Tenant B Vendor", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorBId = vendorB.id;
});

afterAll(async () => {
  await prisma.vendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenantAId } });
  await prisma.user.delete({ where: { id: userAId } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
  await server.close();
});

describe("MCP server authorization regression (real client, real HTTP transport)", () => {
  it("rejects a tool call with no session cookie at all", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await expect(client.connect(transport)).rejects.toBeTruthy();
  });

  it("allows a user to fetch their own tenant's vendor through get_vendor", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Cookie: cookieHeaderFor(userAId, tenantAId, "ADMIN") } },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

    const result = await client.callTool({ name: "get_vendor", arguments: { vendorId: vendorAId } });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe(vendorAId);
    expect(parsed.legalName).toBe("Tenant A Vendor");

    await client.close();
  });

  it("blocks a user from fetching another tenant's vendor through get_vendor, even with a valid session for their own tenant", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Cookie: cookieHeaderFor(userAId, tenantAId, "ADMIN") } },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

    const result = await client.callTool({ name: "get_vendor", arguments: { vendorId: vendorBId } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/not found/i);

    await client.close();
  });

  it("denies a tool call for a name outside the allowlist, even if the server would otherwise recognize it", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Cookie: cookieHeaderFor(userAId, tenantAId, "ADMIN") } },
    });
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);

    const result = await client.callTool({ name: "delete_vendor", arguments: { vendorId: vendorAId } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/not permitted/i);

    await client.close();
  });
});