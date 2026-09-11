import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const repoRoot = path.resolve(__dirname, "../..");
  const env = loadEnv(mode, repoRoot, "");
  return {
    test: {
      env,
      passWithNoTests: true,
    },
  };
});