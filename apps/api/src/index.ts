import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "@vendorguard/database";

const server = Fastify({ logger: true });

server.register(cors, {
  origin: "http://localhost:3000",
});

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-api" };
});

server.get("/vendors", async () => {
  const vendors = await prisma.vendor.findMany({
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
  const body = request.body as {
    legalName?: string;
    serviceDescription?: string;
    serviceCategory?: string;
    criticality?: string;
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
    },
  });

  return reply.status(201).send(vendor);
});

const start = async () => {
  try {
    await server.listen({ port: 4000, host: "0.0.0.0" });
    console.log("VendorGuard API running at http://localhost:4000");
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
