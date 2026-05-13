/// <reference types="node" />
import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile(".dev.vars");
} catch {
  console.error(
    "Missing .dev.vars. Copy .dev.vars.example and fill in TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.",
  );
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be set in .dev.vars");
  process.exit(1);
}

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  dbCredentials: { url, authToken },
});
