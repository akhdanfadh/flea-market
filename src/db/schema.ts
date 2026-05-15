import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";

// `draft` is the admin-only working state - items live here while the admin
// is wiring up photos, prices, descriptions. Public loaders explicitly
// filter `ne(items.status, "draft")` so visitors never see drafts.
// `available` stays as the schema default so any non-form inserts (seed
// script, ad-hoc) still land published; the admin form sets `draft`
// explicitly on Save draft. The public-subset enum + UI labels live in
// `src/lib/statuses.ts`.
export const ITEM_STATUSES = ["draft", "available", "reserved", "sold"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const LANGUAGES = ["en", "id"] as const;
export type Language = (typeof LANGUAGES)[number];

export const CURRENCIES = ["JPY", "IDR", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export type ItemPhoto = { key: string; alt?: string };

export const items = sqliteTable(
  "items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid(12)),
    slug: text("slug").notNull().unique(),
    priceAmount: integer("price_amount"),
    priceCurrency: text("price_currency", { enum: CURRENCIES }),
    status: text("status", { enum: ITEM_STATUSES }).notNull().default("available"),
    photos: text("photos", { mode: "json" }).$type<ItemPhoto[]>().notNull().default([]),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      "items_price_consistency",
      sql`(${table.priceAmount} IS NULL AND ${table.priceCurrency} IS NULL) OR (${table.priceAmount} IS NOT NULL AND ${table.priceCurrency} IS NOT NULL)`,
    ),
  ],
);

export const itemTranslations = sqliteTable(
  "item_translations",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    language: text("language", { enum: LANGUAGES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.language] })],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemTranslation = typeof itemTranslations.$inferSelect;
export type NewItemTranslation = typeof itemTranslations.$inferInsert;
