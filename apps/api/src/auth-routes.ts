import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";
import { COOKIE_NAME } from "@vendorguard/auth";

export async function registerAuthRoutes(server: FastifyInstance) {
  // Fail closed: this passwordless dev-only login must never be reachable
  // in production. Failing at startup (not just per-request) guarantees the
  // app cannot silently run in an unsafe state.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to start: passwordless dev login is registered but NODE_ENV is production. Remove registerAuthRoutes from the production build or gate it behind a real authentication provider.");
  }

  server.post("/auth/login", async (request, reply) => {
    const body = request.body as { displayName?: string; email?: string };

    if (!body.email || !body.displayName) {
      return reply.status(400).send({ error: "displayName and email are required" });
    }

    const tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      return reply.status(500).send({ error: "No tenant exists yet" });
    }

    let user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          externalId: `dev-${body.email}`,
          email: body.email,
          displayName: body.displayName,
        },
      });
    }

    let membership = await prisma.tenantMembership.findFirst({
      where: { userId: user.id, tenantId: tenant.id },
    });
    if (!membership) {
      membership = await prisma.tenantMembership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: "ADMIN",
        },
      });
    }

    const session = {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      displayName: user.displayName,
      role: membership.role,
    };

    reply.setCookie(COOKIE_NAME, JSON.stringify(session), {
      path: "/",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      ...(process.env.NODE_ENV === "production" ? { domain: ".delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io" } : {}),
      maxAge: 60 * 60 * 24 * 7,
    });

    return reply.send({ user: session });
  });

  server.post("/auth/logout", async (request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.send({ ok: true });
  });

  server.get("/auth/me", async (request, reply) => {
    const raw = request.cookies[COOKIE_NAME];
    if (!raw) {
      return reply.status(401).send({ error: "Not logged in" });
    }
    try {
      const session = JSON.parse(raw);
      return reply.send({ user: session });
    } catch {
      return reply.status(401).send({ error: "Invalid session" });
    }
  });
}


