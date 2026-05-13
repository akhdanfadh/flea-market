# Implementation Plan

A step-by-step plan for building the flea-market app. Each step is a deployable unit; do not start the next step until the previous one is live and verified.

This plan is written for execution with Claude Code. Each step has a clear deliverable, verification criteria, and notes on common pitfalls.

## Prerequisites

Before starting step 1:

- [x] Cloudflare account with `akhdan.dev` configured as a zone
- [x] Wrangler CLI installed and authenticated (`wrangler whoami` works)
- [x] Turso CLI installed and authenticated (`turso auth whoami` works)
- [x] Node.js 20+ and pnpm installed
- [x] A new empty GitHub repo created (e.g. `flea-market`)
- [x] Read `ARCHITECTURE.md` end to end

## Step 1: Scaffold TanStack Start, deploy to a Worker

**Status**: Done (2026-05-13). Originally shipped with `basepath: '/flea-market'` and Vite `base: '/flea-market/'`. Both were removed in Step 2 when migrating to a subdomain Custom Domain - see Step 2 for context.

**Goal**: A blank TanStack Start app deployed to `*.workers.dev`, basepath configured, no domain routing yet.

Tasks:

- Scaffold via the TanStack CLI directly. The Cloudflare-wrapped form
  (`npm create cloudflare@latest -- flea-market --framework=tanstack-start`)
  errored with "Unsupported framework: tanstack-start" on c3 v2.68.2;
  invoking `@tanstack/cli` directly bypasses the wrapper bug and is what c3
  wraps anyway:

  ```sh
  npx @tanstack/cli@latest create flea-market \
    --framework React --deployment cloudflare \
    --package-manager pnpm \
    --no-git --no-examples --no-toolchain --no-intent --non-interactive
  ```

  - `--no-git` skips repo init (we already have one).
  - `--no-toolchain` skips biome/eslint since we want oxlint/oxfmt.
  - `--no-examples` keeps the home route minimal.

  If the repo directory already has content (like ours, holding only docs),
  scaffold into a sibling directory, move generated files in, then `rm` the
  sibling. The TanStack CLI fails on a non-empty target without `--force`.

  The current scaffold (May 2026) installs `@cloudflare/vite-plugin` and
  wires `cloudflare({ viteEnvironment: { name: "ssr" } })` **before** the
  TanStack Start plugin in `vite.config.ts`. Plugin order matters; do not
  reorder. It also ships Tailwind v4 + Vitest + TanStack devtools +
  lucide-react - a richer base than older scaffolds; treat these as
  "already installed" when later steps reference them.

- Set the TanStack Router config to `basepath: '/flea-market'`
- Set the Vite config `base: '/flea-market/'` so static asset URLs are correct
- Confirm `wrangler.jsonc` contains:
  - `"main": "@tanstack/react-start/server-entry"`
  - `"compatibility_flags": ["nodejs_compat"]`
  - `"compatibility_date": "2026-05-13"` (pinned; bump deliberately later)
- Add a single home route that displays "Hello, flea market" with a `<Link>` to a second route to verify routing works
- Run `pnpm cf-typegen` to generate `worker-configuration.d.ts` (binds `env.BUCKET`, secrets, vars into the TypeScript type system). Re-run whenever `wrangler.jsonc` bindings change.
- Set up tooling:
  - Install `oxlint`, `oxfmt`, and `lefthook` as dev deps
  - Add `package.json` scripts: `dev` (`vite dev`), `build` (`vite build`), `deploy` (`vite build && wrangler deploy`), `typecheck` (`tsc --noEmit`), `lint` (`oxlint .`), `lint:fix` (`oxlint --fix .`), `format` (`oxfmt --check .`), `format:fix` (`oxfmt .`), `prepare` (`lefthook install`), `cf-typegen` (`wrangler types`)
  - Pin the package manager via `"packageManager": "pnpm@<version>"` in `package.json`
  - Add `.oxfmtrc.json` and `.oxlintrc.json` (zero-config defaults plus `sortImports`, `sortPackageJson`, and an `ignorePatterns` entry for `**/dist/**` and `**/src/routeTree.gen.ts`)
  - Add `lefthook.yml` with parallel pre-commit jobs: ASCII sanitizers (em-dash, arrows, section sign) then `oxfmt` (`stage_fixed: true`) then `oxlint --deny-warnings`. Sanitizers must `exclude: "lefthook*.yml"` or `stage_fixed` will rewrite the sanitizers' own patterns the first time the file is staged. Use `perl -Mutf8 -CSD -i -pe` (portable across BSD/GNU sed) for the substitutions.
