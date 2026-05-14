import { z } from "zod";

import { SLUG_PATTERN } from "@/lib/slug.ts";

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
