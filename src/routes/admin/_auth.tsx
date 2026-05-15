import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import { Toaster } from "@/components/ui/sonner";
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

// No admin-specific header chrome - the global SiteHeader stays, and the
// SiteFooter's shield icon flips to a logout button when the visible
// pathname is under /admin/ (excluding /admin/login/), so logout lives
// in one consistent corner of every authed admin page.
function AdminLayout() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <Outlet />
      <Toaster position="top-center" />
    </div>
  );
}
