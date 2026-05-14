import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { Button } from "@/components/ui/button";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/auth.server.ts";

// POST so the response is uncached by default; a GET RPC for an auth check
// has an identical URL across invocations and is in principle HTTP-cacheable,
// which could let a stale "auth OK" response outlive a logout.
const requireAdminSession = createServerFn({ method: "POST" }).handler(async () => {
  if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
    throw redirect({ to: "/admin/login/" });
  }
});

export const Route = createFileRoute("/admin/_auth")({
  beforeLoad: () => requireAdminSession(),
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between border-b border-border pb-3">
        <h1 className="text-lg font-semibold">Admin</h1>
        <form action="/admin/logout/" method="POST">
          <Button type="submit" variant="outline" size="sm">
            Log out
          </Button>
        </form>
      </header>
      <Outlet />
    </div>
  );
}
