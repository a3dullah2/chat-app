// Prisma client shared with the main project (same SQLite database file).
// The generated client lives in the main project's node_modules; importing it
// relatively keeps a single source of truth for the schema.

import { PrismaClient } from "../../node_modules/@prisma/client";

export const db = new PrismaClient();