- Add `.gitignore` entries: `node_modules`, `dist`, `.wrangler`, `.dev.vars`, `worker-configuration.d.ts` (regenerated, not committed), `lefthook-local.yml` (per-machine hook overrides)
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

## Step 2: Attach Workers Custom Domain `flea-market.akhdan.dev`

**Status**: Done (2026-05-13) - live at <https://flea-market.akhdan.dev/>. Worker serves the entire subdomain; Hugo on Pages continues to serve the apex `akhdan.dev`. The orphaned `akhdan.dev/flea-market*` route from the failed sub-path attempt was cleaned up via the Cloudflare REST API; see Pitfalls.

**Goal**: The Worker serves the entire `flea-market.akhdan.dev` subdomain; Hugo on Pages continues to serve `akhdan.dev`.

Why a subdomain (not a sub-path on the apex): TanStack Start + Cloudflare Workers Static Assets does not support a basepath-mounted deployment cleanly. Cloudflare's static-asset layer requires the on-disk asset layout to literally mirror the URL prefix; Vite's `base` only rewrites HTML URLs, not file paths. The framework's own `start-basic-cloudflare` example sidesteps this by deploying at a domain root. A Custom Domain on a subdomain is the framework-blessed pattern.

Tasks:

- Replace the route declaration in `wrangler.jsonc` with a Custom Domain entry:

  ```jsonc
  "routes": [
    { "pattern": "flea-market.akhdan.dev", "custom_domain": true }
  ]
  ```

  No `zone_name` needed - Custom Domain config is minimal. `wrangler deploy` auto-creates the DNS record and provisions a TLS certificate the first time.

- Remove `base: '/flea-market/'` from `vite.config.ts` (let Vite default to `/`)
- Remove `basepath: '/flea-market'` from `src/router.tsx`
- Redeploy with `pnpm run deploy`

Verify:

- `https://flea-market.akhdan.dev/` shows the TanStack Start home page with CSS visibly applied (e.g. `p-8`, `text-4xl` Tailwind classes render)
- Asset URLs the page references (CSS and JS bundles) return 200, not 404 - this is the verification step missed in earlier attempts
- `https://flea-market.akhdan.dev/page-two` SSRs correctly
- `<Link>` navigation in the browser works without a full reload
- `https://akhdan.dev/` still shows the Hugo site
- `https://akhdan.dev/flea-market/` now 404s from Pages (the old sub-path route is gone). An optional Hugo-side redirect would fix this; see "Optional follow-up" below

Verification mechanism: run `pnpm wrangler tail flea-market` in a second terminal. A request entry confirms the Worker served the response. `cf-ray` and `cf-cache-status` only confirm Cloudflare-proxying, not which product. `CF-Worker` is a request header Cloudflare adds on Worker-to-origin subrequests, not a response header to visitors.

Pitfalls:

