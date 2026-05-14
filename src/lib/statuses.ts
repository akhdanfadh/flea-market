import type { ItemStatus } from "@/db/schema.ts";

// Subset of ITEM_STATUSES that the public site renders and accepts as a URL
// filter value. Drafts are admin-only; PUBLIC_STATUSES is the type to use
// for public-side enums (filter chips, search params, anywhere a visitor's
// input touches the status). The `satisfies` clause enforces subset-of-
// ItemStatus at the type level - adding a new admin-only status to the
// schema enum can't accidentally leak into public schemas.
export const PUBLIC_STATUSES = [
  "available",
  "reserved",
  "sold",
] as const satisfies ReadonlyArray<ItemStatus>;
export type PublicItemStatus = (typeof PUBLIC_STATUSES)[number];

// Human-readable labels for each status, shared between the public list
// filter chips and the admin dropdown/badge UI. Single source of truth so
// label edits don't drift; adding a new ITEM_STATUSES entry fails to
// typecheck here until labeled.
export const STATUS_LABEL: Record<ItemStatus, string> = {
  draft: "Draft",
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
};
