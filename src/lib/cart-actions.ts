import { createServerFn } from "@tanstack/react-start";
import { and, inArray, ne } from "drizzle-orm";
import { z } from "zod";

import type { DetailItem } from "@/components/detail-content.tsx";

import { getDb } from "@/db/client.ts";
import { itemTranslations, items } from "@/db/schema.ts";
import { CART_LIMIT } from "@/lib/cart-constants.ts";
import { getLanguage } from "@/lib/lang.server.ts";
import { serializeItem } from "@/lib/serialize-item.ts";

export type CartRow = {
  item: DetailItem;
  translation: { title: string; description: string };
};

// Visitor-facing slug resolver for the cart drawer. Drafts are filtered at
// SQL; sold/reserved are returned so the drawer can surface state changes
// since the slug was added. The drawer reconciles slugs-vs-returned to
// flag missing rows (draft, deleted) with a banner.
//
// Same two-query shape as `loadList` in src/routes/index.tsx (select items,
// then their translations, JS-join). A JOIN would save no round-trips on
// libsql at this query size and would complicate the mapping.
//
// Photos are truncated to the first entry: the drawer renders only the
// thumbnail (photos[0]) and the full array would be wire-bloat at the
// CART_LIMIT ceiling.
export const getCartItems = createServerFn({ method: "POST" })
  // SLUG_PATTERN caps slugs at 100 chars; .max(120) on the inner string is
  // a generous bound that rejects a malicious client sending 50 multi-MB
  // strings to amplify request size. SQL is parameterized so this isn't
  // about injection - it's about the free amplification factor.
  .inputValidator(z.object({ slugs: z.array(z.string().max(120)).max(CART_LIMIT) }))
  .handler(async ({ data }): Promise<{ rows: CartRow[] }> => {
    // Dedupe before SQL so a malformed client can't surface the same row
    // multiple times in the drawer (the UI Set should already prevent it).
    const requested = Array.from(new Set(data.slugs));
    if (requested.length === 0) return { rows: [] };

    const db = getDb();
    const all = await db
      .select()
      .from(items)
      .where(and(inArray(items.slug, requested), ne(items.status, "draft")));
    if (all.length === 0) return { rows: [] };

    // Language is only needed once we know there's at least one row to
    // resolve translations for - skip the cookie read on the all-empty path.
    const language = getLanguage();
    const ids = all.map((i) => i.id);
    const trs = await db
      .select()
      .from(itemTranslations)
      .where(inArray(itemTranslations.itemId, ids));

    type Trans = (typeof trs)[number];
    const byItem = new Map<string, { en?: Trans; pref?: Trans }>();
    for (const t of trs) {
      let entry = byItem.get(t.itemId);
      if (!entry) {
        entry = {};
        byItem.set(t.itemId, entry);
      }
      if (t.language === "en") entry.en = t;
      if (t.language === language) entry.pref = t;
    }

    // Preserve the visitor's add-order from the request so the drawer reads
    // top-to-bottom in the same sequence they tapped the toggles.
    const bySlug = new Map(all.map((row) => [row.slug, row] as const));
    const rows: CartRow[] = [];
    for (const slug of requested) {
      const row = bySlug.get(slug);
      if (!row) continue;
      const entry = byItem.get(row.id) ?? {};
      const t = entry.pref ?? entry.en;
      const serialized = serializeItem(row);
      rows.push({
        item: { ...serialized, photos: serialized.photos.slice(0, 1) },
        translation: t
          ? { title: t.title, description: t.description }
          : { title: row.slug, description: "" },
      });
    }

    return { rows };
  });
