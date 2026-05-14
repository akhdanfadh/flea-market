import type { DetailItem } from "#/components/detail-content.tsx";
import type { Item } from "#/db/schema.ts";

// Shared serializer for the wire shape of an item. Both the list loader and the
// detail loader produce this so the modal (which renders DetailContent from the
// list's loader payload) and the standalone /$slug/ route stay in lockstep.
// Timestamps are omitted - the list page only uses createdAt for SQL ordering,
// and no consumer reads them after that point. Add them back here when a real
// caller surfaces (admin index sort-by-date, "Posted X days ago" badge, etc.).
export function serializeItem(item: Item): DetailItem {
  return {
    id: item.id,
    slug: item.slug,
    priceAmount: item.priceAmount,
    priceCurrency: item.priceCurrency,
    status: item.status,
    photos: item.photos,
  };
}
