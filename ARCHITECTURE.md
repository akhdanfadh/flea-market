# Architecture

A self-hosted flea-market listing app that lives at `flea-market.akhdan.dev`, a dedicated Cloudflare Workers subdomain alongside the existing Hugo site at the apex `akhdan.dev`. Designed to be redeployable in different cities (Sendai today, Jakarta next) by changing environment variables, no code or schema changes.

## Goals and non-goals

**Goals**:

- A public list/grid of items the owner is selling or giving away
- Item detail pages with photos, price, description, status
- Bilingual content (English required, Indonesian optional)
- A single-admin CRUD interface protected by a token-cookie
- A client-side cart that generates a structured contact message
- Free to run, ideally forever, at the scale of ~30 active items
- Programmatic infrastructure where reasonable (no clicking around in dashboards for app config)

**Non-goals**:

- Multi-user accounts, social login, password recovery
- Payment processing
- Server-side search engines, full-text search
- Cross-device cart persistence
- SEO optimization, sitemaps, RSS
- Currency conversion across instances (one instance, one default currency)
- User-selectable themes (light mode, theme toggle)

## Stack

| Layer              | Choice                                                                                 | Notes                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Framework          | TanStack Start (React)                                                                 | Native Cloudflare Workers target via `@tanstack/react-start/server-entry` |
| Build              | Vite (built into TanStack Start)                                                       |                                                                           |
| Deployment         | Cloudflare Workers                                                                     | `wrangler deploy`, `nodejs_compat` flag required                          |
| Routing on domain  | Cloudflare Workers Custom Domain `flea-market.akhdan.dev`                              | Hugo on Pages continues to serve the apex `akhdan.dev`                    |
| Database           | Turso (libSQL), primary region: Tokyo (`nrt`)                                          | Free tier: 5GB / 500M reads / 10M writes per month                        |
| DB client          | `@libsql/client`                                                                       | Fetch-based, works in Workers (auto-selects the right entry point)        |
| ORM                | Drizzle (`drizzle-orm/libsql`)                                                         |                                                                           |
| Image storage      | Cloudflare R2                                                                          | 10GB free tier; zero egress                                               |
| Image optimization | Cloudflare Image Transformations on R2-sourced URLs                                    | 5,000 unique transforms/month free; cached forever once generated         |
| UI components      | shadcn/ui + Tailwind CSS                                                               |                                                                           |
| Theme              | Gruvbox dark (mirrors akhdan.dev), no toggle                                           | `.dark` stamped on `<html>` at SSR; hex tokens in `src/styles.css`        |
| Upload UI          | react-dropzone                                                                         | Drag-and-drop file picker; Worker handles the actual upload to R2         |
| Cart state         | Zustand + localStorage                                                                 | Client-side only, no server state                                         |
| Admin auth         | Single token in `env.ADMIN_TOKEN`, SHA-256 + `timingSafeEqual`, httpOnly signed cookie |                                                                           |

## High-level diagram

```text
              akhdan.dev (zone)
                    |
        +-----------+--------------------+
        |                                |
   akhdan.dev                  flea-market.akhdan.dev
   (apex zone)                 (Custom Domain)
        |                                |
        v                                v
  Cloudflare Pages                 Cloudflare Worker
  (Hugo static site)               (TanStack Start)
                                         |
                                         +-----> Turso (libSQL, Tokyo)   <- item data, translations
                                         +-----> Cloudflare R2           <- photo originals
                                         +-----> /cdn-cgi/image/...      <- on-the-fly resize/format
```

## Routing strategy

Two Cloudflare products on the same zone, split by hostname (not path):

1. The flea-market app is deployed as a Worker (not a Pages app) and attached to a Cloudflare Workers Custom Domain on the subdomain `flea-market.akhdan.dev`. The Worker is the origin for the entire subdomain — every path lands on the Worker.
2. Hugo on Pages remains the origin for `akhdan.dev` and any other apex paths. The two are independent; no path-precedence arbitration is needed.
3. `wrangler deploy` auto-provisions the subdomain's DNS record and TLS certificate. No DNS clicking in the dashboard.

