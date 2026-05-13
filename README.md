# flea-market

A self-hosted secondhand-listing app for [akhdan.dev](https://akhdan.dev).

Live at **<https://flea-market.akhdan.dev>**, a dedicated Cloudflare Workers subdomain alongside the Hugo site at the apex `akhdan.dev`. Single-admin CRUD, public browse plus a cart-to-contact flow, bilingual content (English required, Indonesian optional). Designed to redeploy in different cities (Sendai, Jakarta, Singapore, Sydney) by changing env vars - no code or schema changes.

## Stack

TanStack Start (React) on Cloudflare Workers, Turso (libSQL) in Tokyo, Cloudflare R2 + Image Transformations for photos, Tailwind v4 + shadcn/ui, Zustand for cart state. Type-safe end to end. Free at the documented scale.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the canonical reference.

## Local development

```bash
pnpm install
pnpm dev              # Vite + Miniflare (real R2/KV/env bindings from .dev.vars and wrangler.jsonc)
```

Required secrets live in `.dev.vars` (gitignored) for local and `wrangler secret put <NAME>` for production. See `AGENTS.md` §5.

## Deploy

```bash
pnpm run deploy       # vite build && wrangler deploy
```

The Workers Custom Domain on `flea-market.akhdan.dev` is declared in `wrangler.jsonc` and provisioned on first deploy (DNS + TLS, no dashboard clicks).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Local dev server with Cloudflare bindings via Miniflare |
| `pnpm build` | Vite production build |
| `pnpm run deploy` | Build and `wrangler deploy` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | `oxlint` / `oxfmt` (check mode) |
| `pnpm lint:fix` / `pnpm format:fix` | Apply fixes |
| `pnpm cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` bindings |
| `pnpm db:push` / `pnpm db:studio` / `pnpm db:seed` | Drizzle + Turso (added in Step 4) |

## Docs

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - stack, data model, routing strategy, money handling, i18n, image pipeline, admin auth, cart flow, configuration, cost ceiling.
- [`PLAN.md`](./PLAN.md) - step-by-step build order. Each step is a deployable unit, verified in production before moving on.
- [`AGENTS.md`](./AGENTS.md) (symlinked as `CLAUDE.md`) - implementation guardrails for humans and coding agents.
