import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let readOnlyUserId: string;
let colleagueUserId: string;
let tenantBUserId: string;

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

beforeAll(async () => {
  const tenantA = await prisma.tenant.create({ data: { name: "Governance Test Tenant A" } });
  tenantAId = tenantA.id;
  const tenantB = await prisma.tenant.create({ data: { name: "Governance Test Tenant B" } });
  tenantBId = tenantB.id;

  const admin = await prisma.user.create({
    data: { externalId: `gov-admin-${Date.now()}`, email: `gov-admin-${Date.now()}@example.com`, displayName: "Governance Admin" },
  });
  adminUserId = admin.id;
  await prisma.tenantMembership.create({ data: { userId: adminUserId, tenantId: tenantAId, role: "ADMIN" } });

  const readOnly = await prisma.user.create({
    data: { externalId: `gov-readonly-${Date.now()}`, email: `gov-readonly-${Date.now()}@example.com`, displayName: "Read Only" },
  });
  readOnlyUserId = readOnly.id;
  await prisma.tenantMembership.create({ data: { userId: readOnlyUserId, tenantId: tenantAId, role: "READ_ONLY" } });

  const colleague = await prisma.user.create({
    data: { externalId: `gov-colleague-${Date.now()}`, email: `gov-colleague-${Date.now()}@example.com`, displayName: "Colleague" },
  });
  colleagueUserId = colleague.id;
  await prisma.tenantMembership.create({ data: { userId: colleagueUserId, tenantId: tenantAId, role: "ANALYST" } });

  const tenantBUser = await prisma.user.create({
    data: { externalId: `gov-tenantb-${Date.now()}`, email: `gov-tenantb-${Date.now()}@example.com`, displayName: "Tenant B User" },
  });
  tenantBUserId = tenantBUser.id;
  await prisma.tenantMembership.create({ data: { userId: tenantBUserId, tenantId: tenantBId, role: "ADMIN" } });
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystemVendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.user.delete({ where: { id: readOnlyUserId } });
  await prisma.user.delete({ where: { id: colleagueUserId } });
  await prisma.user.delete({ where: { id: tenantBUserId } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

async function createSystem(ownerRole = "ADMIN", ownerUserId = adminUserId) {
  const res = await server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: cookieFor(ownerUserId, ownerRole, tenantAId) },
    payload: { name: "Governance Test System", origin: "INTERNAL" },
  });
  return JSON.parse(res.body).id as string;
}

describe("GET /tenant-users", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({ method: "GET", url: "/tenant-users" });
    expect(res.statusCode).toBe(401);
  });

  it("returns only users belonging to the caller's own tenant", async () => {
    const res = await server.inject({
      method: "GET", url: "/tenant-users",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const ids = body.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(adminUserId);
    expect(ids).toContain(colleagueUserId);
    expect(ids).not.toContain(tenantBUserId);
  });
});

describe("Ownership assignment", () => {
  it("allows an authorized user to assign an owner from the same tenant", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { ownerUserId: colleagueUserId },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ownerUserId).toBe(colleagueUserId);
  });

  it("returns the owner's displayName and email when the AI system is retrieved", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { ownerUserId: colleagueUserId },
    });
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    const body = JSON.parse(res.body);
    expect(body.owner.id).toBe(colleagueUserId);
    expect(body.owner.displayName).toBe("Colleague");
  });

  it("rejects assigning an owner who belongs to a different tenant", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { ownerUserId: tenantBUserId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects assigning a nonexistent owner", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { ownerUserId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an owner change from a user without ai-system:update permission", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
      payload: { ownerUserId: colleagueUserId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("generates an ai_system.owner_changed audit event with before/after values", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { ownerUserId: colleagueUserId },
    });
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.owner_changed", targetId: id } });
    expect(event).not.toBeNull();
    expect((event?.metadataJson as { newOwnerUserId?: string })?.newOwnerUserId).toBe(colleagueUserId);
  });
});

describe("Governance classification", () => {
  it("accepts a valid classification update and persists it", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: {
        businessCriticality: "HIGH",
        decisionRole: "RECOMMENDS",
        humanOversight: "REQUIRED",
        impactLevel: "MODERATE",
        dataSensitivity: "CONFIDENTIAL",
        affectedPopulation: ["EMPLOYEES", "CUSTOMERS"],
        externalImpact: true,
        regulatoryRelevance: ["EU_AI_ACT", "PRIVACY"],
        assessmentStatus: "ASSESSMENT_REQUIRED",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessCriticality).toBe("HIGH");
    expect(body.decisionRole).toBe("RECOMMENDS");
    expect(body.humanOversight).toBe("REQUIRED");
    expect(body.impactLevel).toBe("MODERATE");
    expect(body.dataSensitivity).toBe("CONFIDENTIAL");
    expect(body.affectedPopulation).toEqual(["EMPLOYEES", "CUSTOMERS"]);
    expect(body.externalImpact).toBe(true);
    expect(body.regulatoryRelevance).toEqual(["EU_AI_ACT", "PRIVACY"]);
    expect(body.assessmentStatus).toBe("ASSESSMENT_REQUIRED");
  });

  it("returns the classification on a later retrieval (persistence across requests)", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { businessCriticality: "CRITICAL", assessmentStatus: "ASSESSED" },
    });
    const res = await server.inject({
      method: "GET", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    const body = JSON.parse(res.body);
    expect(body.businessCriticality).toBe("CRITICAL");
    expect(body.assessmentStatus).toBe("ASSESSED");
  });

  it("does not change the existing riskTier when classification fields are updated", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { riskTier: "HIGH" },
    });
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { businessCriticality: "LOW" },
    });
    expect(JSON.parse(res.body).riskTier).toBe("HIGH");
  });

  it("rejects an invalid businessCriticality value", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { businessCriticality: "SUPER_HIGH" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid decisionRole value", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { decisionRole: "OVERRULES" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid affectedPopulation entry", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { affectedPopulation: ["ALIENS"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid regulatoryRelevance entry", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { regulatoryRelevance: ["MADE_UP_LAW"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid assessmentStatus value", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { assessmentStatus: "DONE" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces tenant isolation on classification updates (cross-tenant PATCH is not found)", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
      payload: { businessCriticality: "HIGH" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a classification update from a user without ai-system:update permission", async () => {
    const id = await createSystem();
    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
      payload: { businessCriticality: "HIGH" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("generates an ai_system.classification_changed audit event capturing changed fields", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { businessCriticality: "CRITICAL", impactLevel: "HIGH" },
    });
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.classification_changed", targetId: id } });
    expect(event).not.toBeNull();
    const metadata = event?.metadataJson as Record<string, { from: unknown; to: unknown }>;
    expect(metadata.businessCriticality?.to).toBe("CRITICAL");
    expect(metadata.impactLevel?.to).toBe("HIGH");
  });

  it("does not generate a classification_changed event when no classification field is included in the request", async () => {
    const id = await createSystem();
    await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { description: "just a description update" },
    });
    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.classification_changed", targetId: id } });
    expect(event).toBeNull();
  });
});