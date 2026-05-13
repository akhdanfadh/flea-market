# Architecture

A self-hosted flea-market listing app that lives at `akhdan.dev/flea-market/*` as a sub-path on the existing Hugo site. Designed to be redeployable in different cities (Sendai today, Jakarta/Singapore/Sydney later) by changing environment variables, no code or schema changes.

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

## Stack

| Layer              | Choice                                                                                 | Notes                                                                     |
| ------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Framework          | TanStack Start (React)                                                                 | Native Cloudflare Workers target via `@tanstack/react-start/server-entry` |
| Build              | Vite (built into TanStack Start)                                                       |                                                                           |
| Deployment         | Cloudflare Workers                                                                     | `wrangler deploy`, `nodejs_compat` flag required                          |
| Routing on domain  | Cloudflare Workers Route `akhdan.dev/flea-market/*`                                    | Hugo on Pages serves everything else                                      |
| Router basepath    | `/flea-market`                                                                         | Configured in TanStack Router                                             |
| Database           | Turso (libSQL), primary region: Tokyo (`nrt`)                                          | Free tier: 5GB / 500M reads / 10M writes per month                        |
| DB client          | `@libsql/client/web`                                                                   | Fetch-based, works in Workers                                             |
| ORM                | Drizzle (`drizzle-orm/libsql`)                                                         |                                                                           |
| Image storage      | Cloudflare R2                                                                          | 10GB free tier; zero egress                                               |
| Image optimization | Cloudflare Image Transformations on R2-sourced URLs                                    | 5,000 unique transforms/month free; cached forever once generated         |
| UI components      | shadcn/ui + Tailwind CSS                                                               |                                                                           |
| Upload UI          | react-dropzone                                                                         | Drag-and-drop file picker; Worker handles the actual upload to R2         |
| Cart state         | Zustand + localStorage                                                                 | Client-side only, no server state                                         |
| Admin auth         | Single token in `env.ADMIN_TOKEN`, SHA-256 + `timingSafeEqual`, httpOnly signed cookie |                                                                           |

## High-level diagram

```text
                    akhdan.dev
                        |
        +---------------+---------------+
        |                               |
    /flea-market/*               everything else
        |                               |
        v                               v
  Cloudflare Worker              Cloudflare Pages
  (TanStack Start)               (Hugo static site)
        |
        +-----> Turso (libSQL, Tokyo)        <- item data, translations
        +-----> Cloudflare R2                <- photo originals
        +-----> /cdn-cgi/image/...           <- on-the-fly resize/format
```

## Routing strategy

The trickiest part of the architecture. Two Cloudflare products on the same domain, path-split:

1. The flea-market app is deployed as a Worker (not a Pages app)
2. A Workers Route in the Cloudflare dashboard binds `akhdan.dev/flea-market/*` to the Worker
3. Cloudflare matches most-specific-route-first, so non-matching paths fall through to the existing Pages project (Hugo)
4. The TanStack Router config sets `basepath: '/flea-market'` so all generated links and asset URLs are correct

Caveats:

- Hardcoded `href` strings will not pick up the basepath. Always use `<Link>` from TanStack Router
- Static assets served by the Worker need to be emitted under `/flea-market/_build/...` - Vite handles this when `base` is set in the Vite config to match
- The Workers Route precedence matters; verify with a deploy that Hugo paths still load

## Data model

### `items`

| Column           | Type             | Notes                                                                                                                            |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | uuid pk          |                                                                                                                                  |
| `slug`           | text unique      | Format: `YYYYMMDD-{kebab-case-title}`. Indexed                                                                                   |
| `price_amount`   | integer nullable | In minor units (yen and rupiah have 0 decimals, SGD and AUD have 2). Null means free                                             |
| `price_currency` | text nullable    | ISO 4217: `JPY` / `IDR` / `SGD` / `AUD`. Null when free                                                                          |
| `status`         | text             | `available` / `reserved` / `sold`                                                                                                |
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

## Money handling

Storage is in minor units. Concretely:

```ts
MINOR_UNITS = {
  JPY: 0,
  IDR: 0,
  SGD: 2,
  AUD: 2,
};
```

A ¥5,000 item is stored as `price_amount = 5000`, `price_currency = 'JPY'`. An S$50.25 item is `price_amount = 5025`, `price_currency = 'SGD'`.

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

Result: `¥5,000`, `Rp250,000`, `S$50.25`, `A$80.00`.

The locale is hardcoded to `'en'` regardless of page language. Decision: currency symbols and digit grouping are stable across visitors, and a mixed-locale UX (English UI rendering `Rp1.000.000` Indonesian-style) is more jarring than helpful at this scale. Revisit only if the catalog targets a single non-English locale exclusively.

Admin form: a currency dropdown defaults to `env.DEFAULT_CURRENCY`. The amount input enforces whole numbers when the selected currency has 0 minor units, otherwise allows decimals.

## i18n

The two-table design (items + item_translations) decouples language from item identity.

**Language state mechanism**:

A single cookie `lang` (values `en` or `id`), `Path=/flea-market`, 1-year expiry. The server resolves the active language on every request in this order:

1. `lang` cookie if present and valid
2. `Accept-Language` header parsed for `en` / `id` (any other value falls through)
3. `env.DEFAULT_LANGUAGE` (defaults to `en`)

