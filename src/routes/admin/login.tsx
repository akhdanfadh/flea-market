import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_PAYLOAD,
  buildSessionCookieHeader,
  isAdminSession,
  signCookie,
  verifyToken,
} from "@/lib/auth.server.ts";

// Sentinel is `yes`, not `1`, because TanStack Router uses
// `parseSearchWith(JSON.parse)` by default - each search value is fed through
// JSON.parse, so `?failed=1` arrives at validateSearch as the NUMBER 1, not
// the string "1". A schema of `z.literal("yes")` (or `z.string()`) rejects
// the number, `.catch(undefined)` fires, and the key gets dropped during
// outbound URL canonicalization. A non-JSON-valid token like `yes` causes
// JSON.parse to throw, the parser falls back to the raw string, and the
// value round-trips intact.
const searchSchema = z.object({
  failed: z.literal("yes").optional().catch(undefined),
});

// POST instead of GET for the same reason as requireAdminSession in _auth.tsx:
// uncached by default (POST isn't heuristically HTTP-cached the way a no-arg
// GET can be), so a stale "no redirect" response can't outlive a logout.
const redirectIfAuthed = createServerFn({ method: "POST" }).handler(async () => {
  if (await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET)) {
    throw redirect({ to: "/admin/" });
  }
});

export const Route = createFileRoute("/admin/login")({
  validateSearch: searchSchema,
  beforeLoad: () => redirectIfAuthed(),
  component: LoginPage,
  server: {
    handlers: {
      POST: async ({ request }) => {
        const form = await request.formData();
        const password = form.get("password");
        const isHttps = new URL(request.url).protocol === "https:";

        if (typeof password !== "string" || !(await verifyToken(password, env.ADMIN_TOKEN))) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/admin/login/?failed=yes" },
          });
        }

        const signed = await signCookie(ADMIN_SESSION_PAYLOAD, env.COOKIE_SECRET);
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin/",
            "Set-Cookie": buildSessionCookieHeader(signed, { isHttps }),
          },
        });
      },
    },
  },
});

function LoginPage() {
  const { failed } = Route.useSearch();

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="mb-6 text-xl font-semibold">Admin login</h1>
      <form action="/admin/login/" method="POST" className="space-y-4">
        {failed === "yes" && (
          <p className="text-sm text-destructive" role="alert">
            Invalid password.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Log in
        </Button>
      </form>
    </div>
  );
}