- **TLS provisioning lag.** Cloudflare's Advanced Certificate is typically ready within a minute of deploy. If the first HTTPS request returns a TLS error, wait and retry - don't redeploy in a tight loop
- **`*.workers.dev` stays disabled** when a Custom Domain route is set without `"workers_dev": true`. Add `"workers_dev": true` to `wrangler.jsonc` if you want the workers.dev URL alive as a debug bypass
- **Don't put a `basepath` on the router or `base` on Vite**. The whole point of moving to a subdomain is that the app is at the root of its hostname; basepath/base settings will mis-prefix asset URLs and break things again
- **The old sub-path URL orphans.** Anyone who shared `akhdan.dev/flea-market/...` will land on Hugo's 404 after this migration. Acceptable for an MVP with no traffic yet. Add a Hugo-side redirect in the apex repo when convenient (see Optional follow-up)
- **The previous Worker Route binding from the failed sub-path attempt does not auto-clean.** `wrangler deploy` is additive for triggers; the old `akhdan.dev/flea-market*` route stayed bound to the Worker after this step's deploy and kept intercepting requests (returning a Worker 404 instead of Hugo's). Delete it explicitly via the Cloudflare REST API (see ARCHITECTURE.md #Deployment for the exact call). After deletion, the apex sub-path correctly falls through to Pages

Optional follow-up (cross-repo, not in this step's commit):

In the Hugo apex site's `_redirects` (Cloudflare Pages config), add:

```
/flea-market/* https://flea-market.akhdan.dev/:splat 301
```

This gracefully redirects anyone who has the old URL bookmarked.

## Step 3: Tailwind + shadcn/ui

**Goal**: Tailwind compiles correctly through Vite, shadcn CLI works, a Button and Sheet component render with the right styling.

Tasks:

- Tailwind v4 + `@tailwindcss/vite` already ship with the current `@tanstack/cli create` scaffold (verified in Step 1). Confirm it compiles; no install needed.
- Run `pnpm dlx shadcn@latest init -t start` - the `-t start` template flag is the first-class TanStack Start path; it auto-configures Tailwind and the `@/*` alias, skipping the Next.js-specific defaults
- Install Button, Sheet, Card, Input, Label, Sonner, AlertDialog components via `pnpm dlx shadcn@latest add ...` (shadcn's old Toast component is superseded; use Sonner for all toast notifications)
- Verify by adding a Button to the home page and confirming it's styled

Verify:

- shadcn components render correctly (proper colors, fonts, hover states)
- No CSS import or path errors in the build log
- Production build still works after these additions (user runs `pnpm run deploy` after reviewing the diff; agent does not deploy)

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
- Build upload endpoint at `/admin/api/upload`:
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
    http://localhost:5173/admin/api/upload?slug=test-item
  ```

  returns a `key`

- The key resolves at `https://media.akhdan.dev/{key}` (raw original)
- The transformed URL `https://flea-market.akhdan.dev/cdn-cgi/image/width=400,quality=75,format=auto/https://media.akhdan.dev/{key}` returns a smaller image
- Network tab shows the transformed image is <100KB for a width=400 variant

Pitfalls:

- Image Transformations must be explicitly enabled per zone in the dashboard before `/cdn-cgi/image/` works; otherwise it 404s
- R2 public custom domain requires a CNAME and certificate setup; one-time but not instant
- Large uploads have a Worker request size limit (100MB on the free plan). Phone photos are typically 5-10MB which fits, but Image Transformations only resizes for _serving_ - the original sits in R2 at full size. If admin uploads become tedious over cellular, add browser-side downscaling (canvas to ~2400px max) in step 8; not required now
- Hardcoding `.jpg` for every upload silently mislabels PNG/HEIC; always derive the extension from `Content-Type`

## Step 6: Public list page and detail page

**Goal**: Visitors can browse items with real photos.

Tasks:

- Decide the canonical URL form by setting `trailingSlash` on the TanStack Router config in `src/router.tsx`. TanStack Router's default is `'never'` (strip trailing slash on sub-routes), but Cloudflare Workers Static Assets defaults to `auto-trailing-slash` for the root, so `flea-market.akhdan.dev` will always 307 to `flea-market.akhdan.dev/`. Recommended: `trailingSlash: 'always'` for consistency between root and sub-routes (`/some-item/` instead of `/some-item`), matching Hugo's convention on the apex. Verify by curling `/some-item` (no slash) and confirming it 307s to `/some-item/`
- Build `formatPrice(amount, currency)` and `MINOR_UNITS` constant in `src/lib/money.ts` per ARCHITECTURE.md (locale hardcoded to `'en'`)
- Implement language resolution helper `src/lib/lang.ts`:
  - `getLanguage(request)`: cookie `lang` -> `Accept-Language` parsing for `en`/`id` -> `env.DEFAULT_LANGUAGE`
  - Toggle endpoint at `/lang/$lang` that validates against `{en, id}`, sets the `lang` cookie (`Path=/`, 1-year `Max-Age`), and 302-redirects to `Referer` if same-origin else `/`
- List page at `/`:
  - `createServerFn` loader resolves language, then fetches all items with the matching translation row (falling back to `en` if the requested language is absent)
  - Renders a grid of Cards: thumbnail (via `optimizedImageUrl(photos[0].key, { width: 400 })`), title, price, status badge
  - Status badge: `available` (green), `reserved` (yellow), `sold` (gray, item dimmed but still visible)
  - Filter controls: status (All / Available / Reserved / Sold) and price (All / Free / Paid)
  - Filter state lives in URL search params via TanStack Router; define a `zod` schema for type-safe parsing. Pin `zod >= 3.24` so it works with `validateSearch` directly via Standard Schema - no `@tanstack/zod-adapter` package needed
  - Client-side search box: substring match on title/description (no server work)
  - Language toggle button (anchor to `/lang/id` or `/lang/en` depending on current state)
- Detail page at `/$slug`:
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
- Don't forget to verify `Referer` is on `flea-market.akhdan.dev` in the language-toggle redirect - an open redirect here is small but free to avoid

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
  - Route at `/admin/login` shows a single password input form
  - POST handler verifies token, sets `admin_session` cookie containing the signed literal `admin` with attributes per ARCHITECTURE.md #Admin auth: `HttpOnly`, `Secure`, `SameSite=Lax`, **`Path=/`**, `Max-Age=2592000` (30 days). Redirects to `/admin/`.
  - Failed login returns 401 with generic error
- Build a parent route loader at `/admin/` that runs before all admin routes (except login):
  - Reads the cookie, verifies signature, redirects to `/login` if invalid
- Replace the `// TODO: auth` stub in the upload endpoint (step 5) with a real cookie check
- Add a logout button somewhere in the admin UI that POSTs to `/admin/logout` and clears the cookie (`Max-Age=0`, same `Path`)

Verify:

- Visiting `/admin/` while logged out redirects to login
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

- Admin index at `/admin/`:
  - Lists all items in a table with title, price, status, last updated, actions (edit, mark sold, delete)
- Create page at `/admin/new`:
  - Form fields: slug (auto-generated from English title + today's date, with override), price amount, currency (dropdown defaulting to `DEFAULT_CURRENCY`), status (defaults to `available`), photos (react-dropzone), English title/description (required), Indonesian title/description (optional, hidden behind a "Add Indonesian" toggle)
  - On submit: transaction inserts items row + 1-2 translations rows, returns to admin index with a success toast
- Edit page at `/admin/$slug/edit`:
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

- Each step lands as one or more commits; default is one commit per step, split only when there's a clear reviewability benefit (e.g. isolating raw generator/scaffold output from customizations). See `CLAUDE.md` #4 Workflow.
- After every step, run `pnpm typecheck`, `pnpm lint`, and `pnpm format`, then stop and wait for review. Agents do NOT run `pnpm run deploy` or `wrangler deploy` - the user reviews the diff, commits, deploys, and verifies in production. See `CLAUDE.md` #4 Workflow rule 2.
- Keep `ARCHITECTURE.md` updated if any decision changes during implementation
- If a step turns into a multi-hour rabbit hole, stop and ask before continuing
- Prefer explicit, type-safe code over clever; this project favors clarity since you'll come back to it months later
