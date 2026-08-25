// Loads env vars from the main project's .env so DATABASE_URL / JWT_SECRET
// are available inside the mini-service process.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadMainEnv(): void {
  try {
    const content = readFileSync(join(here, "../../.env"), "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env is optional when vars come from the real environment.
  }
}

loadMainEnv();