The resolved language is passed to loaders and components via the route context so SSR renders the correct translation on first paint - no client-side flip after hydration.

**Toggle endpoint**:

`GET /flea-market/lang/:lang` validates the `:lang` param against `{en, id}`, sets the cookie with the attributes above, then 302-redirects to `Referer` (verified to be on the `akhdan.dev` origin; falls back to `/flea-market/` otherwise). The toggle button in the UI is a plain `<a>` to this endpoint; a full page reload is acceptable.

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
2. Each file is POSTed to `/flea-market/admin/api/upload?slug={slug}` as a binary body
3. Worker checks the admin cookie, generates key `items/{slug}/{timestamp}-{rand}.<ext>` where `<ext>` is derived from the request's `Content-Type` (`jpg` / `png` / `webp` / `heic`; other types rejected with 415), then calls `env.BUCKET.put(key, request.body, { httpMetadata: { contentType } })`
4. Worker returns the key; the form appends it to the item's `photos` array
5. On save, the items row stores `photos: [{key, alt?}, ...]`

Serving:

- A public R2 custom domain (e.g. `media.akhdan.dev`) exposes raw originals at predictable URLs
- The app renders images with Cloudflare's image transformation URL prefix:

  ```text
  /cdn-cgi/image/width={w},quality=75,format=auto/https://media.akhdan.dev/{key}
  ```

- List page uses width=400, detail page uses width=1200, open-graph cards use width=1200&height=630&fit=cover
- All variants are cached at the edge after first generation

Counts: ~30 items × 3 variants = 90 unique transformations. The 5,000/month free tier is never close to threatened.

## Admin auth

Single-admin, token-in-cookie design.

**Setup**:

- A 32-byte random hex token is generated locally with `openssl rand -hex 32`
- Stored as a Worker secret: `wrangler secret put ADMIN_TOKEN`
- A second secret, `COOKIE_SECRET`, signs the session cookie

**Login flow**:

1. `GET /flea-market/admin/login` shows a single password input
2. `POST /flea-market/admin/login` compares submitted password to `env.ADMIN_TOKEN` using SHA-256 + `timingSafeEqual` (constant-time; `timingSafeEqual` is available under `nodejs_compat`)
3. On match, sets the `admin_session` cookie:
   - **Value**: the literal string `admin` HMAC-SHA256-signed with `env.COOKIE_SECRET` (format: `admin.<hex-mac>`)
   - **Attributes**: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/flea-market`, `Max-Age=2592000` (30 days)
4. On mismatch, returns a 401 with a generic error

The payload is intentionally a constant. A single-admin app has nothing per-session to encode; the signature is the only thing standing between a forged value and access. If you ever add a second person, evolve the payload to `{iat, v}` with a version field that lets you mass-invalidate without rotating the secret.

**Authorization**:

- All routes under `/flea-market/admin/*` (except `/login`) require the cookie to validate
- Validation happens in a parent route loader so it isn't repeated across handlers
- Failed validation redirects to `/flea-market/admin/login`

**Logout**:

- `POST /flea-market/admin/logout` clears the cookie

**Revocation**:

Two distinct rotations with distinct effects:

- `wrangler secret put ADMIN_TOKEN` - blocks future logins with the old password. Does **not** invalidate already-issued cookies (they're signed with `COOKIE_SECRET`, not `ADMIN_TOKEN`).
- `wrangler secret put COOKIE_SECRET` - invalidates every currently-issued session. Next request from any existing cookie fails signature verification and redirects to login.

If the admin password leaks, rotate both.

**What this does not protect against**:

- Compromise of Cloudflare account (out of scope; same risk applies to any cloud-deployed app)
- The admin's device being compromised (out of scope)

## Cart and contact flow

Client-side, no DB involvement.

**State**: a Zustand store holds `Set<itemSlug>`, persisted to `localStorage` under key `flea-market:cart`. Initialized from localStorage on app mount.

**UI**:

- Each item card on the list and detail pages shows an "Add to cart" / "Remove" button (toggled by cart membership)
- A floating badge in the corner shows cart count; clicking it opens a Sheet (shadcn)
- The Sheet lists selected items with title, price, remove button
- A "Total" section sums prices per currency (so a JPY + SGD cart shows `¥5,000 + S$50.00`)
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
  "routes": [
    { "pattern": "akhdan.dev/flea-market/*", "zone_name": "akhdan.dev" },
  ],
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "flea-market" }],
  "vars": {
    "DEFAULT_CURRENCY": "JPY",
    "SUPPORTED_CURRENCIES": "JPY,IDR,SGD,AUD",
    "DEFAULT_LANGUAGE": "en",
    "FB_HANDLE": "your-facebook-handle",
    "R2_PUBLIC_BASE": "https://media.akhdan.dev",
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
- Workers Route is declared in `wrangler.jsonc` and provisioned on deploy
- R2 bucket is created once via `wrangler r2 bucket create flea-market`
- Public R2 domain is enabled once via dashboard (one-time, doesn't move)
- Image Transformations is enabled per-zone in the Cloudflare dashboard (one-time)
- Turso DB is created via `turso db create flea-market --location nrt`
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
