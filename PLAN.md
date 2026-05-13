# Implementation Plan

A step-by-step plan for building the flea-market app. Each step is a deployable unit; do not start the next step until the previous one is live and verified.

This plan is written for execution with Claude Code. Each step has a clear deliverable, verification criteria, and notes on common pitfalls.

## Prerequisites

Before starting step 1:

- [ ] Cloudflare account with `akhdan.dev` configured as a zone
- [ ] Wrangler CLI installed and authenticated (`wrangler whoami` works)
- [ ] Turso CLI installed and authenticated (`turso auth whoami` works)
- [ ] Node.js 20+ and pnpm installed
- [ ] A new empty GitHub repo created (e.g. `flea-market`)
- [ ] Read `ARCHITECTURE.md` end to end

## Step 1: Scaffold TanStack Start, deploy to a Worker

**Goal**: A blank TanStack Start app deployed to `*.workers.dev`, basepath configured, no domain routing yet.

Tasks:

- Scaffold with the Cloudflare-preconfigured template:

  ```sh
  npm create cloudflare@latest -- flea-market --framework=tanstack-start
  ```

  This installs `@cloudflare/vite-plugin` and wires the `cloudflare({ viteEnvironment: { name: "ssr" } })` plugin **before** the TanStack Start plugin in `vite.config.ts`. Plugin order matters; do not reorder.

- Set the TanStack Router config to `basepath: '/flea-market'`
- Set the Vite config `base: '/flea-market/'` so static asset URLs are correct
- Confirm `wrangler.jsonc` contains:
  - `"main": "@tanstack/react-start/server-entry"`
  - `"compatibility_flags": ["nodejs_compat"]`
  - `"compatibility_date": "2026-05-13"` (pinned; bump deliberately later)
- Add a single home route that displays "Hello, flea market" with a `<Link>` to a second route to verify routing works
- Run `pnpm cf-typegen` to generate `worker-configuration.d.ts` (binds `env.BUCKET`, secrets, vars into the TypeScript type system). Re-run whenever `wrangler.jsonc` bindings change.
- Pin `@tanstack/react-start` to `>= 1.138.0` (Dec 2025). Earlier versions lack the static-prerender behavior the Cloudflare adapter assumes.
- Set up tooling:
  - Install `oxlint` and `oxfmt` as dev deps
  - Add `package.json` scripts: `dev` (`vite dev`), `build` (`vite build`), `deploy` (`vite build && wrangler deploy`), `typecheck` (`tsc --noEmit`), `lint` (`oxlint .`), `lint:fix` (`oxlint --fix .`), `format` (`oxfmt --check .`), `format:fix` (`oxfmt .`), `cf-typegen` (`wrangler types`)
  - Pin the package manager via `"packageManager": "pnpm@<version>"` in `package.json`
