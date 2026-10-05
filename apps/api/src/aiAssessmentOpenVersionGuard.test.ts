import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

// Phase D2: at most one non-COMPLETED Risk Assessment and one non-COMPLETED Impact Assessment per AI system.
const RISK_ERROR = "An unfinished risk assessment already exists for this AI system. Complete it before starting a new version.";
const IMPACT_ERROR = "An unfinished impact assessment already exists for this AI system. Complete it before starting a new version.";

type Kind = "risk" | "impact";

let tenantAId: string;
let tenantBId: string;
let adminAId: string;
let adminBId: string;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.42." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}

function cookieFor(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "D2 Test User", role });
}

async function newSystem(tenantId = tenantAId, userId = adminAId) {
  const res = await server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: cookieFor(userId, "ADMIN", tenantId) },
    payload: { name: "D2 Guard System", origin: "INTERNAL" },
    remoteAddress: nextIp(),
  });
  return JSON.parse(res.body).id as string;
}

async function create(kind: Kind, sysId: string, tenantId = tenantAId, userId = adminAId) {
  const res = await server.inject({
    method: "POST", url: `/ai-systems/${sysId}/${kind}-assessments`,
    cookies: { vg_session: cookieFor(userId, "ADMIN", tenantId) },
    payload: { name: `D2 ${kind} assessment` },
    remoteAddress: nextIp(),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as { id: string; version: number; error?: string } };
}

async function setStatus(kind: Kind, id: string, status: string) {
  const data = { status: status as never, completedAt: status === "COMPLETED" ? new Date() : null };
  if (kind === "risk") {
    await prisma.aiRiskAssessment.update({ where: { id }, data });
  } else {
    await prisma.aiImpactAssessment.update({ where: { id }, data });
  }
}

async function countOpen(kind: Kind, sysId: string) {
  const where = { aiSystemId: sysId, status: { not: "COMPLETED" as never } };
  return kind === "risk" ? prisma.aiRiskAssessment.count({ where }) : prisma.aiImpactAssessment.count({ where });
}

beforeAll(async () => {
  const stamp = Date.now();
  tenantAId = (await prisma.tenant.create({ data: { name: "D2 Guard Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "D2 Guard Tenant B" } })).id;
  adminAId = (await prisma.user.create({ data: { externalId: `d2-admin-a-${stamp}`, email: `d2-admin-a-${stamp}@example.com`, displayName: "D2 Admin A" } })).id;
  adminBId = (await prisma.user.create({ data: { externalId: `d2-admin-b-${stamp}`, email: `d2-admin-b-${stamp}@example.com`, displayName: "D2 Admin B" } })).id;
  await prisma.tenantMembership.create({ data: { userId: adminAId, tenantId: tenantAId, role: "ADMIN" } });
  await prisma.tenantMembership.create({ data: { userId: adminBId, tenantId: tenantBId, role: "ADMIN" } });
});

afterAll(async () => {
  const tenantId = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId } });
  await prisma.aiImpactAssessment.deleteMany({ where: { tenantId } });
  await prisma.aiSystem.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: adminAId } });
  await prisma.user.delete({ where: { id: adminBId } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

for (const kind of ["risk", "impact"] as const) {
  const message = kind === "risk" ? RISK_ERROR : IMPACT_ERROR;

  describe(`Phase D2 - one open ${kind} assessment version per AI system`, () => {
    it("creates v1 when no assessment exists", async () => {
      const sysId = await newSystem();
      const res = await create(kind, sysId);
      expect(res.status).toBe(201);
      expect(res.body.version).toBe(1);
    });

    for (const open of ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW"]) {
      it(`returns 409 while the latest version is ${open}`, async () => {
        const sysId = await newSystem();
        const v1 = await create(kind, sysId);
        await setStatus(kind, v1.body.id, open);
        const res = await create(kind, sysId);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe(message);
        expect(await countOpen(kind, sysId)).toBe(1);
      });
    }

    it("allows the next version once the latest is COMPLETED, and increments without reusing numbers", async () => {
      const sysId = await newSystem();
      const v1 = await create(kind, sysId);
      await setStatus(kind, v1.body.id, "COMPLETED");
      const v2 = await create(kind, sysId);
      expect(v2.status).toBe(201);
      expect(v2.body.version).toBe(2);
      await setStatus(kind, v2.body.id, "COMPLETED");
      const v3 = await create(kind, sysId);
      expect(v3.status).toBe(201);
      expect(v3.body.version).toBe(3);
    });

    it("is scoped per AI system: an open version on another system does not block", async () => {
      const busy = await newSystem();
      await create(kind, busy);
      const free = await newSystem();
      expect((await create(kind, free)).status).toBe(201);
    });

    it("keeps tenant isolation: another tenant gets 404 and its open versions never block this tenant", async () => {
      const sysA = await newSystem();
      expect((await create(kind, sysA, tenantBId, adminBId)).status).toBe(404);
      const sysB = await newSystem(tenantBId, adminBId);
      await create(kind, sysB, tenantBId, adminBId);
      expect((await create(kind, sysA)).status).toBe(201);
    });

    it("lets only one of two simultaneous creates succeed after a completed version", async () => {
      const sysId = await newSystem();
      const v1 = await create(kind, sysId);
      await setStatus(kind, v1.body.id, "COMPLETED");
      const [a, b] = await Promise.all([create(kind, sysId), create(kind, sysId)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await countOpen(kind, sysId)).toBe(1);
      const winner = a.status === 201 ? a : b;
      expect(winner.body.version).toBe(2);
    });
  });
}

describe("Phase D2 - Risk and Impact are independent", () => {
  it("an open risk assessment does not block a new impact assessment", async () => {
    const sysId = await newSystem();
    await create("risk", sysId);
    expect((await create("impact", sysId)).status).toBe(201);
  });

  it("an open impact assessment does not block a new risk assessment", async () => {
    const sysId = await newSystem();
    await create("impact", sysId);
    expect((await create("risk", sysId)).status).toBe(201);
  });
});