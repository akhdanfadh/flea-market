import * as schema from "#/db/schema.ts";
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/libsql";

export function getDb() {
  return drizzle({
    connection: {
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    },
    schema,
  });
}
