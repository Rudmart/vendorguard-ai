import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vendorguard/database";
import { createSessionCookie, getSessionFromCookie } from "@vendorguard/auth";
import { server } from "./index.js";

// Security PR 2: the server must never trust a session whose signature does not verify.
let tenantAId: string;
let tenantBId: string;
let readOnlyUserId: string;
let adminUserId: string;
const stamp = Date.now();
const loginEmail = `sec2-login-${stamp}@example.com`;
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return "10.32." + Math.floor(ipCounter / 250) + "." + (ipCounter % 250);
}
function session(userId: string, role: string, tenantId: string) {
  return createSessionCookie({ userId, tenantId, email: `${userId}@example.com`, displayName: "Test", role });
}
function forge(value: string, changes: Record<string, string>) {
  const dot = value.lastIndexOf(".");
  const payload = JSON.parse(Buffer.from(value.slice(0, dot), "base64url").toString("utf8")) as Record<string, string>;
  return Buffer.from(JSON.stringify({ ...payload, ...changes }), "utf8").toString("base64url") + "." + value.slice(dot + 1);
}
async function req(method: "GET" | "POST", url: string, cookie?: string, payload?: Record<string, unknown>) {
  return server.inject({ method, url, cookies: cookie !== undefined ? { vg_session: cookie } : {}, payload, remoteAddress: nextIp() });
}

beforeAll(async () => {
  tenantAId = (await prisma.tenant.create({ data: { name: "SEC2 Tenant A" } })).id;
  tenantBId = (await prisma.tenant.create({ data: { name: "SEC2 Tenant B" } })).id;
  const mk = async (label: string, role: string) => {
    const u = await prisma.user.create({ data: { externalId: `sec2-${label}-${stamp}`, email: `sec2-${label}-${stamp}@example.com`, displayName: `SEC2 ${label}` } });
    await prisma.tenantMembership.create({ data: { userId: u.id, tenantId: tenantAId, role: role as never } });
    return u.id;
  };
  readOnlyUserId = await mk("readonly", "READ_ONLY");
  adminUserId = await mk("admin", "ADMIN");
});

afterAll(async () => {
  const loginUser = await prisma.user.findUnique({ where: { email: loginEmail } });
  if (loginUser) {
    await prisma.tenantMembership.deleteMany({ where: { userId: loginUser.id } });
    await prisma.user.delete({ where: { id: loginUser.id } });
  }
  await prisma.aiSystem.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [readOnlyUserId, adminUserId] } } });
  await prisma.tenant.delete({ where: { id: tenantAId } });
  await prisma.tenant.delete({ where: { id: tenantBId } });
});

describe("Signed sessions", () => {
  it("accepts a legitimately signed session", async () => {
    const legit = session(readOnlyUserId, "READ_ONLY", tenantAId);
    expect(getSessionFromCookie(legit)?.role).toBe("READ_ONLY");
    const me = await req("GET", "/auth/me", legit);
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).user.userId).toBe(readOnlyUserId);
    expect((await req("GET", "/ai-systems", legit)).statusCode).toBe(200);
  });

  it("rejects role escalation (READ_ONLY -> ADMIN) without the secret", async () => {
    const forged = forge(session(readOnlyUserId, "READ_ONLY", tenantAId), { role: "ADMIN" });
    expect((await req("GET", "/auth/me", forged)).statusCode).toBe(401);
    const create = await req("POST", "/ai-systems", forged, { name: "SEC2 escalation", origin: "INTERNAL" });
    expect(create.statusCode).toBe(401);
    expect(await prisma.aiSystem.count({ where: { tenantId: tenantAId } })).toBe(0);
  });

  it("rejects tenant switching", async () => {
    const forged = forge(session(adminUserId, "ADMIN", tenantAId), { tenantId: tenantBId });
    expect((await req("GET", "/ai-systems", forged)).statusCode).toBe(401);
  });

  it("rejects identity changes (userId, email)", async () => {
    const legit = session(readOnlyUserId, "READ_ONLY", tenantAId);
    expect((await req("GET", "/auth/me", forge(legit, { userId: adminUserId }))).statusCode).toBe(401);
    expect((await req("GET", "/auth/me", forge(legit, { email: "someone-else@example.com" }))).statusCode).toBe(401);
  });

  it("rejects random or transplanted signatures", async () => {
    const legit = session(readOnlyUserId, "READ_ONLY", tenantAId);
    const payload = legit.slice(0, legit.lastIndexOf("."));
    expect((await req("GET", "/auth/me", payload + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).statusCode).toBe(401);
    const otherSig = session(adminUserId, "ADMIN", tenantAId).split(".").pop() ?? "";
    expect((await req("GET", "/auth/me", payload + "." + otherSig)).statusCode).toBe(401);
  });

  it("rejects legacy unsigned JSON and malformed cookies with 401 (never 500)", async () => {
    const legacy = JSON.stringify({ userId: adminUserId, tenantId: tenantAId, email: "a@example.com", displayName: "A", role: "ADMIN" });
    for (const value of [legacy, "garbage", ".", "a.b.c", "x."]) {
      expect((await req("GET", "/auth/me", value)).statusCode, value).toBe(401);
      expect((await req("GET", "/ai-systems", value)).statusCode, value).toBe(401);
    }
  });

  it("login issues a signed cookie that /auth/me accepts; logout clears it", async () => {
    const login = await req("POST", "/auth/login", undefined, { email: loginEmail, displayName: "SEC2 Login" });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === "vg_session");
    expect(cookie?.value).toBeTruthy();
    const value = cookie?.value ?? "";
    expect(value.startsWith("{")).toBe(false);
    expect(getSessionFromCookie(value)?.email).toBe(loginEmail);
    const me = await req("GET", "/auth/me", value);
    expect(me.statusCode).toBe(200);
    expect(JSON.parse(me.body).user.email).toBe(loginEmail);
    const logout = await req("POST", "/auth/logout", value);
    expect(logout.statusCode).toBe(200);
    const cleared = logout.cookies.find((c) => c.name === "vg_session");
    expect(cleared?.value ?? "").toBe("");
  });
});