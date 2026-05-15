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

// Mint nanoid ids up front so the R2 photo keys (which encode the item id as
// the path prefix, matching the upload endpoint) can be assembled before the
// insert.
const fridgeId = nanoid(12);
const kotatsuId = nanoid(12);
const bicycleId = nanoid(12);
const booksId = nanoid(12);
const cookerId = nanoid(12);
const deskId = nanoid(12);
const jacketId = nanoid(12);
const bundleId = nanoid(12);

// Eight items chosen so every catalog render path has a real row behind it:
//   - status:    2 draft + 4 available + 1 reserved + 1 sold
//   - photos:    counts of 0, 1, 2, 3, 4, 5 - exercises carousel + thumb row
//   - price:     JPY (mixed), USD (non-default currency), and free (null)
//   - lang:      mix of en+id and en-only; two long-form bodies with inline
//                Japanese to load the Noto Sans JP path on the detail page
//   - slug:      one slug deliberately edited away from the auto-derived form
//                (jacket) to mirror the admin "Edit slug" affordance
//   - alt text:  a few photos omit alt so the optional-alt branch renders
//   - createdAt: spread across the last ~3 weeks so the default newest-first
//                sort has signal instead of a single timestamp

await db.insert(items).values([
  {
    id: fridgeId,
    slug: "20260512-mini-fridge-sharp-sjd14f",
    priceAmount: 8000,
    priceCurrency: "JPY",
    status: "available",
    photos: [
      { key: `${fridgeId}/seed-1.jpg`, alt: "Two-door fridge front, closed" },
      { key: `${fridgeId}/seed-2.jpg`, alt: "Both doors open, empty interior" },
      { key: `${fridgeId}/seed-3.jpg`, alt: "Freezer compartment, top-down view" },
      { key: `${fridgeId}/seed-4.jpg` },
    ],
    createdAt: new Date("2026-05-12T10:00:00Z"),
  },
  {
    id: kotatsuId,
    slug: "20260422-kotatsu-with-futon",
    priceAmount: 5000,
    priceCurrency: "JPY",
    status: "sold",
    photos: [
      { key: `${kotatsuId}/seed-1.jpg`, alt: "Kotatsu set up with futon draped" },
      { key: `${kotatsuId}/seed-2.jpg`, alt: "Underside showing the heater unit" },
      { key: `${kotatsuId}/seed-3.jpg` },
    ],
    createdAt: new Date("2026-04-22T09:00:00Z"),
  },
  {
    id: bicycleId,
    slug: "20260510-mama-chari-3-speed",
    priceAmount: 12000,
    priceCurrency: "JPY",
    status: "reserved",
    photos: [
      { key: `${bicycleId}/seed-1.jpg`, alt: "Mama-chari, side view" },
      { key: `${bicycleId}/seed-2.jpg`, alt: "Rear child seat and shifter" },
    ],
    createdAt: new Date("2026-05-10T15:00:00Z"),
  },
  {
    id: booksId,
    slug: "20260513-english-paperback-bundle",
    priceAmount: null,
    priceCurrency: null,
    status: "available",
    photos: [
      { key: `${booksId}/seed-1.jpg`, alt: "Two stacks of paperbacks, spines out" },
      { key: `${booksId}/seed-2.jpg`, alt: "Same books fanned out flat" },
    ],
    createdAt: new Date("2026-05-13T18:00:00Z"),
  },
  {
    id: cookerId,
    slug: "20260514-zojirushi-rice-cooker-nsllh05",
    priceAmount: 6500,
    priceCurrency: "JPY",
    status: "available",
    photos: [
      { key: `${cookerId}/seed-1.jpg`, alt: "Rice cooker, front view on counter" },
      { key: `${cookerId}/seed-2.jpg`, alt: "Lid open, inner pot visible" },
      { key: `${cookerId}/seed-3.jpg`, alt: "Inner pot removed beside body" },
      { key: `${cookerId}/seed-4.jpg`, alt: "Japanese-labelled control panel" },
      { key: `${cookerId}/seed-5.jpg` },
    ],
    createdAt: new Date("2026-05-14T12:00:00Z"),
  },
  {
    id: deskId,
    slug: "20260515-ikea-malm-desk-white",
    priceAmount: 3000,
    priceCurrency: "JPY",
    status: "draft",
    photos: [{ key: `${deskId}/seed-1.jpg`, alt: "Partially assembled white desk" }],
    createdAt: new Date("2026-05-15T08:00:00Z"),
  },
  {
    // Slug is intentionally shorter than slugifyTitle would produce (the full
    // title would auto-derive `20260430-uniqlo-ultra-light-down-jacket-size-m`).
    // Mirrors the admin "Edit slug" affordance.
    id: jacketId,
    slug: "20260430-uniqlo-down-m",
    priceAmount: 4000,
    priceCurrency: "USD",
    status: "available",
    photos: [
      { key: `${jacketId}/seed-1.jpg`, alt: "Navy puffer jacket laid flat" },
      { key: `${jacketId}/seed-2.jpg` },
    ],
    createdAt: new Date("2026-04-30T11:00:00Z"),
  },
  {
    id: bundleId,
    slug: "20260515-moving-sale-bundle",
    priceAmount: null,
    priceCurrency: null,
    status: "draft",
    photos: [],
    createdAt: new Date("2026-05-15T22:00:00Z"),
  },
]);

