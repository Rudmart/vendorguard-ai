import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-api" };
});

// Temporary fake data - will be replaced by real database queries once
// Docker + Postgres + Prisma are wired up in a future step.
const fakeVendors = [
  { id: "1", name: "Nimbus Cloud Sync", category: "Infrastructure", riskBand: "CRITICAL", residualScore: 88 },
  { id: "2", name: "Helios Payments", category: "Fintech", riskBand: "HIGH", residualScore: 67 },
  { id: "3", name: "Northwind Analytics", category: "Data/Analytics", riskBand: "MODERATE", residualScore: 41 },
  { id: "4", name: "Cedar HR Suite", category: "Human Resources", riskBand: "LOW", residualScore: 18 },
];

server.get("/vendors", async () => {
  return { vendors: fakeVendors };
});

server.get("/vendors/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const vendor = fakeVendors.find((v) => v.id === id);
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
