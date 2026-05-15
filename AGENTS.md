# Flea Market Agent Guide

## 1) Mission

A self-hosted flea-market listing app served at `flea-market.akhdan.dev` as a
Cloudflare Workers Custom Domain. Single-admin CRUD, public browse +
cart-to-contact flow, bilingual content (English required, Indonesian optional).

Core product model:

1. One owner, one site, one catalog (~30 active items at a time).
2. Items can carry any supported currency; the cart shows per-currency
   subtotals rather than converting. `DEFAULT_CURRENCY` is the admin form
   default, not an instance-wide constraint.
3. Visitors browse, filter, and assemble a cart that generates a structured contact
   message; no payments, no accounts.
4. The admin authenticates with a single token-cookie; there is no concept of users
   beyond "admin" and "visitor".

## 2) Engineering Principles

1. Type-safe end-to-end (TanStack Router params, Drizzle schema, server fn payloads).
2. Free to run at the documented scale; keep us inside every free tier ceiling in
   `ARCHITECTURE.md` #"Cost ceiling".
3. Prefer explicit, type-safe code over clever; favor clarity since I'll come back
   months later.
4. Programmatic infrastructure where reasonable. One-time dashboard clicks (Image
   Transformations enablement, Workers Custom Domain provisioning) are documented in
   `OPERATIONS.md`; everything else lives in `wrangler.jsonc` or scripts.
5. Don't introduce scripts, packages, configs, dependencies, env vars, DB columns, or
   files unless they are exercised by code in the same commit.
6. Don't design for hypothetical future languages or features. The v2 list in
   `ARCHITECTURE.md` #"Future considerations" is the parking lot; do not pre-build for it.
7. Prefer default tooling behavior until a current requirement justifies customization.
   When a non-default config (TypeScript, Tailwind, Vite, Wrangler) is needed, leave a
   comment explaining why.

## 3) Technical Reference

- `ARCHITECTURE.md` - canonical reference for stack, routing strategy, data model,
  money handling, i18n, image pipeline, admin auth, cart flow, configuration, and the
  free-tier cost ceiling. Also captures non-obvious build/dev-tooling invariants.
- `OPERATIONS.md` - re-bootstrap and recovery notes: one-time Cloudflare setup, deploy
  verification, wrangler footguns, secret rotation.
