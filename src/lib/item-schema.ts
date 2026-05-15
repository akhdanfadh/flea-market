import { z } from "zod";

import { CURRENCIES } from "@/db/schema.ts";
import { SLUG_PATTERN } from "@/lib/slug.ts";

// Item id is a UUID generated server-side inside createDraftItem
// (`crypto.randomUUID()`). The pattern accepts hex + hyphens within a
// 1-64 char window so the upload endpoint can refuse path-traversal-y
// shapes before constructing an R2 key, and server fns get the same
// shape check at their input boundary. The existence check in each
// handler is what ultimately matters - mistyped ids 404 either way.
export const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const itemIdSchema = z.string().regex(ITEM_ID_PATTERN, "Invalid item id");

// Minimal payload for "Save draft" on the new-item page. EN translation is
// required; ID is optional (matches the data-model rule that every item has
// at least one en translation). Photos, price, and status are deliberately
// absent - drafts start photoless and priceless, with status implicitly
// `draft` set by the server fn. The combined edit + publish commit adds a
// full `itemPayloadSchema` for the edit form.

// Reasonable upper bounds: titles fit on a list card, descriptions fit in a
// detail-page block. Workers' request-body cap protects us from anything
// pathological; these limits exist to keep the catalog visually consistent
// rather than as security caps.
const translationSchema = z.object({
  title: z.string().trim().min(1, "Required").max(200, "Title must be 200 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(1, "Required")
    .max(5000, "Description must be 5000 characters or fewer"),
});

export const draftItemPayloadSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN, "Lowercase letters, digits, hyphens only (1-100 chars)"),
  translations: z.object({
    en: translationSchema,
    id: translationSchema.optional(),
  }),
});

export type DraftItemPayload = z.infer<typeof draftItemPayloadSchema>;

// Full edit-form payload. Carries everything the metadata form persists -
// slug, translations, and price. Notably absent: `photos` (server state,
// mutated via per-photo server fns) and `status` (changed via the
// `StatusSelect` dropdown, not the Save button). The both-or-neither
// price refinement matches the items table's CHECK constraint - "Free"
// means both fields null; the priced path requires a positive amount so
// the two states stay canonical (an admin who wants "no charge" must use
// the Free toggle, not type 0).
export const itemPayloadSchema = z
  .object({
    slug: z.string().regex(SLUG_PATTERN, "Lowercase letters, digits, hyphens only (1-100 chars)"),
    translations: z.object({
      en: translationSchema,
      id: translationSchema.optional(),
    }),
    priceAmount: z
      .number()
      .int()
      .min(1, "Enter a price greater than zero, or check Free for free items")
      .nullable(),
    priceCurrency: z.enum(CURRENCIES).nullable(),
  })
  .refine(
    (data) =>
      (data.priceAmount === null && data.priceCurrency === null) ||
      (data.priceAmount !== null && data.priceCurrency !== null),
    {
      message: "Price amount and currency must both be set or both null/empty",
      path: ["priceAmount"],
    },
  );

export type ItemPayload = z.infer<typeof itemPayloadSchema>;
