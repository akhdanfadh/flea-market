import { drizzle } from "drizzle-orm/libsql";
import { nanoid } from "nanoid";
import { readFile } from "node:fs/promises";

import { items, itemTranslations } from "../src/db/schema.ts";
import { loadTursoEnv } from "./_env.ts";
import { openR2 } from "./_r2.ts";

const { url, authToken } = loadTursoEnv();
const isRemote = process.env.DB_REMOTE === "1";
const target = isRemote ? `PROD (${url})` : `LOCAL (${url})`;
const db = drizzle({ connection: { url, authToken } });

console.log(`Seeding into ${target}`);

const existingCount = await db.$count(items);
if (existingCount > 0 && isRemote && !process.argv.includes("--force")) {
  console.error(`Refusing to seed PROD: items table already has ${existingCount} row(s).`);
  console.error("Pass --force to wipe and reseed: DB_REMOTE=1 pnpm db:seed -- --force");
  process.exit(1);
}

await db.delete(itemTranslations);
await db.delete(items);

const today = "20260513";

// Mint nanoid ids up front so the photo keys (which encode the item id
// as the R2 path prefix, matching the upload endpoint) can be assembled
// before insert.
const fridgeId = nanoid(12);
const bicycleId = nanoid(12);
const booksId = nanoid(12);
const kotatsuId = nanoid(12);

// Spread across all three public statuses (available / reserved / sold)
// and both price tiers (paid / free) so every render path on the list
// and detail pages has a real seed row to exercise. Fridge carries
// multiple photos to demonstrate the carousel. Bicycle stays photoless
// + en-only to keep the no-photo and EN-fallback paths covered.

await db.insert(items).values([
  {
    id: fridgeId,
    slug: `${today}-mini-fridge-sharp-sjd14f`,
    priceAmount: 8000,
    priceCurrency: "JPY",
    status: "available",
    photos: [
      { key: `${fridgeId}/seed-1.jpg`, alt: "Closed fridge front" },
      { key: `${fridgeId}/seed-2.jpg`, alt: "Fridge interior with shelves" },
    ],
  },
  {
    id: bicycleId,
    slug: `${today}-mama-chari-city-bicycle`,
    priceAmount: 12000,
    priceCurrency: "JPY",
    status: "reserved",
    photos: [],
  },
  {
    id: booksId,
    slug: `${today}-english-paperback-bundle`,
    priceAmount: null,
    priceCurrency: null,
    status: "available",
    photos: [{ key: `${booksId}/seed-1.jpg`, alt: "Stacked paperbacks" }],
  },
  {
    id: kotatsuId,
    slug: `${today}-kotatsu-with-futon`,
    priceAmount: 5000,
    priceCurrency: "JPY",
    status: "sold",
    photos: [{ key: `${kotatsuId}/seed-1.jpg`, alt: "Kotatsu table with futon" }],
  },
]);

await db.insert(itemTranslations).values([
  {
    itemId: fridgeId,
    language: "en",
    title: "Sharp 137L Mini Fridge (SJ-D14F-W)",
    description:
      "Two-door white fridge, four years old, lightly used. Quiet compressor, freezer separated from the main compartment. Original manual included. Pick up from Aoba-ku, Sendai.",
  },
  {
    itemId: fridgeId,
    language: "id",
    title: "Kulkas Mini Sharp 137L (SJ-D14F-W)",
    description:
      "Kulkas putih dua pintu, umur empat tahun, jarang dipakai. Kompresor senyap, freezer terpisah dari ruang utama. Buku manual asli tersedia. Pengambilan di Aoba-ku, Sendai.",
  },
  {
    itemId: bicycleId,
    language: "en",
    title: "Mama-chari city bicycle (3-speed)",
    description:
      "Classic Japanese mama-chari with a three-speed internal hub, front basket, and a removable rear child seat. New tires fitted last year. Currently reserved for a viewing on Saturday.",
  },
  {
    itemId: booksId,
    language: "en",
    title: "English paperback bundle (10 novels)",
    description:
      "Mixed literary and detective fiction. Ten paperbacks, all in good condition. Free to a good home; just collect from the Sendai station area.",
  },
  {
    itemId: booksId,
    language: "id",
    title: "Paket buku berbahasa Inggris (10 novel)",
    description:
      "Campuran fiksi sastra dan detektif. Sepuluh buku saku dalam kondisi baik. Gratis untuk yang berminat; ambil di sekitar Stasiun Sendai.",
  },
  {
    itemId: kotatsuId,
    language: "en",
    title: "Kotatsu heated table with futon (75cm)",
    description:
      "Compact 75cm-square kotatsu with the matching futon and heater unit. Used two winters; warms up quickly and the futon is lint-rolled clean. Already sold to a neighbor, scheduled for pickup this weekend.",
  },
  {
    itemId: kotatsuId,
    language: "id",
    title: "Meja kotatsu dengan futon (75 cm)",
    description:
      "Kotatsu kompak 75x75 cm dengan futon dan unit pemanasnya. Dipakai dua musim dingin; cepat panas, futon bersih. Sudah terjual ke tetangga, akan diambil akhir pekan ini.",
  },
]);

console.log(`Seeded 4 items and 7 translations into ${target}.`);

const uploads: Array<{ key: string; file: string }> = [
  { key: `${fridgeId}/seed-1.jpg`, file: "fixtures/seed-mini-fridge.jpg" },
  { key: `${fridgeId}/seed-2.jpg`, file: "fixtures/seed-mini-fridge-2.jpg" },
  { key: `${booksId}/seed-1.jpg`, file: "fixtures/seed-paperbacks.jpg" },
  { key: `${kotatsuId}/seed-1.jpg`, file: "fixtures/seed-kotatsu.jpg" },
];

console.log(`Uploading fixture photos to ${isRemote ? "PROD" : "LOCAL"} R2:`);
const r2 = await openR2();
try {
  for (const { key, file } of uploads) {
    try {
      const body = await readFile(file);
      await r2.put(key, body, "image/jpeg");
      console.log(`  ${key}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.warn(`  skip ${key}: ${file} not found`);
      } else {
        console.error(`  failed: ${key}`);
      }
    }
  }
} finally {
  await r2.dispose();
}
console.log("Stale photos from previous seeds are not removed; run `pnpm r2:prune` to clean up.");
