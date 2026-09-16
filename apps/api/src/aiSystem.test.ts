import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";

let tenantAId: string;
let tenantBId: string;
let adminUserId: string;
let analystUserId: string;
let readOnlyUserId: string;
let tenantBUserId: string;
let vendorAId: string;
let vendorA2Id: string;
let vendorBId: string;

function cookieFor(userId: string, role: string, tenantId: string) {
  return JSON.stringify({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test User", role });
}

beforeAll(async () => {
  const tenantA = await prisma.tenant.create({ data: { name: "AiSystem Test Tenant A" } });
  tenantAId = tenantA.id;
  const tenantB = await prisma.tenant.create({ data: { name: "AiSystem Test Tenant B" } });
  tenantBId = tenantB.id;

  const admin = await prisma.user.create({
    data: { externalId: `ais-admin-${Date.now()}`, email: `ais-admin-${Date.now()}@example.com`, displayName: "Admin" },
  });
  adminUserId = admin.id;
  await prisma.tenantMembership.create({ data: { userId: adminUserId, tenantId: tenantAId, role: "ADMIN" } });

  const analyst = await prisma.user.create({
    data: { externalId: `ais-analyst-${Date.now()}`, email: `ais-analyst-${Date.now()}@example.com`, displayName: "Analyst" },
  });
  analystUserId = analyst.id;
  await prisma.tenantMembership.create({ data: { userId: analystUserId, tenantId: tenantAId, role: "ANALYST" } });

  const readOnly = await prisma.user.create({
    data: { externalId: `ais-readonly-${Date.now()}`, email: `ais-readonly-${Date.now()}@example.com`, displayName: "Read Only" },
  });
  readOnlyUserId = readOnly.id;
  await prisma.tenantMembership.create({ data: { userId: readOnlyUserId, tenantId: tenantAId, role: "READ_ONLY" } });

  const tenantBUser = await prisma.user.create({
    data: { externalId: `ais-tenantb-${Date.now()}`, email: `ais-tenantb-${Date.now()}@example.com`, displayName: "Tenant B User" },
  });
  tenantBUserId = tenantBUser.id;
  await prisma.tenantMembership.create({ data: { userId: tenantBUserId, tenantId: tenantBId, role: "ADMIN" } });

  const vendorA = await prisma.vendor.create({
    data: { tenantId: tenantAId, legalName: "AiSystem Test Vendor A", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorAId = vendorA.id;

  const vendorA2 = await prisma.vendor.create({
    data: { tenantId: tenantAId, legalName: "AiSystem Test Vendor A2", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorA2Id = vendorA2.id;

  const vendorB = await prisma.vendor.create({
    data: { tenantId: tenantBId, legalName: "AiSystem Test Vendor B", serviceCategory: "Cloud/SaaS", serviceDescription: "test", criticality: "MEDIUM" },
  });
  vendorBId = vendorB.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystemVendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.aiSystem.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.vendor.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.user.delete({ where: { id: adminUserId } });
  await prisma.user.delete({ where: { id: analystUserId } });
  await prisma.user.delete({ where: { id: readOnlyUserId } });
  await prisma.user.delete({ where: { id: tenantBUserId } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("POST /ai-systems", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({ method: "POST", url: "/ai-systems", payload: { name: "X", origin: "INTERNAL" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects READ_ONLY, which lacks ai-system:create", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(readOnlyUserId, "READ_ONLY", tenantAId) },
      payload: { name: "X", origin: "INTERNAL" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a missing name", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { origin: "INTERNAL" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid origin", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "X", origin: "NOT_REAL" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid category", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "X", origin: "INTERNAL", category: "NOT_REAL" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid dataCategories outside the controlled whitelist", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "X", origin: "INTERNAL", dataCategories: ["Personal Information"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid riskTier", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "X", origin: "INTERNAL", riskTier: "SUPER_HIGH" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an ownerUserId that has no membership in this tenant", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "X", origin: "INTERNAL", ownerUserId: tenantBUserId },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates an AI system as ADMIN and generates an ai_system.created audit event", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Loan Underwriting AI", origin: "INTERNAL", category: "DECISION_SUPPORT", ownerUserId: analystUserId, dataCategories: ["PII", "FINANCIAL"], riskTier: "HIGH" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Loan Underwriting AI");
    expect(body.lifecycleStatus).toBe("PROPOSED");

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.created", targetId: body.id } });
    expect(event).not.toBeNull();
  });

  it("creates an AI system as ANALYST", async () => {
    const res = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(analystUserId, "ANALYST", tenantAId) },
      payload: { name: "Chatbot", origin: "THIRD_PARTY" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("GET /ai-systems (tenant isolation)", () => {
  it("lists only the caller's own tenant AI systems, never another tenant's", async () => {
    const inTenantA = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Tenant A System", origin: "INTERNAL" },
    });
    const inTenantB = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
      payload: { name: "Tenant B System", origin: "INTERNAL" },
    });
    const tenantAId_created = JSON.parse(inTenantA.body).id;
    const tenantBId_created = JSON.parse(inTenantB.body).id;

    const list = await server.inject({
      method: "GET", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(list.statusCode).toBe(200);
    const ids = JSON.parse(list.body).aiSystems.map((s: { id: string }) => s.id);
    expect(ids).toContain(tenantAId_created);
    expect(ids).not.toContain(tenantBId_created);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await server.inject({ method: "GET", url: "/ai-systems" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /ai-systems/:id and PATCH /ai-systems/:id (tenant isolation, validation, lifecycle rule)", () => {
  it("rejects a cross-tenant read as not found, not leaking existence", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Isolation Test System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "GET", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("reads an AI system belonging to the caller's own tenant", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Readable System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "GET", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe("Readable System");
  });

  it("updates fields and generates ai_system.updated when lifecycle does not change", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Update Target", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { description: "Now with a description" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).description).toBe("Now with a description");

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.updated", targetId: id } });
    expect(event).not.toBeNull();
  });

  it("rejects a cross-tenant update as not found", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Protected System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(tenantBUserId, "ADMIN", tenantBId) },
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an invalid lifecycleStatus", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Bad Lifecycle Test", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { lifecycleStatus: "NOT_A_REAL_STATUS" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces the THIRD_PARTY rule: blocks leaving PROPOSED with no vendor link", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Third Party No Vendor", origin: "THIRD_PARTY" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { lifecycleStatus: "DEVELOPMENT" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("enforces the THIRD_PARTY rule: allows leaving PROPOSED once a vendor is linked, and generates ai_system.lifecycle_changed", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Third Party With Vendor", origin: "THIRD_PARTY" },
    });
    const id = JSON.parse(created.body).id;

    await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "PRIMARY_PROVIDER" },
    });

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { lifecycleStatus: "DEVELOPMENT" },
    });
    expect(res.statusCode).toBe(200);

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.lifecycle_changed", targetId: id } });
    expect(event).not.toBeNull();
  });

  it("generates ai_system.retired when lifecycleStatus is set to RETIRED", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Retirement Test", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "PATCH", url: `/ai-systems/${id}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { lifecycleStatus: "RETIRED" },
    });
    expect(res.statusCode).toBe(200);

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.retired", targetId: id } });
    expect(event).not.toBeNull();
  });
});

describe("AI System <-> Vendor linking", () => {
  it("links a vendor and generates ai_system.vendor_linked", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Link Test System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "MODEL_PROVIDER" },
    });
    expect(res.statusCode).toBe(201);

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.vendor_linked", targetId: id } });
    expect(event).not.toBeNull();
  });

  it("rejects linking a vendor that belongs to a different tenant", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Cross Tenant Link Test", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const res = await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorBId, role: "MODEL_PROVIDER" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a duplicate identical relationship (same aiSystemId, vendorId, role)", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Duplicate Link Test", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "DATA_PROVIDER" },
    });
    const res = await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "DATA_PROVIDER" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("allows one AI system to have multiple different vendors linked", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Multi Vendor System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "MODEL_PROVIDER" },
    });
    await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorA2Id, role: "PLATFORM_PROVIDER" },
    });

    const list = await server.inject({
      method: "GET", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).vendorLinks.length).toBe(2);
  });

  it("allows one vendor to be linked to multiple different AI systems", async () => {
    const sys1 = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Shared Vendor System 1", origin: "INTERNAL" },
    });
    const sys2 = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Shared Vendor System 2", origin: "INTERNAL" },
    });
    const id1 = JSON.parse(sys1.body).id;
    const id2 = JSON.parse(sys2.body).id;

    const link1 = await server.inject({
      method: "POST", url: `/ai-systems/${id1}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "AI_SERVICE_PROVIDER" },
    });
    const link2 = await server.inject({
      method: "POST", url: `/ai-systems/${id2}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "AI_SERVICE_PROVIDER" },
    });
    expect(link1.statusCode).toBe(201);
    expect(link2.statusCode).toBe(201);
  });

  it("unlinks a vendor and generates ai_system.vendor_unlinked", async () => {
    const created = await server.inject({
      method: "POST", url: "/ai-systems",
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { name: "Unlink Test System", origin: "INTERNAL" },
    });
    const id = JSON.parse(created.body).id;

    const link = await server.inject({
      method: "POST", url: `/ai-systems/${id}/vendors`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
      payload: { vendorId: vendorAId, role: "DEVELOPMENT_PROVIDER" },
    });
    const linkId = JSON.parse(link.body).id;

    const res = await server.inject({
      method: "DELETE", url: `/ai-systems/${id}/vendors/${linkId}`,
      cookies: { vg_session: cookieFor(adminUserId, "ADMIN", tenantAId) },
    });
    expect(res.statusCode).toBe(204);

    const event = await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_system.vendor_unlinked", targetId: id } });
    expect(event).not.toBeNull();
  });

  it("rejects an unauthenticated vendor-link request", async () => {
    const res = await server.inject({ method: "POST", url: "/ai-systems/does-not-matter/vendors", payload: { vendorId: vendorAId } });
    expect(res.statusCode).toBe(401);
  });
});