- This file (`AGENTS.md) - implementation guardrails for
  humans and coding agents.

When a decision in code conflicts with these docs, update the docs in the same commit
or push back on the change.

For external library/framework/CLI docs (TanStack Start/Router, Drizzle, libSQL,
Wrangler, shadcn, Zustand, react-dropzone), prefer Context7 over web search - it
fetches current docs and avoids stale training data.

## 4) Working Norms

### Workflow

The initial build is shipped (app is feature-complete and live at
`flea-market.akhdan.dev`). Subsequent work lands as discrete tasks - typically
one logical change per commit. Split into multiple commits only when there is a
clear reviewability benefit (e.g. isolating raw generator/scaffold output from
customizations, or separating a dependency bump from the code change that
consumes it). Splits should be coarse and meaningful, not per-file churn.

1. After every task, prepare changes and run `pnpm typecheck`, `pnpm lint`, and
   `pnpm format`; then **stop and wait for review**. Agents must NOT run
   `pnpm run deploy`, `wrangler deploy`, or any production-touching command
   without explicit user approval. The user reviews the diff, commits, deploys,
   and verifies in prod themselves. Type checks and unit tests verify correctness
   of code; only production verifies correctness of the deployment (Workers Route
   precedence, R2 binding, secrets, Image Transformations, cache) - but that
   verification happens after a human-driven deploy, not before.
2. If a task turns into a multi-hour rabbit hole, stop and ask before continuing.
3. Keep `ARCHITECTURE.md` updated when implementation reveals a wrong assumption.
   The doc is the source of truth, not a historical artifact. If a one-time
   setup or recovery procedure changes, update `OPERATIONS.md` too.

### Code

1. Use `<Link>` from TanStack Router for all internal navigation. The app is at
   the root of its own subdomain (no basepath), so hardcoded `href` strings
   would not break URLs - but `<Link>` is still required for client-side
   routing benefits: preload-on-intent, scroll restoration, no full reload.
2. Money is stored in minor units, always. See `ARCHITECTURE.md` #"Money handling".
   Never multiply or divide a stored amount outside `src/lib/money.ts`.
3. Images render through `/cdn-cgi/image/...` URLs via the `optimizedImageUrl` helper;
   do not embed raw R2 URLs in templates.
4. Server-only code (DB client, R2 binding, secret reads, request-context helpers
   like `getCookie` / `getRequestHeader` / `setResponseHeader` from
   `@tanstack/react-start/server`) belongs in `createServerFn` handlers or route
   loaders, never in components. When a helper module touches any of those - and
   would otherwise be importable from the client - name it `*.server.ts` (e.g.
   `src/lib/lang.server.ts`) so TanStack Start's bundler refuses client imports
   at build time instead of letting them fail at runtime.
5. URL search params are the source of truth for filter/sort state on the list page;
   define their schema with `zod` so TanStack Router can type them.
6. Enum-shaped column values (`status`, `language`) live as `as const` arrays in
   `src/db/schema.ts` (e.g. `LANGUAGES`, `ITEM_STATUSES`) and are imported
   wherever runtime validation is needed - type guards, route param checks, toggle
   endpoints. Single source of truth for both the TypeScript union type and the
   runtime allow-list; adding a third language means editing one constant.
7. Cart state lives only in the Zustand store + localStorage; never persist cart to
   Turso.
8. shadcn components use Base UI primitives (`components.json` has `style: base-nova`),
   not Radix. New `shadcn add` invocations pull Base UI variants automatically. When
   consulting shadcn docs, use the Base UI examples (`/docs/components/base/...`),
   not the Radix paths. See `.agents/skills/shadcn/rules/base-vs-radix.md` for the
   API differences (e.g. `render` prop vs `asChild`).
9. The app is **dark mode only** - `.dark` is set on `<html>` in `src/routes/__root.tsx`.
   Do not add `next-themes`, a `ThemeProvider`, a toggle, or shadcn's TanStack Start
   `ScriptOnce` recipe; those exist to support user choice, which is an explicit
   non-goal. When overriding a shadcn Button's background on `outline` / `ghost` /
   `secondary` (e.g. a `bg-black/40` photo-overlay), also set the matching `dark:bg-*`
   variant - those base variants carry `dark:` rules like `dark:bg-input/30` that win
   over a plain `bg-*` override at CSS source order and repaint the button
   white-translucent. See `NAV_BUTTON_CLASS` in `src/components/detail-content.tsx`
   for the pattern.

### Dependencies and tooling

1. Use `pnpm` for installs; do not hand-edit the `dependencies` block of
   `package.json`.
2. Lockfile changes belong in the commit that introduces them.
3. Prefer the version of a library that ships with the TanStack Start scaffold (e.g.,
   Tailwind v4 vs v3) unless there's a concrete reason to deviate.

### Comments

1. Default to writing no comments. Add one only when the WHY is non-obvious: a hidden
   constraint, a workaround, a free-tier interaction, behavior that would surprise a
   reader.
2. Don't explain WHAT the code does - well-named identifiers handle that. Don't
   reference the current task, fix, or callers ("added for the cart flow",
   "handles issue from the auth rework"); those belong in commit messages and
   rot fast.
3. Use `TODO:` for a definite plan to fix (the fix WILL be built when X lands). Use
   `NOTE:` for conditional or deferred behavior (the fix MAY never be built; revisit
   if X happens). Both must state the trigger concretely, not "eventually".
4. Comments and JSDoc should be readable by a junior engineer. Lead with "what
   breaks" or "how it happens" before naming the fix.

### Commits

1. Conventional Commits. Use the tightest accurate scope: `feat(admin)`,
   `fix(cart)`, `chore(deps)`. Omit scope when a change is genuinely global.
2. Every commit should answer: what concrete behavior is delivered now, and what is
   intentionally deferred.

## 5) Secrets and Local Dev

1. Never commit secrets. Three gitignored locations carry them:
   - `.dev.vars` (local): `ADMIN_TOKEN`, `COOKIE_SECRET`, and the local Turso
     URL/token (`http://127.0.0.1:8080` + `local-unused`).
   - `.dev.vars.prod` (drizzle-kit/scripts only, never read by the running
     Worker): the real Turso URL + auth token, and the R2 API token
     credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`).
   - `wrangler secret` (Worker runtime in production): `ADMIN_TOKEN`,
     `COOKIE_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
2. Local dev points at a **local** libSQL instance, not prod. `.dev.vars` carries
   `TURSO_DATABASE_URL=http://127.0.0.1:8080` and `TURSO_AUTH_TOKEN=local-unused`.
   The server is started by `pnpm db:local` (`turso dev --db-file .turso/local.db`).
   The auth token is a placeholder because drizzle-kit rejects an empty value,
   but the local server accepts any token when no JWT key is configured.
   Schema/seed/check operations against prod require an explicit opt-in: prefix
   with `DB_REMOTE=1` (e.g. `DB_REMOTE=1 pnpm db:push`; also `db:seed`,
   `db:check`, `db:studio`). `r2:prune` is dual-mode - defaults to local R2,
   takes `DB_REMOTE=1` to target prod. Both `drizzle.config.ts` and
   `scripts/_env.ts` honor the flag.
3. Keep `.dev.vars.prod` and `wrangler secret` in sync. Silent divergence
   between the file used by drizzle-kit and the secrets used by the running
   Worker is the most common foot-gun in this stack.
4. Two distinct rotations:
   - Rotate `ADMIN_TOKEN` if the admin password is suspected leaked. This blocks
     future logins with the old password but does _not_ invalidate already-issued
     session cookies (they're signed with `COOKIE_SECRET`).
   - Rotate `COOKIE_SECRET` to invalidate all currently-issued sessions. The next
     request from any existing session will fail signature verification and be
     redirected to login.
5. Dev server is `pnpm dev` (Vite + `@cloudflare/vite-plugin` running Miniflare).
   That gives you real R2/KV/env bindings from `.dev.vars` and `wrangler.jsonc`.
   Run `pnpm db:local` in a second terminal so the libSQL server is up before
   `pnpm dev` issues queries. Do not run `wrangler dev` separately.

## 6) Tooling

1. Package manager: `pnpm` only.
2. Lint: `oxlint`. Format: `oxfmt`. Both are fast and zero-config by default; only
   add a config file when a current rule disagreement justifies it.
3. Type checks: `tsc --noEmit` via `pnpm typecheck`.
4. Git hooks via `lefthook` (only if/when one is genuinely needed; do not add hooks
   speculatively).
5. Standard scripts in `package.json`: `dev`, `build`, `deploy`, `typecheck`, `lint`,
   `lint:fix`, `format`, `format:fix`, `db:local`, `db:push`, `db:studio`,
   `db:seed`, `db:check`, `r2:prune`, `cf-typegen`.

## 7) What This App Will Not Become

Listed explicitly so we don't drift into them by accident. From `ARCHITECTURE.md` #"Non-goals":

- Multi-user accounts, social login, password recovery.
- Payment processing.
- Server-side search, full-text indexing.
- Cross-device cart persistence.
- SEO optimization, sitemaps, RSS.
- Currency conversion across instances.

If a feature request implies any of these, push back or explicitly defer to v2 before
writing code.

## 8) Decision Authority

1. `ARCHITECTURE.md` is the canonical architecture reference (stack, data model,
   routing strategy, invariants).
2. `OPERATIONS.md` is the canonical reference for one-time setup, recovery, and
   anything that happens outside the repo (Cloudflare dashboard, CLI auth).
3. `AGENTS.md` (this file) describes implementation guardrails for
   humans and coding agents.
4. These are living documents - update them when decisions change, and treat them as
   the authoritative source of truth over any conflicting code comment or PR
   description.
