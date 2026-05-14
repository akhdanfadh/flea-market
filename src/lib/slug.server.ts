import { and, eq, like, ne, or } from "drizzle-orm";

import { getDb } from "@/db/client.ts";
import { items } from "@/db/schema.ts";

type Db = ReturnType<typeof getDb>;

// Race-tolerant only at single-admin scale: two simultaneous saves of the
// same slug can both probe and both think they're free. The DB UNIQUE index
// on slug catches the loser; today the raw `UNIQUE constraint failed`
// message surfaces in the toast description. NOTE: if real collisions happen
// in practice, catch the `LibsqlError` with `.code === "SQLITE_CONSTRAINT_UNIQUE"`
// in the calling handler and rethrow with a friendlier "Slug taken; try again"
// message.
export async function generateUniqueSlug(
  desired: string,
  db: Db,
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
