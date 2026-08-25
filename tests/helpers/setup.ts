// Global test setup: ensures the test DB exists with the latest schema before
// any test file runs. Service/integration tests all share the same DB; each
// file's setup hook calls resetTestDb() for isolation between files.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const TEST_DB_PATH = path.join(process.cwd(), "db", "test.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Force DATABASE_URL to the test DB for the rest of the test process. This
// MUST happen BEFORE any test file imports a module that constructs a
// PrismaClient (e.g. mini-services/chat-socket/broadcasts.ts, which builds
// its own client at module load). The dev server runs in a separate process
// with its own DATABASE_URL, so this doesn't affect it.
process.env.DATABASE_URL = TEST_DB_URL;

export function setupTestSchema(): void {
  try {
    execSync("bunx prisma db push --skip-generate --accept-data-loss", {
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      cwd: process.cwd(),
    });
  } catch (error) {
    console.error("[setup] prisma db push failed:", (error as Error).message);
    throw error;
  }
}

if (!existsSync(TEST_DB_PATH)) {
  setupTestSchema();
}

// Always re-sync the schema in case it changed since the last run.
try {
  setupTestSchema();
} catch {
  // We'll let individual tests fail with a clearer error if the DB is unusable.
}