Why subdomain instead of sub-path: TanStack Start + Cloudflare Workers Static Assets does not support a basepath-mounted deployment cleanly. Cloudflare's static-asset layer requires the disk layout to mirror the URL prefix, but Vite's `base` only rewrites HTML URLs without moving files. The framework's own examples deploy at a domain root for this reason. A subdomain Custom Domain sidesteps the entanglement entirely.

Caveats:

- Always use `<Link>` from TanStack Router for internal navigation rather than hardcoded `href` strings. Reason is no longer "basepath rewriting" but client-side routing benefits (preload-on-intent, scroll restoration, no full reload). The only exception is `/lang/$lang` — a server-only endpoint that 302s with a `Set-Cookie`; a `<Link>` would skip the response. Those toggles render as raw `<a>` elements.

### Item detail: modal-over-list with route mask

Two routes serve the detail content:

- `/$slug/` — the standalone detail page. SSR'd; renders on direct nav, refresh, share-link load.
- The same `DetailContent` component rendered inside a `<Dialog>` overlay on `/` when `search.item` is set.

In-app card clicks navigate to `/` with `?item=<slug>` plus a TanStack Router `routeMask` of `to: "/$slug/", params: { slug }`. The router renders the list route (matching `/`) and the modal opens, but the URL bar displays `/$slug/`. `unmaskOnReload: true` means a refresh on the masked URL bypasses the mask entirely and the server renders the standalone `/$slug/` route — shared links degrade to the full page exactly like Instagram's `/p/<id>` pattern.

Modifier-click / right-click on a card falls through to the Link's real `href="/$slug/"`, opening the standalone page in a new tab as the user expects.

## Data model

### `items`

| Column           | Type             | Notes                                                                                                                            |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid pk          |                                                                                                                                  |
| `slug`           | text unique      | Format: `YYYYMMDD-{kebab-case-title}`. Indexed                                                                                   |
| `price_amount`   | integer nullable | In minor units (yen and rupiah have 0 decimals, USD has 2). Null means free                                                      |
| `price_currency` | text nullable    | ISO 4217: `JPY` / `IDR` / `USD`. Null when free                                                                                  |
| `status`         | text             | `draft` / `available` / `reserved` / `sold`. Drafts are admin-only - see below                                                   |
| `photos`         | json             | Ordered array of `{ key: string, alt?: string }` objects. `key` is the R2 object key; `alt` is an optional accessibility caption |
| `created_at`     | timestamp        |                                                                                                                                  |
| `updated_at`     | timestamp        |                                                                                                                                  |

Constraints:

- CHECK: `(price_amount IS NULL AND price_currency IS NULL) OR (price_amount IS NOT NULL AND price_currency IS NOT NULL)`
- Application-level: `price_currency` must be in the supported currency list

### `item_translations`

| Column        | Type                                    | Notes                                          |
| ------------- | --------------------------------------- | ---------------------------------------------- |
| `item_id`     | uuid fk -> `items.id` ON DELETE CASCADE |                                                |
| `language`    | text                                    | `en` or `id`                                   |
| `title`       | text                                    |                                                |
| `description` | text                                    |                                                |
| PRIMARY KEY   | `(item_id, language)`                   | Prevents duplicate-language rows for same item |

Application-level rule: every item must have at least one `en` translation before save. Enforced in the create/edit logic, not in the DB schema, since SQLite triggers for this kind of constraint are clunky.

**Encoding split: content vs. slug.** Title and description fields accept full UTF-8 — Japanese, accented Latin, anything renders. The page already pulls Noto Sans + Noto Sans JP, so CJK text displays in the right font without additional work. Slugs are deliberately constrained to ASCII alphanumerics + hyphens (`SLUG_PATTERN`) so URLs stay readable and shareable regardless of what the title contains. `slugifyTitle` strips non-ASCII when auto-generating: a Japanese-only title yields just the date prefix (`20260515`), a mixed title like `"Kotatsu heated table コタツ"` yields `20260515-kotatsu-heated-table`. The admin can manually edit the slug via the "Edit slug" affordance for items where the auto-derived ASCII portion isn't what they want.

**Draft status**

`draft` is the admin's working state - items are created in `draft` from the new-item page and then move to a published status via the `StatusSelect` dropdown on the edit page (or the row dropdown on the admin index). The dropdown calls `setItemStatus`, which enforces a single invariant: leaving `draft` requires `photos.length >= 1`. Public loaders filter `ne(items.status, "draft")` so visitors never see drafts on the list page, and a draft slug visited directly returns `notFound()`. The schema default for `status` stays `available` so any non-form insert path (seed script, ad-hoc) lands published; the new-item form sets `draft` explicitly.

