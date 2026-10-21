import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let tenantId: string | undefined;
let userId: string | undefined;
let systemId: string;
let cookie: string;
let requestNumber = 0;

async function request(method: "POST" | "PATCH", url: string, body: unknown) {
  return server.inject({
    method, url,
    cookies: { vg_session: cookie },
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
    remoteAddress: `10.191.0.${++requestNumber}`,
  });
}

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { name: "Section9 input regression" } })).id;
  const unique = randomUUID();
  userId = (await prisma.user.create({ data: {
    externalId: unique, email: `${unique}@section9.example.test`, displayName: "Section9 fixture",
  } })).id;
  await prisma.tenantMembership.create({ data: { tenantId, userId, role: "ADMIN" } });
  cookie = await issueTestSessionCookie({ tenantId, userId, role: "ADMIN", email: `${unique}@section9.example.test`, displayName: "Section9 fixture" });
  systemId = (await prisma.aiSystem.create({ data: { tenantId, name: "Unchanged system", origin: "INTERNAL" } })).id;
});

afterAll(async () => {
  if (tenantId) {
    await prisma.auditEvent.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  }
  if (userId) await prisma.user.delete({ where: { id: userId } });
});

describe("AI system malformed input remains a client error", () => {
  for (const method of ["POST", "PATCH"] as const) {
    it.each([null, [], "text", 42, true])(`${method} rejects non-object body %j`, async (body) => {
      const response = await request(method, method === "POST" ? "/ai-systems" : `/ai-systems/${systemId}`, body);
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toMatch(/TypeError|Prisma|stack|\.filter/);
    });
    it.each([
      { name: "   " }, { name: 42 }, { name: {} },
      { description: 42 }, { ownerUserId: {} },
      { dataCategories: "PERSONAL" }, { dataCategories: {} }, { dataCategories: [42] },
    ])(`${method} rejects malformed fields %j without writes`, async (fields) => {
      const before = await prisma.aiSystem.findUniqueOrThrow({ where: { id: systemId } });
      const count = await prisma.aiSystem.count({ where: { tenantId } });
      const response = await request(method, method === "POST" ? "/ai-systems" : `/ai-systems/${systemId}`, method === "POST" ? { name: "Valid name", origin: "INTERNAL", ...fields } : fields);
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toMatch(/TypeError|Prisma|stack|\.filter/);
      expect(await prisma.aiSystem.findUniqueOrThrow({ where: { id: systemId } })).toEqual(before);
      expect(await prisma.aiSystem.count({ where: { tenantId } })).toBe(count);
    });
  }
  it.each([
    { affectedPopulation: "CUSTOMERS" }, { affectedPopulation: null },
    { regulatoryRelevance: {} }, { regulatoryRelevance: null },
    { externalImpact: "true" }, { name: "" },
  ])("PATCH rejects malformed classification %j", async (body) => {
    const response = await request("PATCH", `/ai-systems/${systemId}`, body);
    expect(response.statusCode).toBe(400);
  });
  it.each([null, [], { vendorId: {} }, { vendorId: 42 }])("vendor link rejects malformed body %j", async (body) => {
    const response = await request("POST", `/ai-systems/${systemId}/vendors`, body);
    expect(response.statusCode).toBe(400);
  });
  it("accepts valid updates and preserves stored values through repeated reads", async () => {
    const body = { name: "Valid system", description: null, ownerUserId: userId, businessCriticality: "HIGH", impactLevel: "MODERATE", dataSensitivity: "CONFIDENTIAL", externalImpact: true };
    for (let i = 0; i < 2; i++) {
      expect((await request("PATCH", `/ai-systems/${systemId}`, body)).statusCode).toBe(200);
      const result = await server.inject({ method: "GET", url: `/ai-systems/${systemId}`, cookies: { vg_session: cookie } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject(body);
    }
  });
  it.each([{}, { name: "Missing origin" }, { origin: "INTERNAL" }])("rejects missing required registration fields %j", async (body) => {
    expect((await request("POST", "/ai-systems", body)).statusCode).toBe(400);
  });
  it("returns controlled not-found responses for nonexistent systems and links", async () => {
    const missing = randomUUID();
    const read = await server.inject({ method: "GET", url: `/ai-systems/${missing}`, cookies: { vg_session: cookie } });
    expect(read.statusCode).toBe(404);
    expect((await request("PATCH", `/ai-systems/${missing}`, { name: "Missing" })).statusCode).toBe(404);
    expect((await request("POST", `/ai-systems/${missing}/vendors`, { vendorId: missing })).statusCode).toBe(404);
  });
  it("preserves supported nullable classifications and owner clearing", async () => {
    const body = { ownerUserId: null, businessCriticality: null, impactLevel: null, dataSensitivity: null, externalImpact: null };
    expect((await request("PATCH", `/ai-systems/${systemId}`, body)).statusCode).toBe(200);
    const read = await server.inject({ method: "GET", url: `/ai-systems/${systemId}`, cookies: { vg_session: cookie } });
    expect(read.json()).toMatchObject(body);
  });
});
