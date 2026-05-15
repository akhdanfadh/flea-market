/// <reference types="node" />
export function loadTursoEnv(): { url: string; authToken: string } {
  // `DB_REMOTE=1` flips scripts to .dev.vars.prod so seed/check target the
  // production Turso DB. Without it, scripts hit the local `turso dev`
  // server defined in .dev.vars.
  // NOTE: the env-file selection + `isRemoteUrl` guardrail is duplicated in
  // drizzle.config.ts (drizzle-kit reads that, Node scripts read this,
  // neither can easily import the other). Keep them in sync.
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
  return { url, authToken };
}

function isRemoteUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
  } catch {
    return false;
  }
}
