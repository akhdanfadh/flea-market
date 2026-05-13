/// <reference types="node" />
import { drizzle } from "drizzle-orm/libsql";

import { items, itemTranslations } from "../src/db/schema.ts";
import { loadTursoEnv } from "./_env.ts";

const { url, authToken } = loadTursoEnv();
const db = drizzle({ connection: { url, authToken } });

const allItems = await db.select().from(items);
const allTranslations = await db.select().from(itemTranslations);

console.log(`Items: ${allItems.length}`);
for (const i of allItems) {
  const price = i.priceAmount === null ? "FREE" : `${i.priceCurrency} ${i.priceAmount}`;
  console.log(`  - ${i.slug} [${i.status}] ${price}`);
}
console.log(`Translations: ${allTranslations.length}`);
for (const t of allTranslations) {
  console.log(`  - ${t.itemId.slice(0, 8)} [${t.language}] ${t.title}`);
}
