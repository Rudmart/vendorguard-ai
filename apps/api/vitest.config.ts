import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database integration files share PostgreSQL; serialize files to avoid cumulative timeout contention.
    fileParallelism: false,
    passWithNoTests: true,
    // Test-only signing secret (not a real secret). Production requires SESSION_SECRET.
    env: { SESSION_SECRET: "test-only-session-signing-secret-0123456789" },
  },
});
