import type { FastifyInstance } from "fastify";
import { prisma } from "@vendorguard/database";

const COOKIE_NAME = "vg_session";

export async function registerAuthRoutes(server: FastifyInstance) {
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
      sameSite: "none",
      secure: true,
      domain: ".delightfulforest-d2fb8ed2.eastus2.azurecontainerapps.io",
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

export function getSessionFromCookie(cookieValue: string | undefined) {
  if (!cookieValue) return null;
  try {
    return JSON.parse(cookieValue) as {
      userId: string;
      tenantId: string;
      email: string;
      displayName: string;
      role: string;
    };
  } catch {
    return null;
  }
}

export { COOKIE_NAME };

