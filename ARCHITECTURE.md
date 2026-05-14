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

`draft` is the admin's working state - items are created in `draft` from the new-item page, then promoted to `available` via an explicit Publish action once metadata and photos are in place. Public loaders filter `ne(items.status, "draft")` so visitors never see drafts on the list page, and a draft slug visited directly returns `notFound()`. The schema default for `status` stays `available` so any non-form insert path (seed script, ad-hoc) lands published; the new-item form sets `draft` explicitly.

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

1. Admin drags photos into react-dropzone in the create/edit form
2. Each file is POSTed to `/admin/api/upload?slug={slug}` as a binary body
3. Worker checks the admin cookie, generates key `{slug}/{timestamp}-{rand}.<ext>` where `<ext>` is derived from the request's `Content-Type` (`jpg` / `png` / `webp` / `heic`; other types rejected with 415), then calls `env.BUCKET.put(key, request.body, { httpMetadata: { contentType } })`
4. Worker returns the key; the form appends it to the item's `photos` array
5. On save, the items row stores `photos: [{key, alt?}, ...]`

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

This section describes the full drafts lifecycle. The "Save draft" form lands first; the edit page, photo upload UUID-prefix refactor, and `publishItem` gate land in the same follow-on commit. Where bullets below describe behavior that's intent-not-yet-shipped, they're called out inline.

Item creation is a two-step UX. The admin lands on `/admin/new/` with a minimal form (English title + description, optional Indonesian, plus the auto-previewed slug); clicking **Save draft** inserts the row with `status: "draft"` and empty `photos`, then redirects to `/admin/<slug>/edit/`. The edit page is where photos, price, and the rest of the metadata get filled in; it also exposes an explicit **Publish** action that flips status from `draft` to `available` (refused unless `photos.length >= 1`).

Why two steps rather than one combined form:

- **Atomic photo lifecycle.** Photos can't be uploaded before the row exists, so abandoned half-filled forms can't orphan R2 objects under a placeholder prefix. Every photo is tied to a real `items.id` from the moment it's uploaded.
- **Multi-session resilience.** A draft persists across browser closures and devices. The admin can start an item on their phone, finish on desktop.
- **Per-photo failure isolation.** Uploads happen one at a time against the existing row, so a single flaky upload doesn't block the rest of the photo set.
- **Slug stability at upload time.** R2 keys will be prefixed with the item's UUID (`<items.id>/<timestamp>-<rand>.<ext>`) once the upload endpoint refactor lands alongside the edit page, so slug renames after upload don't rewrite keys. Today the upload endpoint still uses the slug prefix - the migration ships alongside the edit page.

Visibility:

- Public list and detail loaders both filter `ne(items.status, "draft")`; a direct hit on a draft slug returns 404 (`notFound()`). Draft rows are invisible to visitors regardless of how they arrive.
- Admin index shows drafts mixed with published rows, with a zinc status chip distinguishing them from the green/amber/rose colors of `available`/`reserved`/`sold`. The Name link on a draft row points to the admin edit page rather than the public detail (which would 404).

Status transitions (full set lands with the edit + publish commit):

- Any state -> `draft` is freely reachable via the admin's row-status dropdown (an admin can unpublish at any time). _Shipped today._
- `draft -> available` will be gated on `photos.length >= 1` and route through `publishItem` so the gate is enforced regardless of which UI surface triggers the transition. _Today the dropdown calls `setItemStatus` directly with no gate; the dropdown rewire ships alongside the edit page._
- `available <-> reserved <-> sold` are arbitrary transitions through `setItemStatus`; the dropdown shows the published labels and applies the status directly. _Shipped today._

## Cart and contact flow

Client-side, no DB involvement.

**State**: a Zustand store holds `Set<itemSlug>`, persisted to `localStorage` under key `flea-market:cart` (a storage namespace, unrelated to URL paths). Initialized from localStorage on app mount.

**UI**:

- Each item card on the list and detail pages shows an "Add to cart" / "Remove" button (toggled by cart membership)
- A floating badge in the corner shows cart count; clicking it opens a Sheet (shadcn)
- The Sheet lists selected items with title, price, remove button
- A "Total" section sums prices per currency (so a JPY + USD cart shows `¥5,000 + $50.00`)
- Free items appear in the list with a "Free" badge and don't contribute to the total
- Reserved or sold items that are still in the cart from a previous session appear with the relevant badge, are excluded from the message, and trigger a banner

**Contact section**:

- Read-only textarea showing the generated message in the current page language (EN or ID template)
- Three buttons:
  - **Copy & open Facebook**: copies the message to clipboard via `navigator.clipboard.writeText()`, then opens `https://m.me/{FB_HANDLE}` in a new tab
  - **Show LINE QR**: opens a modal with the LINE QR code (static image in `/public/`)
  - **Copy message**: copies to clipboard, shows a "Copied!" toast

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
    "FB_HANDLE": "your-facebook-handle",
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
