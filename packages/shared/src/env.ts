import { z } from "zod";

/**
 * Central environment schema for all VendorGuard AI services.
 *
 * SECURITY-CRITICAL: This module enforces "fail closed" startup behavior.
 * If a service would start in an insecure configuration - e.g. development
 * auth mode in a production environment, or the fake AI provider outside
 * development - process startup throws and the service does not boot.
 *
 * Do not weaken these checks to "fix" a deployment. Fix the configuration.
 */

const nodeEnvSchema = z.enum(["development", "test", "production"]);
const authModeSchema = z.enum(["development", "entra"]);
const aiProviderSchema = z.enum(["fake", "azure-ai"]);
const storageProviderSchema = z.enum(["local", "azurite", "azure-blob"]);
const searchProviderSchema = z.enum(["postgres", "azure-ai-search"]);

export const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    AUTH_MODE: authModeSchema.default("development"),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_API_AUDIENCE: z.string().optional(),

    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

    STORAGE_PROVIDER: storageProviderSchema.default("azurite"),
    AZURITE_CONNECTION_STRING: z.string().optional(),
    AZURE_STORAGE_ACCOUNT_URL: z.string().optional(),
    AZURE_STORAGE_CONTAINER_EVIDENCE: z.string().default("evidence"),

    SEARCH_PROVIDER: searchProviderSchema.default("postgres"),
    AZURE_SEARCH_ENDPOINT: z.string().optional(),
    AZURE_SEARCH_INDEX: z.string().default("vendorguard-evidence"),

    AI_PROVIDER: aiProviderSchema.default("fake"),
    AZURE_AI_ENDPOINT: z.string().optional(),
    AZURE_AI_DEPLOYMENT: z.string().optional(),
    AZURE_AI_API_VERSION: z.string().default("2024-10-21"),

    MCP_SERVER_URL: z.string().default("http://localhost:4100"),
    MCP_SERVER_SHARED_SECRET: z.string().min(1, "MCP_SERVER_SHARED_SECRET is required"),

    API_PORT: z.coerce.number().int().positive().default(4000),
    API_CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

    OTEL_SERVICE_NAME: z.string().default("vendorguard-service"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    // --- Fail-closed rule 1: no development auth in production ---
    if (config.NODE_ENV === "production" && config.AUTH_MODE === "development") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Refusing to start: AUTH_MODE=development is not permitted when NODE_ENV=production. " +
          "Configure AUTH_MODE=entra with a valid Entra ID app registration.",
        path: ["AUTH_MODE"],
      });
    }

    // --- Fail-closed rule 2: Entra config must be complete when selected ---
    if (config.AUTH_MODE === "entra") {
      if (!config.ENTRA_TENANT_ID || !config.ENTRA_CLIENT_ID || !config.ENTRA_API_AUDIENCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "AUTH_MODE=entra requires ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_API_AUDIENCE to be set.",
          path: ["AUTH_MODE"],
        });
      }
    }

    // --- Fail-closed rule 3: no fake AI provider in production ---
    if (config.NODE_ENV === "production" && config.AI_PROVIDER === "fake") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Refusing to start: AI_PROVIDER=fake is a development/demo-only provider and is not " +
          "permitted when NODE_ENV=production. Configure AI_PROVIDER=azure-ai.",
        path: ["AI_PROVIDER"],
      });
    }

    if (config.AI_PROVIDER === "azure-ai" && (!config.AZURE_AI_ENDPOINT || !config.AZURE_AI_DEPLOYMENT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AI_PROVIDER=azure-ai requires AZURE_AI_ENDPOINT and AZURE_AI_DEPLOYMENT to be set.",
        path: ["AI_PROVIDER"],
      });
    }

    // --- Fail-closed rule 4: no local/azurite storage in production ---
    if (config.NODE_ENV === "production" && config.STORAGE_PROVIDER !== "azure-blob") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Refusing to start: STORAGE_PROVIDER must be azure-blob when NODE_ENV=production.",
        path: ["STORAGE_PROVIDER"],
      });
    }

    if (config.STORAGE_PROVIDER === "azure-blob" && !config.AZURE_STORAGE_ACCOUNT_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "STORAGE_PROVIDER=azure-blob requires AZURE_STORAGE_ACCOUNT_URL (managed identity auth).",
        path: ["AZURE_STORAGE_ACCOUNT_URL"],
      });
    }

    // --- Fail-closed rule 5: MCP shared secret must not be the sample value in prod ---
    if (config.NODE_ENV === "production" && config.MCP_SERVER_SHARED_SECRET.includes("dev-only")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Refusing to start: MCP_SERVER_SHARED_SECRET still contains the sample development value.",
        path: ["MCP_SERVER_SHARED_SECRET"],
      });
    }
  });

export type VendorGuardEnv = z.infer<typeof envSchema>;

/**
 * Parses and validates process.env. Throws synchronously on any violation
 * so that misconfigured services crash at startup rather than serving
 * traffic in an insecure state.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): VendorGuardEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration, refusing to start:\n${details}`);
  }
  return result.data;
}
