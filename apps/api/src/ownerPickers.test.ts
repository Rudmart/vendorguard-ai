import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

// Owner Pickers: treatment owner + target date on AI risks, owner on monitoring checks, tenant-user list.
let tenantAId: string;
let tenantBId: string;
let adminA: string;
let readOnlyA: string;
let otherA: string;
let adminB: string;
let sysId: string;
let assessmentId: string;
const stamp = `${Date.now()}`;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.88." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function cookie(userId: string, role: string, tenantId = tenantAId) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Owner Picker Test", role });
}
async function call(method: "GET" | "POST" | "PATCH", url: string, userId: string, role: string, payload?: Record<string, unknown>, tenantId = tenantAId) {
  const res = await server.inject({ method, url, cookies: { vg_session: cookie(userId, role, tenantId) }, payload, remoteAddress: nextIp() });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function newUser(label: string, role: string, tenantId: string) {
  const u = await prisma.user.create({ data: { externalId: `op-${label}-${stamp}`, email: `op-${label}-${stamp}@example.com`, displayName: `Owner Picker ${label}` } });
  await prisma.tenantMembership.create({ data: { userId: u.id, tenantId, role: role as never } });
  return u.id;
}
async function newRisk(title = "Owner picker risk") {
  return (
    await prisma.aiRisk.create({
      data: {
        tenantId: tenantAId, assessmentId, title, category: "OPERATIONAL" as never, statement: "x",
        likelihood: 3, impact: 3, inherentScore: 9, inherentRating: "MODERATE" as never,
        residualLikelihood: 2, residualImpact: 2, residualScore: 4, residualRating: "LOW" as never,
      },
    })
  ).id;
}
const checkBody = { title: "Review override rate", whatToReview: "Override log", expectation: "Under 5%", category: "HUMAN_OVERSIGHT", cadence: "MONTHLY" };

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "Owner Picker Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "Owner Picker Tenant B" } })).id;
  adminA = await newUser("admin-a", "ADMIN", tenantAId);
  readOnlyA = await newUser("readonly-a", "READ_ONLY", tenantAId);
  otherA = await newUser("analyst-a", "ANALYST", tenantAId);
  adminB = await newUser("admin-b", "ADMIN", tenantBId);
  sysId = (await call("POST", "/ai-systems", adminA, "ADMIN", { name: "Owner Picker System", origin: "INTERNAL" })).body.id;
  assessmentId = (await prisma.aiRiskAssessment.create({ data: { tenantId: tenantAId, aiSystemId: sysId, name: "RA v1", version: 1 } })).id;
});

afterAll(async () => {
  const tenantId = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.aiMonitoringCheck.deleteMany({ where: { tenantId } });
  await prisma.aiRisk.deleteMany({ where: { tenantId } });
  await prisma.aiRiskAssessment.deleteMany({ where: { tenantId } });
  await prisma.aiSystem.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA, readOnlyA, otherA, adminB] } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe("Owner Pickers - tenant users", () => {
  it("returns only the current tenant's users, with their membership role", async () => {
    const res = await call("GET", "/tenant-users", adminA, "ADMIN");
    expect(res.status).toBe(200);
    const users = res.body.users as { id: string; role: string }[];
    expect(users.map((u) => u.id)).toEqual(expect.arrayContaining([adminA, readOnlyA, otherA]));
    expect(users.some((u) => u.id === adminB)).toBe(false);
    expect(users.find((u) => u.id === readOnlyA)?.role).toBe("READ_ONLY");
  });

  it("stays protected by ai-system:update (READ_ONLY -> 403)", async () => {
    expect((await call("GET", "/tenant-users", readOnlyA, "READ_ONLY")).status).toBe(403);
  });
});

