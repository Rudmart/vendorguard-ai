import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@vendorguard/database";
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

describe("development login input validation", () => {
  it.each([
    { label: "null body", body: null },
    { label: "missing fields", body: {} },
    { label: "array body", body: [] },
    { label: "object email", body: { email: {}, displayName: "Test" } },
    { label: "object name", body: { email: "test@example.com", displayName: {} } },
    { label: "blank email", body: { email: "  ", displayName: "Test" } },
  ])("rejects $label before database access", async ({ body }) => {
    const app = Fastify();
    const lookup = vi.spyOn(prisma.tenant, "findFirst").mockImplementation(() => {
      throw new Error("Invalid login must not reach the database");
    });
    try {
      await registerAuthRoutes(app);
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(body),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "displayName and email are required" });
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      await app.close();
    }
  });
});
