# Operations

Re-bootstrap and recovery notes — the bits that aren't expressed in code or in `ARCHITECTURE.md` because they happen outside the repo (Cloudflare dashboard, CLI auth, one-time provisioning).

If you're standing this app up on a fresh Cloudflare account, or recovering from a corrupted local environment, read this first.

## Prerequisites

- Cloudflare account with the zone (e.g. `akhdan.dev`) configured
- Wrangler CLI installed and authenticated (`wrangler whoami` works)
- Turso CLI installed and authenticated (`turso auth whoami` works)
- Node.js 22+ and pnpm

## One-time Cloudflare setup

These steps create state in the Cloudflare account that `wrangler.jsonc` and `pnpm run deploy` rely on. Most can't be expressed in code.

1. **R2 bucket**: `wrangler r2 bucket create flea-market`. No public custom domain is provisioned — the Worker serves originals at `/images/<key>` via the `BUCKET` binding (see `ARCHITECTURE.md` #Image pipeline for the rationale).
2. **Image Transformations**: enable per-zone in the Cloudflare dashboard (Speed -> Optimization -> Image Transformations). One-time toggle, not codeable. Because the transformer and the source URL share the same zone, no entry in _Images -> Transformations -> Sources_ is required.
3. **Workers Custom Domain**: declared in `wrangler.jsonc` (`routes: [{ pattern: "flea-market.akhdan.dev", custom_domain: true }]`); `wrangler deploy` auto-creates the DNS record and TLS certificate on first deploy.
4. **Turso DB**:
   - `turso group list` — check for a Tokyo-region group. New accounts usually have a `default` group in the signup region.
   - If no Tokyo group exists: `turso group create default --location nrt`.
   - `turso db create flea-market --group default` (substitute the group name).
   - `turso db show flea-market` -> URL; `turso db tokens create flea-market` -> auth token.
5. **Worker secrets** (`wrangler secret put <NAME>` for each):
   - `ADMIN_TOKEN` — `openssl rand -hex 32`
   - `COOKIE_SECRET` — `openssl rand -hex 32`
   - `TURSO_DATABASE_URL` — from step 4
   - `TURSO_AUTH_TOKEN` — from step 4
   - `FB_HANDLE` — your real Messenger handle (e.g. `m.me/your-handle`). The committed `wrangler.jsonc` ships a placeholder; the secret overrides it at runtime so your real handle never lands in the repo.
   - `LINE_HANDLE` — your real LINE handle (e.g. `line.me/ti/p/...`). Same override pattern as `FB_HANDLE`.
6. **LINE QR image**: the cart drawer renders a QR at `/images/static/line-qr.jpg`, served from R2. Upload yours to R2 once:
   ```sh
   pnpm wrangler r2 object put flea-market/static/line-qr.jpg \
     --file=./path/to/your-line-qr.jpg --content-type=image/jpeg --remote
   ```
   `r2:prune` is configured to skip the `static/` prefix so this object is not treated as an orphan. If `LINE_HANDLE` changes, regenerate the QR and re-upload.

Mirror the same values in `.dev.vars` (gitignored) for local Miniflare, **except** the Turso ones — local dev points at a local libSQL server (see `AGENTS.md` #5). For local QR rendering during `pnpm dev`, upload the QR to local Miniflare R2 the same way without `--remote`, or just accept the broken image in dev.

## Local dev

Two terminals:

- `pnpm db:local` — starts `turso dev --db-file .turso/local.db` on `http://127.0.0.1:8080`. Leave running.
- `pnpm dev` — Vite + `@cloudflare/vite-plugin` (Miniflare). Picks up `.dev.vars` and `wrangler.jsonc` bindings automatically.

For schema / seed / prune commands against **production** Turso/R2, prefix with `DB_REMOTE=1` (e.g. `DB_REMOTE=1 pnpm db:push`). Credentials are read from `.dev.vars.prod` (gitignored, never read by the running Worker). See `AGENTS.md` #5 for the full split.

## Deploy verification

1. `pnpm run deploy` (`vite build && wrangler deploy`).
2. **TLS provisioning lag**: Cloudflare's Advanced Certificate is typically ready within a minute. If the first HTTPS request returns a TLS error, wait and retry — don't redeploy in a tight loop.
3. Confirm the Worker (not Pages or some other product) is actually serving the request: run `pnpm wrangler tail flea-market` in a second terminal and hit the URL. A request entry in the tail is the only definitive signal. Response headers like `cf-ray` and `cf-cache-status` only confirm Cloudflare-proxying, not which product. `CF-Worker` is a Worker-to-origin subrequest header, not a response header to visitors.
4. Smoke-test the auth loop: log in at `/admin/login/`, hit `/admin/`, log out. Tail shows the cookie set and clear.

## Wrangler footguns

- **R2 object operations default to local Miniflare**, not production. To put or get against the real bucket, add `--remote`:
  ```sh
  pnpm wrangler r2 object put flea-market/<key> --file=./photo.jpg --content-type=image/jpeg --remote
  ```
- **`wrangler deploy` is additive for triggers, not reconciliatory.** Routes removed from `wrangler.jsonc` are **not** cleaned off the zone — `wrangler triggers deploy` doesn't remove orphans either. Stale routes keep intercepting traffic. Clean up via dashboard (Workers -> Triggers -> Routes) or REST:
  ```sh
  # list
  curl -H "Authorization: Bearer $WRANGLER_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes"
  # delete
  curl -X DELETE -H "Authorization: Bearer $WRANGLER_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes/$ROUTE_ID"
  ```
  The Wrangler OAuth token at `~/Library/Preferences/.wrangler/config/default.toml` has the `workers_routes:write` scope and works as a Bearer token here.

## Secret rotation

Two distinct rotations with distinct effects (see `ARCHITECTURE.md` #Admin auth):

- `wrangler secret put ADMIN_TOKEN` — blocks future logins with the old password. Does **not** invalidate already-issued cookies.
- `wrangler secret put COOKIE_SECRET` — invalidates every currently-issued session. Next request from any existing cookie fails signature verification and redirects to login.

If the admin password leaks, rotate both. Keep `.dev.vars` in sync with the new values, or local dev login stops working.
