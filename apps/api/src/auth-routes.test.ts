import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { registerAuthRoutes } from "./auth-routes.js";

describe("registerAuthRoutes production guard", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("refuses to register the passwordless dev login when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const server = Fastify();
    await expect(registerAuthRoutes(server)).rejects.toThrow("passwordless dev login");
  });

  it("registers normally when NODE_ENV is not production", async () => {
    process.env.NODE_ENV = "test";
    const server = Fastify();
    await expect(registerAuthRoutes(server)).resolves.not.toThrow();
  });
});