- Add `.gitignore` entries: `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `worker-configuration.d.ts` (regenerated, not committed)
- Run `pnpm run deploy`

Verify:

- The Worker URL (e.g. `flea-market.{subdomain}.workers.dev/flea-market/`) loads the home page
- The internal `<Link>` navigates correctly and produces a URL like `.../flea-market/page-two`
- No console errors
- `pnpm typecheck`, `pnpm lint`, `pnpm format` all pass

Pitfalls:

- Forgetting `nodejs_compat` causes cryptic runtime errors
- A missing or wrong `base` in `vite.config.ts` produces 404s for assets
- Public-folder assets (favicon, og-image) are not always auto-prefixed by Vite's `base`. If a favicon 404s, prefix the reference by hand
- The `@cloudflare/vite-plugin` must be listed before the Start plugin in `vite.config.ts` - the scaffold does this correctly; don't reorder

## Step 2: Add the Workers Route on `akhdan.dev`

**Goal**: `akhdan.dev/flea-market/*` routes to the Worker; Hugo still serves all other paths.

Tasks:

- Add the route declaration to `wrangler.jsonc`:

  ```jsonc
  "routes": [
    { "pattern": "akhdan.dev/flea-market/*", "zone_name": "akhdan.dev" }
  ]
  ```

- Redeploy with `pnpm run deploy`

Verify:

- `https://akhdan.dev/flea-market/` shows the TanStack Start home page
- `https://akhdan.dev/` still shows the Hugo site
- `https://akhdan.dev/posts/some-post/` (or whatever Hugo paths exist) still works
- Asset URLs returned by the Worker are prefixed `/flea-market/`

Pitfalls:

- If a Pages catch-all is more specific than the Worker route, Pages wins. Verify by checking response headers (`cf-worker` will be present on Worker responses)
- DNS propagation should be instant for a route on an existing zone, but allow a minute

## Step 3: Tailwind + shadcn/ui

**Goal**: Tailwind compiles correctly through Vite, shadcn CLI works, a Button and Sheet component render with the right styling.

Tasks:

- Install Tailwind v4 (or whatever is current) per Vite docs
- Run `pnpm dlx shadcn@latest init -t start` - the `-t start` template flag is the first-class TanStack Start path; it auto-configures Tailwind and the `@/*` alias, skipping the Next.js-specific defaults
- Install Button, Sheet, Card, Input, Label, Sonner, AlertDialog components via `pnpm dlx shadcn@latest add ...` (shadcn's old Toast component is superseded; use Sonner for all toast notifications)
- Verify by adding a Button to the home page and confirming it's styled

Verify:

- shadcn components render correctly (proper colors, fonts, hover states)
- No CSS import or path errors in the build log
- Production build still works after these additions (run `pnpm run deploy` and confirm)

Pitfalls:

- Tailwind v4 vs v3 setup differs; follow the version that matches what TanStack Start scaffolded. v4 config lives in CSS (`@theme`), not `tailwind.config.js`

## Step 4: Turso, Drizzle, schema, migrations

**Goal**: Turso database created in Tokyo region, Drizzle ORM configured, schema defined, schema applied, 2-3 seed items inserted.

Tasks:

- Run `turso db create flea-market --location nrt`
- Get the DB URL and an auth token: `turso db show ...` and `turso db tokens create ...`
- Add both as Worker secrets: `wrangler secret put TURSO_DATABASE_URL`, `wrangler secret put TURSO_AUTH_TOKEN`
- Add the same values to `.dev.vars` (gitignored) for local development
- Install `@libsql/client` and `drizzle-orm`; `drizzle-kit` and `tsx` as dev dependencies (`tsx` runs the seed script)
- Define the schema in `src/db/schema.ts`:
  - `items` table with all columns from ARCHITECTURE.md (note `photos` is `[{key, alt?}]`, not bare strings)
  - `item_translations` table with composite primary key on (item_id, language)
  - CHECK constraint on price columns
- Configure `drizzle.config.ts` to point at the Turso URL + auth token (read from `.dev.vars` for local invocations)
- Apply the schema using **`drizzle-kit push`** - for this project's scale, push directly to Turso each schema change rather than generating versioned migration files. Versioned migrations are overkill for a single-admin, single-deployment app. If the project ever fans out to multiple instances (Jakarta, Singapore), revisit and switch to `generate` + a runtime migrator.
- Create a seed script `scripts/seed.ts` that inserts 2-3 sample items with English and Indonesian translations. Run via `pnpm tsx scripts/seed.ts`.
- Add scripts to `package.json`: `db:push` (`drizzle-kit push`), `db:studio` (`drizzle-kit studio`), `db:seed` (`tsx scripts/seed.ts`).
- Build the DB client in `src/db/client.ts`:
  - Inside server-side code, read bindings via `import { env } from "cloudflare:workers"` - this is the current TanStack-Start-on-Workers pattern, not `getEvent()` or `getRequestEvent()`.
  - The client uses `@libsql/client/web` with `url: env.TURSO_DATABASE_URL`, `authToken: env.TURSO_AUTH_TOKEN`.
  - Construct the client lazily per request rather than at module top-level. Server functions run inside a request context where `env` is available; module-level access during cold start can race with binding setup.

Verify:

- `turso db shell flea-market` and `SELECT * FROM items` returns the seed rows
- Drizzle Studio (`pnpm db:studio`) can read the rows (works against remote Turso via the `authToken` in `drizzle.config.ts`)
- A small TanStack `createServerFn` that selects from `items` returns data when called from a test route

Pitfalls:

- Importing from `@libsql/client` (default Node entry) instead of `@libsql/client/web` fails in the Workers runtime
- Forgetting to set both `.dev.vars` and `wrangler secret` means local and prod will diverge silently
- Routes prerendered at build time cannot read `env` from `cloudflare:workers`. For data-driven routes, ensure they render at request time (not prerendered)

## Step 5: R2, photo upload, image transforms

**Goal**: R2 bucket bound, upload endpoint working (auth stubbed for now), photos serve through Cloudflare Image Transformations.

This step now precedes the public list page so step 6 can render real photos against real R2 keys, rather than placeholders.

Tasks:

- Create R2 bucket: `wrangler r2 bucket create flea-market`
- Add R2 binding to `wrangler.jsonc`:

  ```jsonc
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "flea-market" }]
  ```

- Re-run `pnpm cf-typegen` so `env.BUCKET` is typed
- Configure a public R2 custom domain (e.g. `media.akhdan.dev`) via the dashboard. This is a one-time setup, not codeable via wrangler
- Add `R2_PUBLIC_BASE` to `vars` in `wrangler.jsonc`, set to `https://media.akhdan.dev`
- Enable Image Transformations for the zone in the Cloudflare dashboard (one-time, also not codeable)
- Build upload endpoint at `/flea-market/admin/api/upload`:
  - Accepts POST with binary body and `?slug=...` query param
  - Auth check via cookie. Step 7 will wire this up; for now stub it to always succeed and leave a TODO with a concrete trigger (e.g. `// TODO: replace with real cookie check once admin auth lands`)
  - Generates key `items/{slug}/{timestamp}-{rand}.<ext>` where `<ext>` is derived from the request's `Content-Type` (`image/jpeg` -> `jpg`, `image/png` -> `png`, `image/webp` -> `webp`, `image/heic` -> `heic`). Reject other content types with 415.
  - Calls `env.BUCKET.put(key, request.body, { httpMetadata: { contentType: request.headers.get('content-type') } })`
  - Returns `{ key }` as JSON
- Build `optimizedImageUrl(key, { width })` in `src/lib/images.ts` that emits `/cdn-cgi/image/width={w},quality=75,format=auto/{R2_PUBLIC_BASE}/{key}`
- Seed one or two real photos for the existing seed items so step 6 can render them:
  - From the local machine: `wrangler r2 object put flea-market/items/<seed-slug>/seed-1.jpg --file=./fixtures/photo.jpg`
  - Update the seed script to populate `photos: [{key: "items/<seed-slug>/seed-1.jpg"}]` and re-run `pnpm db:seed`

Verify:

- Upload via local dev server (`pnpm dev`, which gives you R2 bindings via Miniflare):

  ```sh
  curl -X POST --data-binary @photo.jpg -H "Content-Type: image/jpeg" \
    http://localhost:5173/flea-market/admin/api/upload?slug=test-item
  ```

  returns a `key`

- The key resolves at `https://media.akhdan.dev/{key}` (raw original)
- The transformed URL `https://akhdan.dev/cdn-cgi/image/width=400,quality=75,format=auto/https://media.akhdan.dev/{key}` returns a smaller image
- Network tab shows the transformed image is <100KB for a width=400 variant

Pitfalls:

- Image Transformations must be explicitly enabled per zone in the dashboard before `/cdn-cgi/image/` works; otherwise it 404s
- R2 public custom domain requires a CNAME and certificate setup; one-time but not instant
- Large uploads have a Worker request size limit (100MB on the free plan). Phone photos are typically 5-10MB which fits, but Image Transformations only resizes for _serving_ - the original sits in R2 at full size. If admin uploads become tedious over cellular, add browser-side downscaling (canvas to ~2400px max) in step 8; not required now
- Hardcoding `.jpg` for every upload silently mislabels PNG/HEIC; always derive the extension from `Content-Type`

## Step 6: Public list page and detail page

**Goal**: Visitors can browse items with real photos.

Tasks:

- Build `formatPrice(amount, currency)` and `MINOR_UNITS` constant in `src/lib/money.ts` per ARCHITECTURE.md (locale hardcoded to `'en'`)
- Implement language resolution helper `src/lib/lang.ts`:
  - `getLanguage(request)`: cookie `lang` -> `Accept-Language` parsing for `en`/`id` -> `env.DEFAULT_LANGUAGE`
  - Toggle endpoint at `/flea-market/lang/$lang` that validates against `{en, id}`, sets the `lang` cookie (`Path=/flea-market`, 1-year `Max-Age`), and 302-redirects to `Referer` if same-origin else `/flea-market/`
- List page at `/flea-market/`:
  - `createServerFn` loader resolves language, then fetches all items with the matching translation row (falling back to `en` if the requested language is absent)
  - Renders a grid of Cards: thumbnail (via `optimizedImageUrl(photos[0].key, { width: 400 })`), title, price, status badge
  - Status badge: `available` (green), `reserved` (yellow), `sold` (gray, item dimmed but still visible)
  - Filter controls: status (All / Available / Reserved / Sold) and price (All / Free / Paid)
  - Filter state lives in URL search params via TanStack Router; define a `zod` schema for type-safe parsing. Pin `zod >= 3.24` so it works with `validateSearch` directly via Standard Schema - no `@tanstack/zod-adapter` package needed
  - Client-side search box: substring match on title/description (no server work)
  - Language toggle button (anchor to `/flea-market/lang/id` or `/flea-market/lang/en` depending on current state)
- Detail page at `/flea-market/$slug`:
  - `createServerFn` loader fetches the item + translation by slug, language-resolved
  - Renders the photo carousel (use `optimizedImageUrl(key, { width: 1200 })`), title, price, status, description
  - 404 handling for unknown slugs

Verify:

- List page shows all seed items with real R2 photos rendered through `/cdn-cgi/image/...`
- Filter buttons work, URL updates, deep-linking respects filter state
- Detail pages load by slug
- Prices format correctly: ¥5,000, Rp250,000, S$50.25
- Sold items appear with the correct visual treatment (dimmed + badge)
- Language toggle flips between `en` and `id` translations on items that have both
- Items without an `id` translation fall back to `en` when viewed in Indonesian

Pitfalls:

- TanStack Router's search params need to be typed; define a schema using `zod` for type-safe filter params
- Don't forget to verify `Referer` is on `akhdan.dev` in the language-toggle redirect - an open redirect here is small but free to avoid

## Step 7: Admin auth

**Goal**: Admin routes are protected by a token-cookie.

Tasks:

- Generate the token locally: `openssl rand -hex 32`
- Store as Worker secret: `wrangler secret put ADMIN_TOKEN`. Also add to `.dev.vars`
- Generate cookie signing secret: `openssl rand -hex 32`. Store as `COOKIE_SECRET`
- Build the auth utility in `src/lib/auth.ts`:
  - `verifyToken(submitted: string, expected: string)`: SHA-256 both, compare with `timingSafeEqual` (available under `nodejs_compat`)
  - `signCookie(value: string, secret: string)`: HMAC-SHA256, returns `<value>.<hex-mac>`
  - `verifyCookie(signedValue: string, secret: string)`: split on `.`, recompute MAC, constant-time compare, return value or null
- Build the login flow:
  - Route at `/flea-market/admin/login` shows a single password input form
  - POST handler verifies token, sets `admin_session` cookie containing the signed literal `admin` with attributes per ARCHITECTURE.md #Admin auth: `HttpOnly`, `Secure`, `SameSite=Lax`, **`Path=/flea-market`**, `Max-Age=2592000` (30 days). Redirects to `/flea-market/admin/`.
  - Failed login returns 401 with generic error
- Build a parent route loader at `/flea-market/admin/` that runs before all admin routes (except login):
  - Reads the cookie, verifies signature, redirects to `/login` if invalid
- Replace the `// TODO: auth` stub in the upload endpoint (step 5) with a real cookie check
- Add a logout button somewhere in the admin UI that POSTs to `/flea-market/admin/logout` and clears the cookie (`Max-Age=0`, same `Path`)

Verify:

- Visiting `/flea-market/admin/` while logged out redirects to login
- Submitting the correct password sets a cookie and reaches the admin index
- Submitting a wrong password shows the error
- Logging out clears the cookie and re-redirects on next admin visit
- Upload endpoint rejects unauthenticated requests with 401

Pitfalls:

- SameSite=Strict breaks redirects from login. Use SameSite=Lax
- A naive `===` comparison is a timing leak. Use the SHA-256 + `timingSafeEqual` approach
- Cookie signing prevents tampering; without it, a leaked cookie value can be forged from another session

## Step 8: Admin CRUD

**Goal**: Admin can create, edit, mark status, and delete items.

Tasks:

- Admin index at `/flea-market/admin/`:
  - Lists all items in a table with title, price, status, last updated, actions (edit, mark sold, delete)
- Create page at `/flea-market/admin/new`:
  - Form fields: slug (auto-generated from English title + today's date, with override), price amount, currency (dropdown defaulting to `DEFAULT_CURRENCY`), status (defaults to `available`), photos (react-dropzone), English title/description (required), Indonesian title/description (optional, hidden behind a "Add Indonesian" toggle)
  - On submit: transaction inserts items row + 1-2 translations rows, returns to admin index with a success toast
- Edit page at `/flea-market/admin/$slug/edit`:
  - Same form pre-filled
  - Save updates the row in place
- Photo management:
  - react-dropzone for file picker
  - Show thumbnails of uploaded photos with delete buttons
  - Reorder via drag (use `@dnd-kit/sortable` or similar) - _defer if pressed for time, a single-axis sortable is one library + maybe 30 lines_
- Slug generation:
  - From English title: lowercase, replace non-alphanumeric with `-`, collapse repeated `-`, trim leading/trailing `-`
  - Prefix with `YYYYMMDD` (today)
  - On collision, append `-2`, `-3`, etc., probing until unique. Surface the final slug back to the form so the admin sees what was saved.
- Quick actions on the admin index:
  - "Mark sold" button: PATCHes status, single click, no confirmation needed
  - "Delete" button: confirms via shadcn AlertDialog, then deletes (cascades to translations)

Verify:

- Create flow works end-to-end with photos
- Edit preserves existing data and only changes what was edited
- Delete cascades and removes the item from the public list
- Status changes are reflected immediately on the public list
- Slug uniqueness is enforced (try saving two items with the same title on the same day; second should fail gracefully)

Pitfalls:

- File upload + form submit in one POST is awkward; do photo uploads ahead of form save and pass the resulting keys with the form data
- Don't forget to delete R2 objects when an item is deleted, or you'll accumulate orphan photos
- Abandoned creates leave orphan R2 keys (photos uploaded against a slug whose item row was never saved). Don't try to solve this with a staging-prefix scheme - at this scale, write a small GC script `scripts/gc-r2.ts` that lists every R2 key under `items/`, lists every key referenced from `items.photos` in Turso, and deletes the diff. Run it manually every month or two. ~30 lines of code; not a step in this plan, just a tool to keep handy.
- If the admin changes an item's slug after photos are already uploaded under the old slug, **do not rewrite R2 keys**. Photo `key` is stored per-photo in `items.photos`; the slug is just a URL handle. They're decoupled by design.

## Step 9: Cart and contact flow

**Goal**: Visitors can select items and generate a contact message.

Tasks:

- Add Zustand store at `src/stores/cart.ts`:
  - `slugs: Set<string>`
  - `add`, `remove`, `clear`, `has`
  - localStorage persistence via Zustand's `persist` middleware, key `flea-market:cart`
- Add "Add to cart" toggle button on list cards and detail pages
- Add a floating cart badge (corner of viewport, mobile-friendly position) showing count
- Cart Sheet (shadcn Sheet component):
  - Lists items by slug, fetches their current data from a server fn (so stale-cart-on-sold-item works correctly)
  - Per-currency subtotals
  - "Free" items grouped separately or marked inline
  - Sold/reserved items shown with badge, excluded from message, with a banner if any are present
  - Generated message in a read-only textarea
  - Buttons:
    - **Open in Facebook** - copies message + opens `https://m.me/{FB_HANDLE}` in new tab
    - **Show LINE QR** - opens modal with QR image
    - **Copy message** - clipboard + toast
- Message templates in `src/lib/messages.ts`:
  - `enMessage(items)` and `idMessage(items)`
  - Choose based on current page language
- Add `FB_HANDLE` to `wrangler.jsonc` vars

Verify:

- Adding/removing items updates the badge count
- Cart persists across page reloads
- Cart survives navigation
- Generated message is correct in both languages
- Copy-to-clipboard works (test on actual mobile browser, not just desktop)
- LINE QR modal shows the QR image
- Sold items added to the cart in a previous session show the banner and don't bleed into the message

Pitfalls:

- Zustand persistence needs JSON-serializable state. A `Set` is not directly serializable; either use an array internally or supply a custom `storage` adapter (the older `serialize`/`deserialize` options are deprecated). `superjson` plugged into `storage` is one drop-in approach
- `navigator.clipboard.writeText` fails silently on non-HTTPS; verify on the actual deployed `akhdan.dev`, not just `localhost`

## Done

After step 9 the app is feature-complete per the agreed scope. Real-world testing pass:

- Create 3-5 real listings with real photos via the admin
- Browse on mobile, desktop, and a slow connection
- Try the cart flow as a buyer would
- Verify a sold item correctly disappears or is badged
- Verify language switching works
- Run Lighthouse on the list page; should be ≥95 on performance with image transforms

## What to do if requirements change later

Likely v2 additions and where to slot them:

- **Cloudflare Web Analytics**: add the snippet to the root layout. One-time, doesn't touch the rest
- **Auto-announce on listing creation**: hook into the create handler in step 8 to POST to a Telegram/Discord webhook
- **Per-item view counts**: add a column to `items`, increment in the detail loader. Watch out for caching; either disable cache on the loader or count on the client
- **Multi-instance deployment**: extract `wrangler.jsonc` env vars per instance (Sendai, Jakarta, etc.). At 2+ instances, consider Terraform for the R2 buckets + Turso DBs + Worker config
- **Real cart math (totals across currencies, etc.)**: switch from JS numbers to `decimal.js` for any aggregation. Storage is already correct (minor units)

## Notes for working with Claude Code

- Commit after every step, not within steps
- Run `pnpm run deploy` after every step and verify in production before moving on
- Keep `ARCHITECTURE.md` updated if any decision changes during implementation
- If a step turns into a multi-hour rabbit hole, stop and ask before continuing
- Prefer explicit, type-safe code over clever; this project favors clarity since you'll come back to it months later
