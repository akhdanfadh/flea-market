/// <reference types="node" />
import { drizzle } from "drizzle-orm/libsql";

import { items, itemTranslations } from "../src/db/schema.ts";
import { loadTursoEnv } from "./_env.ts";

const { url, authToken } = loadTursoEnv();
const db = drizzle({ connection: { url, authToken } });

const existingCount = await db.$count(items);
if (existingCount > 0 && !process.argv.includes("--force")) {
  console.error(`Refusing to seed: items table already has ${existingCount} row(s).`);
  console.error("Pass --force to wipe and reseed: pnpm db:seed -- --force");
  process.exit(1);
}

await db.delete(itemTranslations);
await db.delete(items);

const today = "20260513";

const [fridge] = await db
  .insert(items)
  .values({
    slug: `${today}-mini-fridge-sharp-sjd14f`,
    priceAmount: 8000,
    priceCurrency: "JPY",
    status: "available",
    photos: [],
  })
  .returning();

const [bicycle] = await db
  .insert(items)
  .values({
    slug: `${today}-mama-chari-city-bicycle`,
    priceAmount: 12000,
    priceCurrency: "JPY",
    status: "reserved",
    photos: [],
  })
  .returning();

const [books] = await db
  .insert(items)
  .values({
    slug: `${today}-english-paperback-bundle`,
    priceAmount: null,
    priceCurrency: null,
    status: "available",
    photos: [],
  })
  .returning();

await db.insert(itemTranslations).values([
  {
    itemId: fridge.id,
    language: "en",
    title: "Sharp 137L Mini Fridge (SJ-D14F-W)",
    description:
      "Two-door white fridge, four years old, lightly used. Quiet compressor, freezer separated from the main compartment. Original manual included. Pick up from Aoba-ku, Sendai.",
  },
  {
    itemId: fridge.id,
    language: "id",
    title: "Kulkas Mini Sharp 137L (SJ-D14F-W)",
    description:
      "Kulkas putih dua pintu, umur empat tahun, jarang dipakai. Kompresor senyap, freezer terpisah dari ruang utama. Buku manual asli tersedia. Pengambilan di Aoba-ku, Sendai.",
  },
  {
    itemId: bicycle.id,
    language: "en",
    title: "Mama-chari city bicycle (3-speed)",
    description:
      "Classic Japanese mama-chari with a three-speed internal hub, front basket, and a removable rear child seat. New tires fitted last year. Currently reserved for a viewing on Saturday.",
  },
  {
    itemId: books.id,
    language: "en",
    title: "English paperback bundle (10 novels)",
    description:
      "Mixed literary and detective fiction. Ten paperbacks, all in good condition. Free to a good home; just collect from the Sendai station area.",
  },
  {
    itemId: books.id,
    language: "id",
    title: "Paket buku berbahasa Inggris (10 novel)",
    description:
      "Campuran fiksi sastra dan detektif. Sepuluh buku saku dalam kondisi baik. Gratis untuk yang berminat; ambil di sekitar Stasiun Sendai.",
  },
]);

console.log("Seeded 3 items and 5 translations.");
