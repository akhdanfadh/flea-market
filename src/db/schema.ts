import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type ItemStatus = "available" | "reserved" | "sold";
export type Language = "en" | "id";
export type ItemPhoto = { key: string; alt?: string };

export const items = sqliteTable(
  "items",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    priceAmount: integer("price_amount"),
    priceCurrency: text("price_currency"),
    status: text("status", { enum: ["available", "reserved", "sold"] })
      .notNull()
      .default("available"),
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
    language: text("language", { enum: ["en", "id"] }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
  },
  (table) => [primaryKey({ columns: [table.itemId, table.language] })],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemTranslation = typeof itemTranslations.$inferSelect;
export type NewItemTranslation = typeof itemTranslations.$inferInsert;
