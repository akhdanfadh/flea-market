/// <reference types="node" />
import { defineConfig } from "drizzle-kit";

// `DB_REMOTE=1` flips drizzle-kit to .dev.vars.prod so commands like
// `db:push` and `db:studio` target the production Turso DB. Without it,
// drizzle-kit talks to the local `turso dev` server defined in .dev.vars.
// NOTE: the env-file selection + `isRemoteUrl` guardrail is duplicated in
// scripts/_env.ts (drizzle-kit reads this config, Node scripts read that
// helper, neither can easily import the other). Keep them in sync.
const envFile = process.env.DB_REMOTE === "1" ? ".dev.vars.prod" : ".dev.vars";

try {
  process.loadEnvFile(envFile);
} catch {
  console.error(
    `Missing ${envFile}. Copy .dev.vars.example to ${envFile} and fill in TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.`,
  );
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN ?? "";

if (!url) {
  console.error(`TURSO_DATABASE_URL must be set in ${envFile}`);
  process.exit(1);
}
if (isRemoteUrl(url) && !authToken) {
  console.error(`Remote URL detected in ${envFile} but TURSO_AUTH_TOKEN is empty.`);
  process.exit(1);
}

function isRemoteUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  dbCredentials: { url, authToken },
});