The other three statuses (`available`, `reserved`, `sold`) are all public-visible. Cart and contact flow excludes `sold` from purchase-able items; `reserved` is informational. See `#Cart and contact flow`.

## Money handling

Storage is in minor units. Concretely:

```ts
MINOR_UNITS = {
  JPY: 0,
  IDR: 0,
  USD: 2,
};
```

A ¥5,000 item is stored as `price_amount = 5000`, `price_currency = 'JPY'`. A US$50.25 item is `price_amount = 5025`, `price_currency = 'USD'`.

Display uses `Intl.NumberFormat`:

```ts
function formatPrice(amount: number, currency: string): string {
  const minor = MINOR_UNITS[currency] ?? 0;
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amount / 10 ** minor);
}
```

Result: `¥5,000`, `Rp250,000`, `$50.25`.

The locale is hardcoded to `'en'` regardless of page language. Decision: currency symbols and digit grouping are stable across visitors, and a mixed-locale UX (English UI rendering `Rp1.000.000` Indonesian-style) is more jarring than helpful at this scale. Revisit only if the catalog targets a single non-English locale exclusively.

Admin form: a currency dropdown defaults to `env.DEFAULT_CURRENCY`. The amount input enforces whole numbers when the selected currency has 0 minor units, otherwise allows decimals.

## i18n

The two-table design (items + item_translations) decouples language from item identity.

**Language state mechanism**:

A single cookie `lang` (values `en` or `id`), `Path=/`, 1-year expiry. The server resolves the active language on every request via `getLanguage()` in `src/lib/lang.server.ts`, in this order:

1. `lang` cookie if present and valid
2. `Accept-Language` header parsed for `en` / `id` (any other value falls through)
3. `env.DEFAULT_LANGUAGE` (defaults to `en`)

The resolved language is returned from the root loader so `<html lang={...}>` and every page loader see the correct value — SSR renders the right translation on first paint, no client-side flip after hydration.

**Toggle endpoint**:

