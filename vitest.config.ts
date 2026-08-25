import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/services/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    environment: "node",
    // Service tests need a real DB; never run them in parallel files.
    // `forks` pool with singleFork forces serial execution so each test file
    // gets a clean isolated DB state.
    pool: "forks",
    singleFork: true,
    isolate: false,
    setupFiles: ["./tests/helpers/setup.ts"],
    // Generous timeout for service/integration tests that hit the DB.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@shared": path.resolve(here, "shared"),
      "@": path.resolve(here, "src"),
    },
  },
});