await db.insert(itemTranslations).values([
  // --- Fridge: long-form, both languages, inline Japanese ---
  {
    itemId: fridgeId,
    language: "en",
    title: "Sharp 137L Mini Fridge (SJ-D14F-W)",
    description: `Sharp's SJ-D14F-W two-door compact refrigerator, 137 liters total - 97L in the fridge compartment and 40L in the separately-sealed freezer above. Bought new in April 2022 from Yamada Denki in Sendai for ¥36,800; selling because we're upsizing to a family unit before our second child arrives.

Dimensions are 480mm (W) × 588mm (D) × 1215mm (H). It fits through a standard genkan and into any kitchen alcove that allows a 50cm-wide footprint. The freezer door is hinged left; the fridge door is reversible (the Sharp manual walks through the swap).

Condition is "lightly used" - compressor still whisper-quiet, interior LED works, both door seals are intact. One cosmetic scratch about 4cm long on the right side panel where it caught a moving cart; not visible once installed against a wall. Both crisper drawers and all three shelves included. Original Sharp manual (Japanese) is in the box; an English quick-start sheet I made for our exchange-student housemate is paperclipped inside.

Pickup only from Aoba-ku, Sendai (5 minutes from 仙台駅 east exit). I can help carry it down to the street and load it into a car or kei-van, but I don't have a vehicle for delivery. Available weekday evenings after 19:00 and most of the weekend. Please bring blankets or pads - the side panels mark easily.

Energy rating A, roughly ¥7,800/year at the Tohoku Electric average rate.`,
  },
  {
    itemId: fridgeId,
    language: "id",
    title: "Kulkas Mini Sharp 137L (SJ-D14F-W)",
    description: `Kulkas mini dua pintu Sharp SJ-D14F-W, total 137 liter - 97L untuk ruang pendingin dan 40L untuk freezer yang terpisah di bagian atas. Dibeli baru April 2022 di Yamada Denki Sendai seharga ¥36.800; dijual karena kami akan pindah ke unit yang lebih besar sebelum anak kedua lahir.

Dimensi: 480mm (L) × 588mm (P) × 1215mm (T). Muat lewat genkan standar dan masuk ke sudut dapur dengan lebar minimal 50cm. Pintu freezer engsel kiri; pintu kulkas reversible (panduan penggantian engsel ada di buku manual Sharp).

Kondisi "jarang dipakai" - kompresor tetap hening, lampu LED interior berfungsi, kedua karet pintu masih rapat. Ada satu goresan kosmetik sekitar 4cm di panel kanan akibat tersangkut troli pindahan; tidak terlihat setelah dipasang menempel dinding. Dua laci sayur dan tiga rak kaca disertakan. Buku manual asli (bahasa Jepang) tersimpan di kotak; lembar quick-start bahasa Inggris yang saya buatkan untuk teman serumah dari program pertukaran masih ditempel di dalam pintu.

Pengambilan saja di Aoba-ku, Sendai (5 menit dari 仙台駅 pintu timur). Saya bisa bantu mengangkat ke pinggir jalan dan memuatkannya ke mobil atau kei-van, tapi tidak ada kendaraan untuk pengantaran. Tersedia hari kerja malam setelah jam 19:00 dan sebagian besar akhir pekan. Mohon bawa kain selimut atau bantalan - panel sampingnya mudah lecet.

Peringkat energi A, kira-kira ¥7.800/tahun dengan tarif rata-rata Tohoku Electric.`,
  },

  // --- Kotatsu: sold, both languages, inline Japanese for the term itself ---
  {
    itemId: kotatsuId,
    language: "en",
    title: "Kotatsu heated table with futon set (75cm)",
    description: `Compact 75cm-square kotatsu (コタツ, 炬燵) with the matching shitagake under-blanket and uwagake over-quilt - the full set. Walnut-stained top, removable so you can swap between winter (heater on, futon underneath) and summer (just a low coffee table). The 600W heater unit is the standard screw-in type; we used it through two Tohoku winters and it warmed the under-space within a couple of minutes on the lower setting.

Already sold to a neighbour who's picking up this Saturday - leaving the listing visible so the next person searching "kotatsu Sendai" knows roughly what to expect on the second-hand market.`,
  },
  {
    itemId: kotatsuId,
    language: "id",
    title: "Meja Kotatsu dengan set futon (75 cm)",
    description: `Kotatsu kompak 75x75 cm (コタツ, 炬燵) lengkap dengan shitagake (selimut bawah) dan uwagake (selimut atas) - satu set utuh. Permukaan kayu warna walnut, bisa dilepas supaya bisa diganti mode: musim dingin (pemanas nyala, futon di bawah meja) atau musim panas (sekedar meja rendah). Unit pemanas 600W tipe sekrup standar; kami pakai dua musim dingin di Tohoku dan ruang bawah meja terasa hangat dalam beberapa menit di setelan rendah.

Sudah terjual ke tetangga yang akan ambil Sabtu ini - listing dibiarkan terlihat supaya pencari "kotatsu Sendai" berikutnya tahu kisaran harga di pasar bekas.`,
  },

  // --- Bicycle: reserved, en-only (exercises the no-id-fallback path) ---
  {
    itemId: bicycleId,
    language: "en",
    title: "Mama-chari city bicycle (3-speed, with child seat)",
    description: `Classic Japanese mama-chari city bicycle (ママチャリ) with a Shimano 3-speed internal hub, front wicker-style basket, and a removable rear child seat with seatbelt straps. Step-through frame in faded mint green; comfortable for riders 150-175cm. New tires fitted in 2025 and the chain was re-greased last month - rolls quietly with no slipping.

Currently reserved for a viewing this Saturday afternoon. If that buyer doesn't take it I'll mark the listing available again on Sunday evening.

Pickup from Aoba-ku, Sendai. The bicycle registration sticker (防犯登録) is current through 2027 and I'll transfer it at handover.`,
  },

  // --- Paperback bundle: free, both languages ---
  {
    itemId: booksId,
    language: "en",
    title: "English paperback bundle (10 novels)",
    description: `Ten English-language paperback novels - mixed literary fiction, detective stories, one science-fiction omnibus. Picked them up from the secondhand shelf at the international centre over the past two years; all readable, a few spines a little loose, none missing pages.

Free to a good home. I'd rather they go back into circulation than into the 古紙回収 (paper recycling) bin. Just collect from the Sendai station area; I'm there most weekdays around lunchtime.`,
  },
  {
    itemId: booksId,
    language: "id",
    title: "Paket buku berbahasa Inggris (10 novel)",
    description: `Sepuluh novel saku berbahasa Inggris - campuran fiksi sastra, kisah detektif, dan satu omnibus fiksi ilmiah. Saya kumpulkan dari rak bekas di international centre selama dua tahun terakhir; semuanya masih bisa dibaca, beberapa punggung buku agak longgar, tidak ada halaman hilang.

Gratis untuk yang berminat. Lebih baik beredar lagi daripada masuk tempat 古紙回収 (daur ulang kertas). Ambil di sekitar Stasiun Sendai; saya hampir selalu di sana hari kerja waktu makan siang.`,
  },

  // --- Rice cooker: long-form, both languages, heavy Japanese inline ---
  {
    itemId: cookerId,
    language: "en",
    title: "Zojirushi 3-cup micom rice cooker (NS-LLH05)",
    description: `Zojirushi 象印 NS-LLH05 micom rice cooker, 3-cup capacity (0.54 liter). Bought in October 2023, used roughly four times a week - well within its expected service life. The non-stick inner pot has very faint surface scratches from a plastic paddle (no chips, no peeling); a fresh replacement pot from Zojirushi runs about ¥4,500 if you want a like-new one later.

Eight cooking modes, all labelled in Japanese on the control panel: 白米 (white rice), 玄米 (brown rice), おかゆ (porridge), 炊込み (mixed rice), 早炊き (quick cook), 無洗米 (no-rinse rice), 予約 (timer), 保温 (keep warm). The timer goes up to 13 hours, which has been reliable for setting it before work. The internal clock will reset if unplugged for more than ~30 seconds; the backup battery in ours stopped holding charge around year one - not a deal-breaker, just resetting takes 20 seconds.

Comes with the original rice paddle, the measuring cup (one Japanese 合 = 180ml, not a US cup), and the steam vent cap. The power cord is the standard removable JIS C 8303 type - same plug as most kitchen appliances, not the magnetic kind. PSE-certified for Japanese 100V mains only; will not work safely abroad without a step-up transformer.

Pickup from Aoba-ku, Sendai, or I can drop it off if you're within walking distance of 仙台駅.`,
  },
  {
    itemId: cookerId,
    language: "id",
    title: "Rice cooker Zojirushi 3 合 micom (NS-LLH05)",
    description: `Rice cooker Zojirushi 象印 NS-LLH05 micom, kapasitas 3 合 (0,54 liter). Dibeli Oktober 2023, dipakai kira-kira empat kali seminggu - masih jauh dari usia pakainya. Panci dalam anti-lengket ada goresan halus dari centong plastik (tidak ada serpihan, tidak mengelupas); panci pengganti baru dari Zojirushi sekitar ¥4.500 kalau nanti mau seperti baru lagi.

Delapan mode masak, semuanya berlabel bahasa Jepang di panel kontrol: 白米 (nasi putih), 玄米 (beras merah), おかゆ (bubur), 炊込み (nasi campur), 早炊き (cepat), 無洗米 (beras tanpa bilas), 予約 (timer), 保温 (penghangat). Timer bisa sampai 13 jam, andal untuk diset sebelum berangkat kerja. Jam internal akan reset kalau dicabut lebih dari ~30 detik; baterai cadangan di unit kami sudah tidak menyimpan setrum sejak tahun pertama - bukan masalah besar, hanya perlu 20 detik untuk set ulang.

Termasuk centong nasi asli, gelas takar (1 合 Jepang = 180ml, bukan ukuran cup AS), dan tutup ventilasi uap. Kabel daya tipe JIS C 8303 standar yang bisa dilepas - colokan yang sama dengan kebanyakan alat dapur, bukan tipe magnetik. Bersertifikat PSE untuk listrik 100V Jepang saja; tidak aman dipakai di luar negeri tanpa step-up transformer.

Pengambilan di Aoba-ku, Sendai, atau saya bisa antarkan kalau Anda dalam jarak jalan kaki dari 仙台駅.`,
  },

  // --- Desk: draft, en-only (admin-only state) ---
  {
    itemId: deskId,
    language: "en",
    title: "IKEA Malm-style white desk (140 × 65 cm)",
    description: `White flat-pack desk in the Malm shape, 140 × 65 cm with a single drawer. Disassembled; all hardware in the included bag. Photo is mid-assembly because I haven't finished cleaning the top yet - listing as draft until then.`,
  },

  // --- Jacket: USD price, both languages, short-form ---
  {
    itemId: jacketId,
    language: "en",
    title: "Uniqlo Ultra Light Down jacket (Men's M, navy)",
    description: `Uniqlo Ultra Light Down jacket in navy, men's size M (chest 96cm, length 67cm). Worn one Sendai winter, dry-cleaned at the end of the season; stored in the original mesh pouch. Compresses small for layering or travel.

There's a tiny faint mark on the left cuff that didn't come out fully in cleaning - visible if you look for it, not noticeable when worn. Otherwise no rips, no down leaking, zipper smooth in both directions.

Priced in USD because I'm shipping it to a friend in Berkeley if no local buyer takes it by Friday; the listed price covers local Sendai pickup at par.`,
  },
  {
    itemId: jacketId,
    language: "id",
    title: "Jaket Uniqlo Ultra Light Down (Pria M, navy)",
    description: `Jaket Uniqlo Ultra Light Down warna navy, ukuran pria M (lingkar dada 96cm, panjang 67cm). Dipakai satu musim dingin di Sendai, dicuci kering di akhir musim; disimpan dalam pouch jaring aslinya. Bisa dipadatkan kecil untuk layering atau bepergian.

Ada noda samar di manset kiri yang tidak hilang sepenuhnya saat dicuci - terlihat kalau diperhatikan, tidak kentara saat dipakai. Selain itu tidak ada sobekan, tidak ada bulu keluar, ritsleting halus dua arah.

Harga dalam USD karena akan saya kirim ke teman di Berkeley kalau tidak ada pembeli lokal sampai Jumat; harga tertera setara dengan pengambilan langsung di Sendai.`,
  },

  // --- Bundle: draft, en-only, short-form ---
  {
    itemId: bundleId,
    language: "en",
    title: "Moving-out misc bundle",
    description: `Moving out late May, posting a misc bundle once I've sorted what's actually going. Kitchen things, a few houseplants, maybe the rug. Will update with photos and a price by next week.`,
  },
]);

