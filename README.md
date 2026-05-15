# flea-market

A self-hosted secondhand-listing app for [akhdan.dev](https://akhdan.dev).

Live at **<https://flea-market.akhdan.dev>**, a dedicated Cloudflare Workers subdomain alongside the Hugo site at the apex `akhdan.dev`. Single-admin CRUD, public browse plus a cart-to-contact flow, bilingual content (English required, Indonesian optional). Designed to redeploy in different cities (Sendai today, Jakarta next) by changing env vars - no code or schema changes.

## Stack

TanStack Start (React) on Cloudflare Workers, Turso (libSQL) in Tokyo, Cloudflare R2 + Image Transformations for photos, Tailwind v4 + shadcn/ui, Zustand for cart state. Type-safe end to end. Free at the documented scale.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the canonical reference.

## Local development

Local dev runs against a local libSQL server, never the prod Turso DB. Two terminals:

```bash
pnpm install
pnpm db:local         # Terminal 1: turso dev --db-file .turso/local.db (serves http://127.0.0.1:8080)
pnpm dev              # Terminal 2: Vite + Miniflare with .dev.vars + wrangler.jsonc bindings
```

First-time setup also needs `pnpm db:push` (creates the schema in the local file) and optionally `pnpm db:seed` (sample rows).

The `turso` CLI is required: `brew install tursodatabase/tap/turso` (or follow https://docs.turso.tech/cli/installation). Local secrets live in `.dev.vars` (gitignored); production secrets are set with `wrangler secret put <NAME>`.

### Prod schema/seed/prune

Operations that touch the production DB or R2 bucket require an explicit `DB_REMOTE=1` flag, which routes drizzle-kit and the scripts to a separate `.dev.vars.prod` file (gitignored, holds prod URL + auth token and R2 API credentials):

```bash
DB_REMOTE=1 pnpm db:push                # apply schema changes to prod Turso
DB_REMOTE=1 pnpm db:check               # inspect prod row counts
DB_REMOTE=1 pnpm db:seed -- --force     # wipe + reseed prod (rarely; --force required when rows exist)
DB_REMOTE=1 pnpm r2:prune               # list orphan R2 objects (dry run by default)
DB_REMOTE=1 pnpm r2:prune -- --apply    # delete listed orphans
```

`r2:prune` works against both local and prod. Without `DB_REMOTE=1` it uses Miniflare's local R2 via `getPlatformProxy` — stop `pnpm dev` first to avoid `.wrangler/state` lock contention. With `DB_REMOTE=1`, it hits prod R2 via the S3 API and needs R2 API token credentials in `.dev.vars.prod` (see comments in `.dev.vars.example`).

`pnpm db:seed` now auto-uploads the fixture JPEGs to whichever R2 matches the DB target (`--local` or `--remote`). Old keys from previous seeds stick around as orphans until you run `pnpm r2:prune`.

See `AGENTS.md` #5 for the full secret/rotation policy.

## Deploy

```bash
pnpm run deploy       # vite build && wrangler deploy
```

The Workers Custom Domain on `flea-market.akhdan.dev` is declared in `wrangler.jsonc` and provisioned on first deploy (DNS + TLS, no dashboard clicks).

## Scripts

| Command                                            | What it does                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                         | Local dev server with Cloudflare bindings via Miniflare                                            |
| `pnpm build`                                       | Vite production build                                                                              |
| `pnpm run deploy`                                  | Build and `wrangler deploy`                                                                        |
| `pnpm typecheck`                                   | `tsc --noEmit`                                                                                     |
| `pnpm lint` / `pnpm format`                        | `oxlint` / `oxfmt` (check mode)                                                                    |
| `pnpm lint:fix` / `pnpm format:fix`                | Apply fixes                                                                                        |
| `pnpm cf-typegen`                                  | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` bindings                     |
| `pnpm db:local`                                    | Start the local libSQL server (`turso dev --db-file .turso/local.db`)                              |
| `pnpm db:push` / `pnpm db:studio` / `pnpm db:seed` | Drizzle + Turso. Prefix with `DB_REMOTE=1` to target prod                                          |
| `pnpm db:check`                                    | Print row counts. `DB_REMOTE=1 pnpm db:check` hits prod                                            |
| `pnpm r2:prune`                                    | List R2 keys not referenced by any item; `--apply` deletes them. `DB_REMOTE=1` switches to prod R2 |

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - stack, data model, routing strategy, money handling, i18n, image pipeline, admin auth, cart flow, configuration, cost ceiling.
- [`PLAN.md`](./PLAN.md) - step-by-step build order. Each step is a deployable unit, verified in production before moving on.
- [`AGENTS.md`](./AGENTS.md) (symlinked as `CLAUDE.md`) - implementation guardrails for humans and coding agents.
