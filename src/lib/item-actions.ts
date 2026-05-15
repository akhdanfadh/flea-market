import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client.ts";
import { ITEM_STATUSES, items } from "@/db/schema.ts";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/auth.server.ts";
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
// across the two route files.
//
// Why this file works despite the import-protection plugin: the plugin
// blocks imports of `*.server.ts` from client-environment files unless
// every usage of the imported identifier is inside a
// `createServerFn(...).handler(...)` or `createMiddleware(...).server(...)`
// body. This file imports `isAdminSession` (etc.) from `auth.server.ts`
// and only references them inside `.handler(...)` callbacks below. The
// AST analyzer accepts that pattern. The route files in turn import
// from this non-`.server.ts` module without restriction.

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
  .inputValidator(z.object({ id: itemIdSchema, status: z.enum(ITEM_STATUSES) }))
  .handler(async ({ data }) => {
    if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
      throw redirect({ to: "/admin/login/" });
    }
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
