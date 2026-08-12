import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

const baseValidEnv = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  MCP_SERVER_SHARED_SECRET: "a-sufficiently-random-secret",
};

describe("loadEnv fail-closed security checks", () => {
  it("loads successfully with valid development defaults", () => {
    const env = loadEnv({ ...baseValidEnv });
    expect(env.NODE_ENV).toBe("development");
    expect(env.AUTH_MODE).toBe("development");
  });

  it("refuses to start with AUTH_MODE=development in production", () => {
    expect(() =>
      loadEnv({ ...baseValidEnv, NODE_ENV: "production", AUTH_MODE: "development" }),
    ).toThrow(/AUTH_MODE=development is not permitted/);
  });

  it("refuses to start with AI_PROVIDER=fake in production", () => {
    expect(() =>
      loadEnv({
        ...baseValidEnv,
        NODE_ENV: "production",
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "t",
        ENTRA_CLIENT_ID: "c",
        ENTRA_API_AUDIENCE: "a",
        STORAGE_PROVIDER: "azure-blob",
        AZURE_STORAGE_ACCOUNT_URL: "https://example.blob.core.windows.net",
        AI_PROVIDER: "fake",
      }),
    ).toThrow(/AI_PROVIDER=fake is a development\/demo-only provider/);
  });

  it("refuses to start with non-Azure storage in production", () => {
    expect(() =>
      loadEnv({
        ...baseValidEnv,
        NODE_ENV: "production",
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "t",
        ENTRA_CLIENT_ID: "c",
        ENTRA_API_AUDIENCE: "a",
        AI_PROVIDER: "azure-ai",
        AZURE_AI_ENDPOINT: "https://example.openai.azure.com",
        AZURE_AI_DEPLOYMENT: "gpt",
        STORAGE_PROVIDER: "azurite",
      }),
    ).toThrow(/STORAGE_PROVIDER must be azure-blob/);
  });

  it("refuses to start with the sample MCP shared secret in production", () => {
    expect(() =>
      loadEnv({
        ...baseValidEnv,
        NODE_ENV: "production",
        AUTH_MODE: "entra",
        ENTRA_TENANT_ID: "t",
        ENTRA_CLIENT_ID: "c",
        ENTRA_API_AUDIENCE: "a",
        AI_PROVIDER: "azure-ai",
        AZURE_AI_ENDPOINT: "https://example.openai.azure.com",
        AZURE_AI_DEPLOYMENT: "gpt",
        STORAGE_PROVIDER: "azure-blob",
        AZURE_STORAGE_ACCOUNT_URL: "https://example.blob.core.windows.net",
        MCP_SERVER_SHARED_SECRET: "dev-only-local-secret-change-me",
      }),
    ).toThrow(/sample development value/);
  });

  it("accepts a fully valid production configuration", () => {
    const env = loadEnv({
      ...baseValidEnv,
      NODE_ENV: "production",
      AUTH_MODE: "entra",
      ENTRA_TENANT_ID: "tenant-id",
      ENTRA_CLIENT_ID: "client-id",
      ENTRA_API_AUDIENCE: "api://vendorguard",
      AI_PROVIDER: "azure-ai",
      AZURE_AI_ENDPOINT: "https://example.openai.azure.com",
      AZURE_AI_DEPLOYMENT: "gpt-4o",
      STORAGE_PROVIDER: "azure-blob",
      AZURE_STORAGE_ACCOUNT_URL: "https://example.blob.core.windows.net",
      MCP_SERVER_SHARED_SECRET: "a-real-random-production-secret",
    });
    expect(env.NODE_ENV).toBe("production");
  });

  it("rejects entra auth mode with missing tenant configuration", () => {
    expect(() => loadEnv({ ...baseValidEnv, AUTH_MODE: "entra" })).toThrow(
      /requires ENTRA_TENANT_ID/,
    );
  });
});
