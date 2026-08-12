import Fastify from "fastify";
import { prisma } from "@vendorguard/database";

const server = Fastify({ logger: true });

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
