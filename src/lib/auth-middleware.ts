import { redirect } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/auth.server.ts";

// Server-function middleware that gates handlers behind a valid admin
// session cookie. Chain onto every mutating server fn:
//
//   createServerFn({ method: "POST" })
//     .middleware([requireAdmin])
//     .inputValidator(...)
//     .handler(...)
//
// Why this file works despite the import-protection plugin: every
// reference to `auth.server.ts` (and the `cloudflare:workers` env, and
// `getCookie` from the server-only @tanstack/react-start/server entry)
// lives inside the `.server()` callback below. The plugin's AST
// analyzer treats `.server()` of a `createMiddleware` call as a safe
// boundary - identical to how it treats `.handler()` of a
// `createServerFn` (see start-plugin-core's
// import-protection/analysis.js `isCompilerSafeBoundaryCall`). Route
// files import `requireAdmin` from this non-`.server.ts` module
// without restriction. Same trick `src/lib/item-actions.ts` uses to
// share `setItemStatus`.
//
// No context is passed downstream - the middleware is a gate, not a
// session loader. If we ever need user identity in the handler we'd
// thread it through `next({ context: { session } })`.
export const requireAdmin = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
    throw redirect({ to: "/admin/login/" });
  }
  return next();
});
