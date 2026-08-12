import Fastify from "fastify";

const server = Fastify({ logger: true });

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-api" };
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
