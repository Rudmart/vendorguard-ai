import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@vendorguard/database";
import { calculateInherentRisk } from "@vendorguard/risk-engine";
import cookie from "@fastify/cookie";
import { registerAuthRoutes, getSessionFromCookie, COOKIE_NAME } from "./auth-routes.js";

const server = Fastify({ logger: true });

server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  credentials: true,
});

server.register(cookie);

server.register(registerAuthRoutes);

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-api" };
});

server.get("/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { vendors };
});

server.get("/vendors/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  return vendor;
});

server.post("/vendors", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }

  const body = request.body as {
    legalName?: string;
    serviceDescription?: string;
    serviceCategory?: string;
    criticality?: string;
    dataSensitivity?: number;
    businessCriticality?: number;
    accessPrivilege?: number;
    operationalDependency?: number;
    fourthPartyConcentration?: number;
    geographicRegulatoryExposure?: number;
  };

  if (!body.legalName) {
    return reply.status(400).send({ error: "legalName is required" });
  }

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    return reply.status(500).send({ error: "No tenant exists yet" });
  }

  const vendor = await prisma.vendor.create({
    data: {
      tenantId: tenant.id,
      legalName: body.legalName,
      serviceDescription: body.serviceDescription || "",
      serviceCategory: body.serviceCategory || "",
      criticality: body.criticality || "",
      dataSensitivity: body.dataSensitivity ?? null,
      businessCriticality: body.businessCriticality ?? null,
      accessPrivilege: body.accessPrivilege ?? null,
      operationalDependency: body.operationalDependency ?? null,
      fourthPartyConcentration: body.fourthPartyConcentration ?? null,
      geographicRegulatoryExposure: body.geographicRegulatoryExposure ?? null,
    },
  });

  return reply.status(201).send(vendor);
});

server.get("/vendors/:id/risk-score", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vendor = await prisma.vendor.findUnique({ where: { id } });

  if (!vendor) {
    return reply.status(404).send({ error: "Vendor not found" });
  }

  const result = calculateInherentRisk({
    dataSensitivity: vendor.dataSensitivity ?? undefined,
    businessCriticality: vendor.businessCriticality ?? undefined,
    accessPrivilege: vendor.accessPrivilege ?? undefined,
    operationalDependency: vendor.operationalDependency ?? undefined,
    fourthPartyConcentration: vendor.fourthPartyConcentration ?? undefined,
    geographicRegulatoryExposure: vendor.geographicRegulatoryExposure ?? undefined,
  });

  return result;
});

server.patch("/vendors/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  const body = request.body as {
    legalName?: string;
    serviceDescription?: string;
    serviceCategory?: string;
    criticality?: string;
    dataSensitivity?: number;
    businessCriticality?: number;
    accessPrivilege?: number;
    operationalDependency?: number;
    fourthPartyConcentration?: number;
    geographicRegulatoryExposure?: number;
  };
  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      ...(body.legalName !== undefined && { legalName: body.legalName }),
      ...(body.serviceDescription !== undefined && { serviceDescription: body.serviceDescription }),
      ...(body.serviceCategory !== undefined && { serviceCategory: body.serviceCategory }),
      ...(body.criticality !== undefined && { criticality: body.criticality }),
      ...(body.dataSensitivity !== undefined && { dataSensitivity: body.dataSensitivity }),
      ...(body.businessCriticality !== undefined && { businessCriticality: body.businessCriticality }),
      ...(body.accessPrivilege !== undefined && { accessPrivilege: body.accessPrivilege }),
      ...(body.operationalDependency !== undefined && { operationalDependency: body.operationalDependency }),
      ...(body.fourthPartyConcentration !== undefined && { fourthPartyConcentration: body.fourthPartyConcentration }),
      ...(body.geographicRegulatoryExposure !== undefined && { geographicRegulatoryExposure: body.geographicRegulatoryExposure }),
    },
  });
  return vendor;
});
server.delete("/vendors/:id", async (request, reply) => {
  const session = getSessionFromCookie(request.cookies[COOKIE_NAME]);
  if (!session) {
    return reply.status(401).send({ error: "Not logged in" });
  }
  const { id } = request.params as { id: string };
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) {
    return reply.status(404).send({ error: "Vendor not found" });
  }
  await prisma.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
  return reply.status(204).send();
});
const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 4000;
    await server.listen({ port, host: "0.0.0.0" });
    console.log(`VendorGuard API running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();