`GET /lang/$lang` (`src/routes/lang/$lang.ts`) validates the param against the `LANGUAGES` constant in `src/db/schema.ts`, sets the cookie (`Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `HttpOnly`, plus `Secure` only when the request is HTTPS), then 302-redirects to `Referer` (compared by `URL.origin`, not hostname, so port/scheme mismatch is caught; falls back to `/` on missing / unparsable / cross-origin). The toggle button in the UI is a plain `<a>` to this endpoint; a full page reload is acceptable. `HttpOnly` is included as defense-in-depth — `getLanguage()` reads the cookie server-side, no JS read path exists; revisit if a concrete client-side reader ever lands.

`Secure` is gated on the request protocol so the toggle works in dev over LAN IPs (e.g. `http://192.168.x.x:3000` for phone testing). Browsers exempt `localhost` from the `Secure` requirement but not LAN IPs — a blanket `Secure` would silently drop the cookie there. Production always serves over HTTPS, so `Secure` is always emitted in prod.

**Translation lookup**:

- Public pages: render the translation matching the resolved language; fall back to `en` if the requested-language row is absent (e.g., an item with no `id` translation viewed in Indonesian).
- Admin form: tabs for English (required) and Indonesian (optional).
- Cart contact-message template: chosen at message-generation time using the resolved language.

**What page language affects vs. doesn't**:

- Affects: item title, description, cart contact-message template, UI strings.
- Does not affect: price formatting (hardcoded `'en'` locale, currency-driven), date formatting (locale-fixed to `en`).

**Sharing across languages**:

A link sent to a contact does not force their browser into your language; their `Accept-Language` (or their existing `lang` cookie on this site) determines first paint. They toggle once if needed and the cookie sticks for that device. This is acceptable for the cart flow, which generates the contact message as plain text - the language is captured at message-generation time and travels in the text body, not the URL.

## Image pipeline

1. Admin drags photos into the react-dropzone on the edit page (the item row must already exist - drafts are created first via the new-item form)
2. Each file is POSTed sequentially to `/admin/api/upload?item={itemId}` as a binary body, where `itemId` is the row's UUID
3. Worker checks the admin cookie, looks up the row (404 if missing), generates key `{itemId}/{timestamp}-{rand}.<ext>` where `<ext>` is derived from the request's `Content-Type` (`jpg` / `png` / `webp` / `heic`; other types rejected with 415), calls `env.BUCKET.put(key, request.body, { httpMetadata: { contentType } })`, then appends `{key}` to `items.photos` in a single SELECT-then-UPDATE round-trip (not atomic; concurrent uploads against the same row would race, but the dropzone serializes them per-session)
4. Worker returns `{key, photos}` (the updated full photos array); the dropzone hands the array off to the route which calls `router.invalidate()` to refresh the photo grid from loader data

Photos are server state on the edit page. Removal (`removeItemPhoto`), reorder (`setItemPhotoOrder`), and alt-text edits (`setItemPhotoAlt`) are each their own server fn that rewrites `items.photos` via SELECT-then-UPDATE (one round-trip, not transaction-atomic). R2 keys use the UUID prefix on purpose: slug renames after upload don't affect keys, and the upload endpoint can refuse mistyped item IDs cheaply (one indexed lookup) before touching R2.

Serving:

- The Worker proxies R2 originals at `/images/<key>` via the `BUCKET` binding (see `src/routes/images/$.ts`). Cache headers (`Cache-Control: public, max-age=31536000, immutable` + `ETag`) let Cloudflare's edge cache transformed variants forever after first generation, so the Worker is invoked only on cache miss
- The app renders images with Cloudflare's image transformation URL prefix, using a relative path source (resolves against the current zone — no R2 custom domain or env var needed):

  ```text
  /cdn-cgi/image/width={w},quality=75,format=auto/images/{key}
  ```

- List page uses width=400, detail page uses width=1200, open-graph cards use width=1200&height=630&fit=cover
- All variants are cached at the edge after first generation

Why proxy through the Worker instead of a public R2 custom domain: an R2 custom domain binds a whole hostname to one bucket, so a generic name like `media.akhdan.dev` would be locked to flea-market only. Proxying via the Worker keeps `flea-market.akhdan.dev` as the single hostname for the app and leaves other subdomains free for unrelated projects. At our scale (~90 lifetime unique transformations, sub-500 daily requests) the Worker request cost is noise.

Counts: ~30 items × 3 variants = 90 unique transformations. The 5,000/month free tier is never close to threatened.

**Dev-mode bypass.** In `pnpm dev` (Miniflare), Cloudflare's edge image transformer at `/cdn-cgi/image` is not emulated. `optimizedImageUrl(key, ...)` in `src/lib/images.ts` checks `import.meta.env.DEV` and returns the raw `/images/<key>` Worker-proxy URL in that case. Production goes through the transformer as normal. The trade-off: dev list pages download full-size originals (no width=400 thumbnails), so a 3MB phone photo will feel noticeably heavier in dev than in prod — fine for the seed fixtures, watch for it once real photos land.

## Admin auth

Single-admin, token-in-cookie design.

**Setup**:

- A 32-byte random hex token is generated locally with `openssl rand -hex 32`
- Stored as a Worker secret: `wrangler secret put ADMIN_TOKEN`
- A second secret, `COOKIE_SECRET`, signs the session cookie

**Login flow**:

1. `GET /admin/login/` shows a single password input
2. `POST /admin/login/` compares submitted password to `env.ADMIN_TOKEN` using SHA-256 + `timingSafeEqual` (constant-time; `timingSafeEqual` is available under `nodejs_compat`)
3. On match, sets the `admin_session` cookie:
   - **Value**: the literal string `admin` HMAC-SHA256-signed with `env.COOKIE_SECRET` (format: `admin.<hex-mac>`)
   - **Attributes**: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 days), plus `Secure` when the request is HTTPS. `Secure` is gated on the request protocol so the cookie still sets when dev is served over plain HTTP on a LAN IP (phone testing); browsers exempt `localhost` from the `Secure` requirement but not LAN IPs. Production is always HTTPS so `Secure` is always emitted there. Mirrors the `lang` cookie in `src/routes/lang/$lang.ts`.
