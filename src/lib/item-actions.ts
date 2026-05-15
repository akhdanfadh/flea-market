import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client.ts";
import { ITEM_STATUSES, items } from "@/db/schema.ts";
import { requireAdmin } from "@/lib/auth-middleware.ts";
import { itemIdSchema } from "@/lib/item-schema.ts";

// Shared error message thrown by every admin server fn that does a
// row-existence check before mutating. Exported so the wording can change
// in one place rather than drifting across each `throw new Error(...)`
// site that previously inlined the same string.
export const ITEM_NOT_FOUND_ERROR = "Item not found (it may have been deleted already)";

// Shared status-mutation server fn used by both the admin table row
// (`/admin/_auth/index.tsx`) and the edit page header
// (`/admin/_auth/$slug/edit.tsx`). Keeping it in one place avoids drift
// between the two call sites - it was previously duplicated byte-for-byte
// across the two route files. The non-`.server.ts` filename matters: it
// lets both route files import this handler without tripping the
// import-protection plugin, because nothing in this module references
// server-only modules directly (auth lives in `requireAdmin`).
//
// The only invariant on status transitions is the photo gate: a draft
// can leave draft state only if it has at least one photo. Going back to
// draft (any -> draft) is always allowed - that's the unpublish path,
// available even for recovery on a published row that somehow ended up
// photoless. Transitions among the published statuses (available <->
// reserved <-> sold) are free, since they're the admin's call.
//
// The StatusSelect dropdown disables blocked menu items so the click
// can't fire, but this server-side check is the actual enforcement:
// a curl against this fn cannot bypass the gate.
export const setItemStatus = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(z.object({ id: itemIdSchema, status: z.enum(ITEM_STATUSES) }))
  .handler(async ({ data }) => {
    const db = getDb();
    const found = await db
      .select({ status: items.status, photos: items.photos })
      .from(items)
      .where(eq(items.id, data.id))
      .limit(1);
    const row = found[0];
    if (!row) throw new Error(ITEM_NOT_FOUND_ERROR);
    if (row.status === "draft" && data.status !== "draft" && row.photos.length === 0) {
      throw new Error("Add at least one photo before publishing.");
    }
    await db.update(items).set({ status: data.status }).where(eq(items.id, data.id));
  });
