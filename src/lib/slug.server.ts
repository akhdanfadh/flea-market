import { and, eq, like, ne, or } from "drizzle-orm";

import { getDb } from "@/db/client.ts";
import { items } from "@/db/schema.ts";

type Db = ReturnType<typeof getDb>;
// The Drizzle tx passed into `db.transaction(async (tx) => ...)` has the
// same query-builder surface as the top-level Db. Extracting its type
// here lets `generateUniqueSlug` accept either - call it with `tx` inside
// a transaction to shrink the probe-to-write race window.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Race-tolerant only at single-admin scale. Even with the probe inside a
// transaction, two committers can each pass their probe and only collide
// at commit (SQLite's serial-write semantics don't help when both txns
// read first then write). Pair the calling transaction with
// `withSlugErrorWrap` so a UNIQUE collision surfaces as a friendly
// message rather than the raw libsql error.
export async function generateUniqueSlug(
  desired: string,
  db: Db | Tx,
  excludeId?: string,
): Promise<string> {
  // Single round-trip: fetch all slugs that could be the desired one or any
  // of its `desired-N` probe variants. `like` may over-match (e.g. an
  // unrelated `desired-foo`), but the exact-string check below is still
  // correct - we only care about set membership.
  const conditions = and(
    or(eq(items.slug, desired), like(items.slug, `${desired}-%`)),
    excludeId ? ne(items.id, excludeId) : undefined,
  );
  const rows = await db.select({ slug: items.slug }).from(items).where(conditions);
  const taken = new Set(rows.map((r) => r.slug));

  if (!taken.has(desired)) return desired;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a unique slug variant of '${desired}'`);
}

// Wrap any DB operation that may surface a UNIQUE-constraint collision on
// items.slug. Translates the raw libsql error into a friendly message;
// other errors pass through unchanged. Use at the outermost layer of an
// admin handler that touches the slug column.
export async function withSlugErrorWrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isSlugUniqueError(err)) {
      throw new Error("That slug is already taken. Please pick a different one.");
    }
    throw err;
  }
}

// Detect a UNIQUE-collision on items.slug. Code-based detection isn't
// reliable across libsql transports: the local sqlite3 path sets
// `code = "SQLITE_CONSTRAINT"` with `extendedCode = "SQLITE_CONSTRAINT_UNIQUE"`,
// while the Turso HTTP/Hrana path leaves `extendedCode` undefined and
// only populates `code` from the protocol envelope (see `mapHranaError`
// in @libsql/client/lib-cjs/hrana.js; there's a TODO to parse the
// extended code once SQL-over-HTTP supports it). The canonical SQLite
// error *message* - "UNIQUE constraint failed: items.slug" - is
// stable across both transports because it comes from SQLite itself
// and libsql preserves it. That's the signal we match on.
function isSlugUniqueError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("UNIQUE constraint failed: items.slug");
}