4. On mismatch, 302-redirects to `/admin/login/?failed=yes`; the route re-renders the form with an inline "Invalid password" message. The sentinel value is `yes` (not `1`) because TanStack Router's default `parseSearchWith(JSON.parse)` JSON-parses each search value before `validateSearch` sees it - `?failed=1` would arrive as `Number(1)`, fail the literal-string schema, fall through `.catch(undefined)`, and get stripped on outbound URL canonicalization. `yes` is not valid JSON, so JSON.parse throws and the parser preserves the raw string. A literal 401 here would leave the visitor on a blank Unauthorized page after a server-rendered form POST.

The payload is intentionally a constant. A single-admin app has nothing per-session to encode; the signature is the only thing standing between a forged value and access. If you ever add a second person, evolve the payload to `{iat, v}` with a version field that lets you mass-invalidate without rotating the secret.

**Authorization**:

- All routes under `/admin/*` (except `/admin/login/`, `/admin/logout/`, and `/admin/api/*`) require the cookie to validate
- Validation happens in a pathless `/admin/_auth` layout's `beforeLoad` (via a `createServerFn` so `HttpOnly` cookies stay readable) so the check isn't repeated across handlers
- Failed validation redirects to `/admin/login/`
- `/admin/api/upload` keeps its own auth check that accepts either Bearer (CLI/curl) or the `admin_session` cookie (browser form), returning a real 401 rather than a 302

**Logout**:

- `POST /admin/logout/` clears the cookie. The handler gates on a same-origin `Referer` to prevent a cross-site form-POST from force-clearing the admin's session (SameSite=Lax blocks the _cookie_ on a cross-site POST but doesn't block the _request_; clearing a cookie doesn't need the cookie to be sent). Mirrors the same-origin guard in `/lang/$lang`.

**Revocation**:

Two distinct rotations with distinct effects:

