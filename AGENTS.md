# Flea Market Agent Guide

## 1) Mission

A self-hosted flea-market listing app served at `akhdan.dev/flea-market/*` as a sub-path
of the existing Hugo site. Single-admin CRUD, public browse + cart-to-contact flow,
bilingual content (English required, Indonesian optional).

Core product model:

1. One owner curates a small catalog (~30 active items) per deployment.
2. Each deployment targets one city / one default currency (Sendai today; Jakarta,
   Singapore, Sydney later) - driven by env vars, no code or schema changes.
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
4. Programmatic infrastructure where reasonable. One-time dashboard clicks (R2 custom
   domain, Image Transformations enablement) are documented in `PLAN.md`; everything
   else lives in `wrangler.jsonc` or scripts.
5. Don't introduce scripts, packages, configs, dependencies, env vars, DB columns, or
   files unless they are exercised by code in the same commit.
6. Don't design for hypothetical future cities, languages, or features. The v2 list in
   `ARCHITECTURE.md` #"Future considerations" is the parking lot; do not pre-build for it.
7. Prefer default tooling behavior until a current requirement justifies customization.
   When a non-default config (TypeScript, Tailwind, Vite, Wrangler) is needed, leave a
   comment explaining why.

## 3) Technical Reference

- `ARCHITECTURE.md` - canonical reference for stack, routing strategy, data model,
  money handling, i18n, image pipeline, admin auth, cart flow, configuration, and the
  free-tier cost ceiling.
- `PLAN.md` - step-by-step build order. Each step is a deployable unit; do not start
  the next step until the previous one is live and verified in production.
- This file (`AGENTS.md`, symlinked as `CLAUDE.md`) - implementation guardrails for
  humans and coding agents.

When a decision in code conflicts with these docs, update the docs in the same commit
or push back on the change.

For external library/framework/CLI docs (TanStack Start/Router, Drizzle, libSQL,
Wrangler, shadcn, Zustand, react-dropzone), prefer Context7 over web search - it
fetches current docs and avoids stale training data.

## 4) Working Norms

### Workflow

1. Each `PLAN.md` step lands as one or more commits, and the next step does not
   start until the previous step is committed. The default is one commit per step;
   split a step into multiple commits only when there is a clear reviewability
   benefit (e.g. isolating raw generator/scaffold output from our customizations,
   or separating a dependency bump from the code change that consumes it). Splits
   should be coarse and meaningful, not per-file churn.
2. Run `pnpm run deploy` after every step and verify in production before moving on.
   Type checks and unit tests verify correctness of code; only production verifies
   correctness of the deployment (Workers Route precedence, R2 binding, secrets,
   Image Transformations, cache).
3. If a step turns into a multi-hour rabbit hole, stop and ask before continuing.
4. Keep `ARCHITECTURE.md` and `PLAN.md` updated when implementation reveals a wrong
   assumption. The docs are the source of truth, not a historical artifact.

### Code

1. Use `<Link>` from TanStack Router for all internal navigation - hardcoded `href`
   strings will not pick up the `/flea-market` basepath.
2. Money is stored in minor units, always. See `ARCHITECTURE.md` #"Money handling".
   Never multiply or divide a stored amount outside `src/lib/money.ts`.
3. Images render through `/cdn-cgi/image/...` URLs via the `optimizedImageUrl` helper;
   do not embed raw R2 URLs in templates.
4. Server-only code (DB client, R2 binding, secret reads) belongs in `createServerFn`
   handlers or route loaders, never in components.
5. URL search params are the source of truth for filter/sort state on the list page;
   define their schema with `zod` so TanStack Router can type them.
6. Cart state lives only in the Zustand store + localStorage; never persist cart to
   Turso.

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
   reference the current task, fix, or callers ("added for the cart flow", "handles
   issue from PLAN step 7"); those belong in commit messages and rot fast.
3. Use `TODO:` for a definite plan to fix (the fix WILL be built when X lands). Use
   `NOTE:` for conditional or deferred behavior (the fix MAY never be built; revisit
   if X happens). Both must state the trigger concretely, not "eventually".
4. Comments and JSDoc should be readable by a junior engineer. Lead with "what
   breaks" or "how it happens" before naming the fix.
5. Do not reference `PLAN.md` step numbers in code comments - step numbering shifts.
   Reference by concept when context is needed, or omit.

### Commits

1. Conventional Commits. Use the tightest accurate scope: `feat(admin)`,
   `fix(cart)`, `chore(deps)`. Omit scope when a change is genuinely global.
2. Every commit should answer: what concrete behavior is delivered now, and what is
   intentionally deferred.

## 5) Secrets and Local Dev

1. Never commit secrets. `ADMIN_TOKEN`, `COOKIE_SECRET`, `TURSO_DATABASE_URL`, and
   `TURSO_AUTH_TOKEN` live in `wrangler secret` for production and `.dev.vars` for
   local - `.dev.vars` is gitignored.
2. Keep `.dev.vars` and `wrangler secret` in sync. Silent divergence between local
   and prod is the most common foot-gun in this stack.
3. Two distinct rotations:
   - Rotate `ADMIN_TOKEN` if the admin password is suspected leaked. This blocks
     future logins with the old password but does _not_ invalidate already-issued
     session cookies (they're signed with `COOKIE_SECRET`).
   - Rotate `COOKIE_SECRET` to invalidate all currently-issued sessions. The next
     request from any existing session will fail signature verification and be
     redirected to login.
4. Dev server is `pnpm dev` (Vite + `@cloudflare/vite-plugin` running Miniflare).
   That gives you real R2/KV/env bindings from `.dev.vars` and `wrangler.jsonc`. Do
   not run `wrangler dev` separately.

## 6) Tooling

1. Package manager: `pnpm` only.
2. Lint: `oxlint`. Format: `oxfmt`. Both are fast and zero-config by default; only
   add a config file when a current rule disagreement justifies it.
3. Type checks: `tsc --noEmit` via `pnpm typecheck`.
4. Git hooks via `lefthook` (only if/when one is genuinely needed; do not add hooks
   speculatively).
5. Standard scripts in `package.json`: `dev`, `build`, `deploy`, `typecheck`, `lint`,
   `lint:fix`, `format`, `format:fix`, `db:push`, `db:studio`, `db:seed`,
   `cf-typegen`.

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
2. `PLAN.md` is the execution roadmap.
3. `CLAUDE.md` / `AGENTS.md` (this file) describes implementation guardrails for
   humans and coding agents.
4. These are living documents - update them when decisions change, and treat them as
   the authoritative source of truth over any conflicting code comment or PR
   description.
