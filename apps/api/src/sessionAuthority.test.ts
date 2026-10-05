import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { server } from "./index.js";
import { createSessionCookie } from "@vendorguard/auth";

// Security fix: API authorization uses the CURRENT TenantMembership/User, never the role copied into the cookie.
let tenantAId: string;
let tenantBId: string;
const users: string[] = [];

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.77." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}

function cookie(userId: string, role: string, tenantId = tenantAId, displayName = "Cookie Name", email = `${userId}@cookie.example.com`) {
  return createSessionCookie({ userId, tenantId, email, displayName, role });
}

async function newUser(label: string, role: string | null, tenantId = tenantAId) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({ data: { externalId: `sec-${label}-${stamp}`, email: `sec-${label}-${stamp}@example.com`, displayName: `Sec ${label}` } });
  users.push(user.id);
  if (role) {
    await prisma.tenantMembership.create({ data: { userId: user.id, tenantId, role: role as never } });
  }
  return user.id;
}

async function setRole(userId: string, role: string, tenantId = tenantAId) {
  await prisma.tenantMembership.update({ where: { tenantId_userId: { tenantId, userId } }, data: { role: role as never } });
}

async function createSystem(sessionCookie: string) {
  return server.inject({
    method: "POST", url: "/ai-systems",
    cookies: { vg_session: sessionCookie },
    payload: { name: "Session authority test system", origin: "INTERNAL" },
    remoteAddress: nextIp(),
  });
}

async function me(sessionCookie: string) {
  const res = await server.inject({ method: "GET", url: "/auth/me", cookies: { vg_session: sessionCookie }, remoteAddress: nextIp() });
  return { status: res.statusCode, user: res.statusCode === 200 ? (JSON.parse(res.body).user as { role: string; displayName: string; email: string; tenantId: string }) : null };
}

async function inventory(sessionCookie: string) {
  return (await server.inject({ method: "GET", url: "/ai-inventory", cookies: { vg_session: sessionCookie }, remoteAddress: nextIp() })).statusCode;
}

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "Session Authority Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "Session Authority Tenant B" } })).id;
});

afterAll(async () => {
  const tenantId = { in: [tenantAId, tenantBId] };
  await prisma.auditEvent.deleteMany({ where: { tenantId } });
  await prisma.aiSystem.deleteMany({ where: { tenantId } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
});

describe("Database-authoritative API session", () => {
  it("role downgrade takes effect immediately on the same cookie (no re-login)", async () => {
    const userId = await newUser("down", "ADMIN");
    const c = cookie(userId, "ADMIN");
    expect((await createSystem(c)).statusCode).toBe(201);
    await setRole(userId, "READ_ONLY");
    expect((await createSystem(c)).statusCode).toBe(403);
    const m = await me(c);
    expect(m.status).toBe(200);
    expect(m.user?.role).toBe("READ_ONLY");
  });

  it("role upgrade takes effect immediately on the same cookie (no re-login)", async () => {
    const userId = await newUser("up", "READ_ONLY");
    const c = cookie(userId, "READ_ONLY");
    expect((await createSystem(c)).statusCode).toBe(403);
    await setRole(userId, "ADMIN");
    expect((await createSystem(c)).statusCode).toBe(201);
    expect((await me(c)).user?.role).toBe("ADMIN");
  });

  it("database role wins when a signed cookie claims ADMIN but the membership is READ_ONLY", async () => {
    const userId = await newUser("mm-down", "READ_ONLY");
    const c = cookie(userId, "ADMIN");
    expect((await createSystem(c)).statusCode).toBe(403);
    expect((await me(c)).user?.role).toBe("READ_ONLY");
  });

  it("database role wins when a signed cookie claims READ_ONLY but the membership is ADMIN", async () => {
    const userId = await newUser("mm-up", "ADMIN");
    const c = cookie(userId, "READ_ONLY");
    expect((await createSystem(c)).statusCode).toBe(201);
    expect((await me(c)).user?.role).toBe("ADMIN");
  });

  it("removed membership -> 401 on protected routes and /auth/me", async () => {
    const userId = await newUser("removed", "ADMIN");
    const c = cookie(userId, "ADMIN");
    expect(await inventory(c)).toBe(200);
    await prisma.tenantMembership.delete({ where: { tenantId_userId: { tenantId: tenantAId, userId } } });
    expect(await inventory(c)).toBe(401);
    expect((await createSystem(c)).statusCode).toBe(401);
    expect((await me(c)).status).toBe(401);
  });

  it("deleted user -> 401", async () => {
    const userId = await newUser("deleted", "ADMIN");
    const c = cookie(userId, "ADMIN");
    expect(await inventory(c)).toBe(200);
    await prisma.user.delete({ where: { id: userId } });
    expect(await inventory(c)).toBe(401);
    expect((await me(c)).status).toBe(401);
  });

  it("signed (userId, tenantId) without that membership -> 401, never another tenant's membership", async () => {
    const userId = await newUser("wrong-tenant", "ADMIN", tenantAId);
    const c = cookie(userId, "ADMIN", tenantBId);
    expect(await inventory(c)).toBe(401);
    expect((await createSystem(c)).statusCode).toBe(401);
    expect((await me(c)).status).toBe(401);
  });

  it("/auth/me returns current database identity, not the cookie's copies", async () => {
    const userId = await newUser("identity", "REVIEWER");
    const c = cookie(userId, "ADMIN", tenantAId, "Old Cookie Name", "old@cookie.example.com");
    await prisma.user.update({ where: { id: userId }, data: { displayName: "Current DB Name" } });
    const m = await me(c);
    expect(m.status).toBe(200);
    expect(m.user?.displayName).toBe("Current DB Name");
    expect(m.user?.email).not.toBe("old@cookie.example.com");
    expect(m.user?.role).toBe("REVIEWER");
    expect(m.user?.tenantId).toBe(tenantAId);
  });

  it("still rejects tampered and unsigned cookies with 401", async () => {
    const userId = await newUser("tamper", "READ_ONLY");
    const [payload = "", sig = ""] = cookie(userId, "READ_ONLY").split(".");
    const forged = Buffer.from(JSON.stringify({ userId, tenantId: tenantAId, email: "x@example.com", displayName: "x", role: "ADMIN" })).toString("base64url");
    expect(await inventory(`${forged}.${sig}`)).toBe(401);
    expect(await inventory(payload)).toBe(401);
  });
});