console.log(`Seeded 8 items and 13 translations into ${target}.`);

const uploads: Array<{ key: string; file: string }> = [
  { key: `${fridgeId}/seed-1.jpg`, file: "fixtures/seed-mini-fridge-1.jpg" },
  { key: `${fridgeId}/seed-2.jpg`, file: "fixtures/seed-mini-fridge-2.jpg" },
  { key: `${fridgeId}/seed-3.jpg`, file: "fixtures/seed-mini-fridge-3.jpg" },
  { key: `${fridgeId}/seed-4.jpg`, file: "fixtures/seed-mini-fridge-4.jpg" },
  { key: `${kotatsuId}/seed-1.jpg`, file: "fixtures/seed-kotatsu-1.jpg" },
  { key: `${kotatsuId}/seed-2.jpg`, file: "fixtures/seed-kotatsu-2.jpg" },
  { key: `${kotatsuId}/seed-3.jpg`, file: "fixtures/seed-kotatsu-3.jpg" },
  { key: `${bicycleId}/seed-1.jpg`, file: "fixtures/seed-bicycle-1.jpg" },
  { key: `${bicycleId}/seed-2.jpg`, file: "fixtures/seed-bicycle-2.jpg" },
  { key: `${booksId}/seed-1.jpg`, file: "fixtures/seed-paperbacks-1.jpg" },
  { key: `${booksId}/seed-2.jpg`, file: "fixtures/seed-paperbacks-2.jpg" },
  { key: `${cookerId}/seed-1.jpg`, file: "fixtures/seed-rice-cooker-1.jpg" },
  { key: `${cookerId}/seed-2.jpg`, file: "fixtures/seed-rice-cooker-2.jpg" },
  { key: `${cookerId}/seed-3.jpg`, file: "fixtures/seed-rice-cooker-3.jpg" },
  { key: `${cookerId}/seed-4.jpg`, file: "fixtures/seed-rice-cooker-4.jpg" },
  { key: `${cookerId}/seed-5.jpg`, file: "fixtures/seed-rice-cooker-5.jpg" },
  { key: `${deskId}/seed-1.jpg`, file: "fixtures/seed-malm-desk-1.jpg" },
  { key: `${jacketId}/seed-1.jpg`, file: "fixtures/seed-jacket-1.jpg" },
  { key: `${jacketId}/seed-2.jpg`, file: "fixtures/seed-jacket-2.jpg" },
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
