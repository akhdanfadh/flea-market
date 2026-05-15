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

// Tailwind classes for the admin status pickers and chips. Each entry
// overrides the outline variant's `dark:bg-input/30` rule (AGENTS.md
// section 4 rule 9 - a plain `bg-*` loses the cascade against the
// `dark:` variant the base classes carry). Co-located with STATUS_LABEL
// so adding a status touches one file.
export const STATUS_TRIGGER: Record<ItemStatus, string> = {
  draft:
    "border-zinc-500/30 bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/25 hover:text-zinc-200 dark:bg-zinc-500/15 dark:hover:bg-zinc-500/25",
  available:
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25",
  reserved:
    "border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25",
  sold: "border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200 dark:bg-rose-500/15 dark:hover:bg-rose-500/25",
};