- `wrangler secret put ADMIN_TOKEN` - blocks future logins with the old password. Does **not** invalidate already-issued cookies (they're signed with `COOKIE_SECRET`, not `ADMIN_TOKEN`).
- `wrangler secret put COOKIE_SECRET` - invalidates every currently-issued session. Next request from any existing cookie fails signature verification and redirects to login.

If the admin password leaks, rotate both.

**What this does not protect against**:

- Compromise of Cloudflare account (out of scope; same risk applies to any cloud-deployed app)
- The admin's device being compromised (out of scope)

## Drafts

Item creation is a two-step UX. The admin lands on `/admin/new/` with a minimal form (English title + description, optional Indonesian, plus the auto-previewed slug); clicking **Save draft** inserts the row with `status: "draft"` and empty `photos`, then redirects to `/admin/<slug>/edit/`. The edit page is where photos, price, and the rest of the metadata get filled in; the `StatusSelect` dropdown in the header transitions the row out of `draft` to any of `available`, `reserved`, or `sold` once at least one photo exists (the gate is `setItemStatus`'s only invariant).

Why two steps rather than one combined form:

- **Atomic photo lifecycle.** Photos can't be uploaded before the row exists, so abandoned half-filled forms can't orphan R2 objects under a placeholder prefix. Every photo is tied to a real `items.id` from the moment it's uploaded.
- **Multi-session resilience.** A draft persists across browser closures and devices. The admin can start an item on their phone, finish on desktop.
- **Per-photo failure isolation.** Uploads happen one at a time against the existing row, so a single flaky upload doesn't block the rest of the photo set.
- **Slug stability at upload time.** R2 keys are prefixed with the item's UUID (`<items.id>/<timestamp>-<rand>.<ext>`); slug renames after upload don't rewrite them.

On the edit page, photos are server state: each upload, removal, reorder, and alt-text edit is its own server fn that rewrites `items.photos` in one SELECT-then-UPDATE round-trip. The dropzone POSTs each file to `/admin/api/upload?item=<id>` (the endpoint validates the item exists, writes R2, then runs the same round-trip and returns the updated array). Per-photo mutations from the grid run through `removeItemPhoto`, `setItemPhotoOrder`, and `setItemPhotoAlt`. The form's Save button only persists metadata (slug, translations, price); status changes go through the `StatusSelect` dropdown (which calls `setItemStatus`), never through the metadata save.

Visibility:

- Public list and detail loaders both filter `ne(items.status, "draft")`; a direct hit on a draft slug returns 404 (`notFound()`). Draft rows are invisible to visitors regardless of how they arrive.
- Admin index shows drafts mixed with published rows, with a zinc status chip distinguishing them from the green/amber/rose colors of `available`/`reserved`/`sold`. The Name link on a draft row points to the admin edit page rather than the public detail (which would 404).

Status transitions go through a single server fn, `setItemStatus`. The only invariant is the photo gate: a `draft` can leave `draft` state only when `photos.length >= 1`. Everything else - any -> `draft` (unpublish) and `available ↔ reserved ↔ sold` (free moves among published states) - is unrestricted, because they're recovery/workflow choices the admin owns.

The gate is enforced at two layers: the `StatusSelect` dropdown disables the published targets when the row is a draft without photos, and `setItemStatus` itself runs a SELECT before the UPDATE and refuses the same case server-side (with message "Add at least one photo before publishing"). A hand-rolled `curl` cannot bypass it.

## Cart and contact flow

Client-side, no DB involvement.

**State**: a Zustand store holds `Set<itemSlug>` in memory and persists to `localStorage` under key `flea-market:cart` as `string[]` (asymmetric in/on-disk shape avoids pulling in `superjson` for a one-off `Set` round-trip). Rehydration is gated by `useHasMounted` so SSR + persist don't disagree on the FAB count. The store keys items by `slug`, not `id` - slugs are admin-editable, so a slug rename silently drops the row from any cart that still holds the old value (acceptable at single-admin scale). A hard `CART_LIMIT = 50` in `src/lib/cart-constants.ts` is shared with the server fn's Zod validator. Cross-tab sync is not wired (Zustand `persist` v5 doesn't subscribe to the `storage` event); two tabs of the public site drift their cart state until reload.

**UI**:

- Each item card on the list and detail pages shows an "Add to cart" / "Remove" button (toggled by cart membership). On `sold` and `draft` items the button is absent (no false affordance); `available` and `reserved` both render it. On list cards the toggle is a bottom-right overlay chip; on the detail page / modal it's a full-width button below the title.
- A fixed bottom-right pill (icon + "Cart" label + count badge) is the Sheet trigger, mounted globally in `__root.tsx`. Hidden on `/admin/*` (admin is the seller, "cart to yourself" makes no sense).
- The Sheet drawer (right-anchored, full-width on mobile, max `sm:max-w-md` on `sm+`) lists selected items with thumbnail, title, price, per-row remove button.
- A "Total" section sums prices per currency (so a JPY + USD cart shows `¥5,000 + $50.00`).
- Free items appear in the list with a green "Free" pill and don't contribute to the total.
- Reserved items remain in the message body with an inline `[Reserved]` tag - the visitor's intent is "I know it's taken; flag me if it falls through" and the tag signals that to the seller. Sold items render dimmed in the list but are excluded from the message body and from totals. A unified "Some items in your cart are no longer available" banner appears whenever sold rows or missing-from-server rows (slug went to draft / was deleted) exist, with a one-click "Remove unavailable items" cleanup.
- The drawer re-fetches per-item data only on Sheet open or explicit retry, not on every cart mutation, so a remove can't trigger a spurious refresh-failure toast immediately after the visitor's own action. Optimistic render-time filter handles the visual diff.

**Contact section**:

- Read-only textarea showing the generated message in the current page language (EN or ID template). Item titles localize via the loader's resolved language; UI chrome (badges, banners, button labels) stays English-only.
- Three actions stacked vertically next to a small LINE QR image (left-aligned heading "Scan QR or reach me via:"):
  - **Copy message**: synchronous `navigator.clipboard.writeText()`, surfaces a Sonner toast on success or failure. Standalone button so the visitor reviews the prefilled text first, then chooses a channel.
  - **Messenger contact button**: opens `https://m.me/{FB_HANDLE}` in a new tab. Synchronous `window.open` inside the click handler so iOS Safari's user-gesture popup gate accepts the navigation.
  - **LINE contact button**: opens `https://{LINE_HANDLE}` in a new tab. Same gesture-synchronous open.
- Static LINE QR image at `public/line-qr.jpg` rendered inline (no modal). The image is checked in next to the env var that drives it - if a redeploy changes `LINE_HANDLE`, regenerate the image to match.
- The contact section is always visible (independent of cart contents) so a visitor can reach the seller even with an empty / all-sold cart.

## Configuration

### Build-time (in `wrangler.jsonc`, committed)

```jsonc
{
  "name": "flea-market",
  "compatibility_date": "2026-05-13", // pinned; bump deliberately when adopting new runtime behavior
  "compatibility_flags": ["nodejs_compat"],
  "main": "@tanstack/react-start/server-entry",
  "routes": [{ "pattern": "flea-market.akhdan.dev", "custom_domain": true }],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "flea-market" }],
  "vars": {
    "DEFAULT_CURRENCY": "JPY",
    "SUPPORTED_CURRENCIES": "JPY,IDR,USD",
    "DEFAULT_LANGUAGE": "en",
    // Display URLs minus protocol (e.g. "m.me/akhdanfadh", "line.me/ti/p/...").
    // The cart drawer renders these verbatim and prepends https:// when
    // opening the new tab. LINE_HANDLE pairs with the static QR image at
    // public/line-qr.jpg - regenerate that image if the handle changes.
    "FB_HANDLE": "m.me/your-handle",
    "LINE_HANDLE": "line.me/ti/p/your-line-id",
  },
}
```

### Secrets (set via `wrangler secret put`, never in repo)

| Name                 | Source                 |
| -------------------- | ---------------------- |
| `ADMIN_TOKEN`        | `openssl rand -hex 32` |
| `COOKIE_SECRET`      | `openssl rand -hex 32` |
| `TURSO_DATABASE_URL` | Turso dashboard        |
| `TURSO_AUTH_TOKEN`   | Turso dashboard        |

### Local development (`.dev.vars`, gitignored)

Same variables as above with development values; Wrangler loads automatically.

## Deployment

- `pnpm run deploy` runs `vite build && wrangler deploy`
- The Workers Custom Domain (`flea-market.akhdan.dev`) is declared in `wrangler.jsonc` and provisioned on deploy — DNS record and TLS certificate are created automatically the first time
- **`wrangler deploy` is additive for triggers, not reconciliatory.** Routes removed from `wrangler.jsonc` are **not** automatically cleaned off the zone — `wrangler triggers deploy` does not remove orphans either. Stale route bindings keep intercepting traffic. To clean up, delete via the Cloudflare dashboard (Workers -> Triggers -> Routes) or the REST API: `DELETE /zones/{zone_id}/workers/routes/{route_id}`. List existing routes with `GET /zones/{zone_id}/workers/routes`. The wrangler OAuth token at `~/Library/Preferences/.wrangler/config/default.toml` has the `workers_routes:write` scope and works as a `Bearer` token
- R2 bucket is created once via `wrangler r2 bucket create flea-market`. No public custom domain is provisioned; the Worker serves originals at `/images/<key>` via the `BUCKET` binding (see Image pipeline)
- Image Transformations is enabled per-zone in the Cloudflare dashboard (one-time). Because the source URL is on the same zone as the transformer, no entry in Images > Transformations > Sources is required
- Turso DB is created via `turso db create flea-market --group <group>`. Groups carry the location; on a fresh Turso account a `default` group typically already exists in the region tied to the signup, and `turso group list` shows existing groups. Use `turso group create <name> --location nrt` to provision Tokyo if no Tokyo group exists yet
- Drizzle migrations are run from the local machine against the Turso URL

## Cost ceiling

| Resource         | Free tier          | Expected usage         |
| ---------------- | ------------------ | ---------------------- |
| Workers requests | 100,000/day        | <500/day realistically |
| R2 storage       | 10 GB              | <1 GB                  |
| R2 Class A ops   | 1M/month           | <100/month             |
| Turso reads      | 500M/month         | <10k/month             |
| Turso writes     | 10M/month          | <500/month             |
| Image transforms | 5,000 unique/month | <100                   |

Zero expected spend at any plausible usage level.

## Future considerations

Out of scope for v1 but cheap to add later:

- Cloudflare Web Analytics for visit counts
- Telegram or Discord webhook on new item creation (so a public channel auto-announces)
- An RSS feed if listings get heavy enough to warrant it
- Per-item view counter (one Turso column, increment in the detail-page loader)
- Multi-instance deploy automation (a fresh Turso DB + Worker + R2 bucket for a new city) - at that point, Terraform earns its place