describe("Owner Pickers - risk treatment owner and target date", () => {
  it("an authorized user assigns owner + target date; both persist and are audited", async () => {
    const riskId = await newRisk();
    const res = await call("PATCH", `/ai-risks/${riskId}`, adminA, "ADMIN", { treatmentOwnerUserId: otherA, treatmentTargetDate: "2026-12-31" });
    expect(res.status).toBe(200);
    const saved = await prisma.aiRisk.findUnique({ where: { id: riskId } });
    expect(saved?.treatmentOwnerUserId).toBe(otherA);
    expect(saved?.treatmentTargetDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.treatment_owner_changed", targetId: riskId } })).not.toBeNull();
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_risk.treatment_target_date_changed", targetId: riskId } })).not.toBeNull();
  });

  it("rejects a treatment owner from another tenant (400) and leaves the risk unchanged", async () => {
    const riskId = await newRisk();
    const res = await call("PATCH", `/ai-risks/${riskId}`, adminA, "ADMIN", { treatmentOwnerUserId: adminB });
    expect(res.status).toBe(400);
    expect((await prisma.aiRisk.findUnique({ where: { id: riskId } }))?.treatmentOwnerUserId).toBeNull();
  });

  it("READ_ONLY cannot assign an owner (403)", async () => {
    const riskId = await newRisk();
    expect((await call("PATCH", `/ai-risks/${riskId}`, readOnlyA, "READ_ONLY", { treatmentOwnerUserId: otherA })).status).toBe(403);
  });

  it("uses the database role, not a cookie claim (cookie ADMIN, DB READ_ONLY -> 403)", async () => {
    const riskId = await newRisk();
    expect((await call("PATCH", `/ai-risks/${riskId}`, readOnlyA, "ADMIN", { treatmentOwnerUserId: otherA })).status).toBe(403);
  });

  it("treatment planning (owner, date, treatment) still saves after the assessment is COMPLETED", async () => {
    const done = await prisma.aiRiskAssessment.create({ data: { tenantId: tenantAId, aiSystemId: sysId, name: "RA done", version: 2, status: "COMPLETED" as never, completedAt: new Date() } });
    const riskId = (
      await prisma.aiRisk.create({
        data: {
          tenantId: tenantAId, assessmentId: done.id, title: "Completed-assessment risk", category: "OPERATIONAL" as never, statement: "x",
          likelihood: 3, impact: 3, inherentScore: 9, inherentRating: "MODERATE" as never,
        },
      })
    ).id;
    const res = await call("PATCH", `/ai-risks/${riskId}`, adminA, "ADMIN", { treatment: "ACCEPT", treatmentOwnerUserId: otherA, treatmentTargetDate: "2027-01-15" });
    expect(res.status).toBe(200);
    // The Risk Acceptance prerequisite (aiRiskAcceptance.ts: a treatment owner must be set) is now satisfiable.
    expect((await prisma.aiRisk.findUnique({ where: { id: riskId } }))?.treatmentOwnerUserId).toBe(otherA);
  });
});

describe("Owner Pickers - monitoring owner", () => {
  it("creates a check with ownerUserId from the picker", async () => {
    const res = await call("POST", `/ai-systems/${sysId}/monitoring-checks`, adminA, "ADMIN", { ...checkBody, ownerUserId: otherA });
    expect(res.status).toBe(201);
    expect((await prisma.aiMonitoringCheck.findUnique({ where: { id: res.body.id } }))?.ownerUserId).toBe(otherA);
  });

  it("rejects a monitoring owner from another tenant (400)", async () => {
    expect((await call("POST", `/ai-systems/${sysId}/monitoring-checks`, adminA, "ADMIN", { ...checkBody, ownerUserId: adminB })).status).toBe(400);
  });

  it("keeps legacy ownerEmail API compatibility", async () => {
    const email = (await prisma.user.findUnique({ where: { id: otherA } }))?.email;
    const res = await call("POST", `/ai-systems/${sysId}/monitoring-checks`, adminA, "ADMIN", { ...checkBody, ownerEmail: email });
    expect(res.status).toBe(201);
    expect((await prisma.aiMonitoringCheck.findUnique({ where: { id: res.body.id } }))?.ownerUserId).toBe(otherA);
  });

  it("changes the owner of an existing check via PATCH ownerUserId, audited", async () => {
    const created = await call("POST", `/ai-systems/${sysId}/monitoring-checks`, adminA, "ADMIN", { ...checkBody });
    const res = await call("PATCH", `/ai-monitoring-checks/${created.body.id}`, adminA, "ADMIN", { ownerUserId: otherA });
    expect(res.status).toBe(200);
    expect((await prisma.aiMonitoringCheck.findUnique({ where: { id: created.body.id } }))?.ownerUserId).toBe(otherA);
    expect(await prisma.auditEvent.findFirst({ where: { tenantId: tenantAId, action: "ai_monitoring_check.updated", targetId: created.body.id } })).not.toBeNull();
  });
});