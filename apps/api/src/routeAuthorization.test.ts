import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { ROLES, roleHasPermission, type Role } from "@vendorguard/shared";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

// Security PR 1: expected results are derived from the permission matrix, not hardcoded role names.
let tenantAId: string;
let tenantBId: string;
const users: Record<string, string> = {};
let tenantBUserId: string;
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.31." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookieFor(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test", role });
}
async function get(url: string, userId?: string, role?: string, tenantId?: string) {
  const res = await server.inject({
    method: "GET",
    url,
    cookies: userId && role ? { vg_session: cookieFor(userId, role, tenantId ?? tenantAId) } : {},
    remoteAddress: nextIp(),
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function remediationIn(tenantId: string, userId: string, label: string) {
  const sys = await prisma.aiSystem.create({ data: { tenantId, name: `SEC1 ${label}`, origin: "INTERNAL" as never, dataCategories: [], affectedPopulation: [], regulatoryRelevance: [], ownerUserId: userId } });
  const ra = await prisma.aiRiskAssessment.create({ data: { tenantId, aiSystemId: sys.id, name: "RA", version: 1 } });
  const risk = await prisma.aiRisk.create({
    data: { tenantId, assessmentId: ra.id, title: `Risk ${label}`, category: "OPERATIONAL" as never, statement: "x", likelihood: 2, impact: 2, inherentScore: 4, inherentRating: "LOW" as never },
  });
  return prisma.remediationAction.create({ data: { tenantId, aiRiskId: risk.id, title: `Remediation ${label}`, description: "x", status: "OPEN" as never } });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "SEC1 Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "SEC1 Tenant B" } })).id;
  for (const role of ROLES) {
    const u = await prisma.user.create({ data: { externalId: `sec1-${role}-${stamp}`, email: `sec1-${role}-${stamp}@example.com`, displayName: `SEC1 ${role}` } });
    await prisma.tenantMembership.create({ data: { userId: u.id, tenantId: tenantAId, role: role as never } });
    users[role] = u.id;
  }
  const b = await prisma.user.create({ data: { externalId: `sec1-b-${stamp}`, email: `sec1-b-${stamp}@example.com`, displayName: "SEC1 B" } });
  await prisma.tenantMembership.create({ data: { userId: b.id, tenantId: tenantBId, role: "ADMIN" as never } });
  tenantBUserId = b.id;
  await remediationIn(tenantAId, users.ADMIN ?? "", "A");
  await remediationIn(tenantBId, tenantBUserId, "B");
});

afterAll(async () => {
  const tenants = { in: [tenantAId, tenantBId] };
  await prisma.remediationAction.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRisk.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId: tenants } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: tenants } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenants } });
  for (const id of [...Object.values(users), tenantBUserId]) {
    await prisma.user.delete({ where: { id } });
  }
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("GET /remediations requires remediation:read", () => {
  it("allows exactly the roles holding remediation:read and denies the rest with 403", async () => {
    for (const role of ROLES) {
      const res = await get("/remediations", users[role], role);
      expect(res.status, role).toBe(roleHasPermission(role as Role, "remediation:read") ? 200 : 403);
    }
    expect(roleHasPermission("READ_ONLY", "remediation:read")).toBe(false);
  });

  it("returns 401 without a session and never returns another tenant's rows", async () => {
    expect((await get("/remediations")).status).toBe(401);
    const res = await get("/remediations", users.ADMIN, "ADMIN");
    const titles = (res.body.remediations as { title: string }[]).map((r) => r.title);
    expect(titles).toEqual(["Remediation A"]);
  });
});

describe("GET /ai-inventory requires ai-system:read", () => {
  it("follows the permission matrix, returns 401 without a session, and is tenant scoped", async () => {
    for (const role of ROLES) {
      const res = await get("/ai-inventory", users[role], role);
      expect(res.status, role).toBe(roleHasPermission(role as Role, "ai-system:read") ? 200 : 403);
    }
    expect((await get("/ai-inventory")).status).toBe(401);
    const res = await get("/ai-inventory", tenantBUserId, "ADMIN", tenantBId);
    expect(res.body.totalVendors).toBe(0);
  });
});