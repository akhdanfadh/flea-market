/// <reference types="node" />

// Deletes R2 objects not referenced by any `items.photos[].key` in the DB.
// Defaults to a dry run; pass `--apply` to actually delete. Local mode
// (default) targets Miniflare's R2 binding; `DB_REMOTE=1` swaps to prod R2
// (S3 API) and reads creds from .dev.vars.prod. See ./_r2.ts for the client.

import { drizzle } from "drizzle-orm/libsql";

import { items } from "../src/db/schema.ts";
import { loadTursoEnv } from "./_env.ts";
import { openR2 } from "./_r2.ts";

const APPLY = process.argv.includes("--apply");
const isRemote = process.env.DB_REMOTE === "1";

const { url, authToken } = loadTursoEnv();
const db = drizzle({ connection: { url, authToken } });

console.log(
  `Pruning ${isRemote ? "PROD" : "LOCAL"} R2 against ${isRemote ? "PROD" : "LOCAL"} DB${APPLY ? "" : " [dry run]"}`,
);

const rows = await db.select({ photos: items.photos }).from(items);
const referenced = new Set<string>();
for (const row of rows) {
  for (const p of row.photos) referenced.add(p.key);
}

// Keys under this prefix are deployer-managed static assets (e.g. the LINE
// QR served at /images/static/line-qr.jpg). They aren't referenced from any
// items.photos row, so the orphan filter would sweep them otherwise.
const STATIC_PREFIX = "static/";

const r2 = await openR2();
try {
  const bucketKeys = await r2.list();
  const orphans = bucketKeys.filter((k) => !referenced.has(k) && !k.startsWith(STATIC_PREFIX));

  console.log(
    `Bucket has ${bucketKeys.length} object(s), ${referenced.size} referenced by DB, ${orphans.length} orphan(s).`,
  );
  for (const key of orphans) console.log(`  ${key}`);

  if (!APPLY) {
    console.log("");
    console.log("Dry run. Re-run with --apply to delete the orphans.");
  } else {
    const deleted = await r2.delete(orphans);
    console.log(`Deleted ${deleted}/${orphans.length} object(s).`);
  }
} finally {
  await r2.dispose();
}
