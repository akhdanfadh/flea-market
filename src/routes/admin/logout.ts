import { createFileRoute } from "@tanstack/react-router";

import { clearSessionCookieHeader } from "@/lib/auth.server.ts";

export const Route = createFileRoute("/admin/logout")({
  server: {
    handlers: {
      // CSRF defense: only honor logout when Referer is same-origin. Without this,
      // attacker.com could auto-submit a form to /admin/logout/ and force-clear
      // the admin's session - SameSite=Lax blocks the *cookie* from a cross-site
      // POST but doesn't block the request itself, and clearing a cookie doesn't
      // need the cookie to be sent. Mirrors the guard in src/routes/lang/$lang.ts;
      // see the NOTE there for the Referrer-Policy caveat (a strict policy would
      // silently break this check the same way it would break the lang toggle).
      POST: ({ request }) => {
        const reqUrl = new URL(request.url);
        const referer = request.headers.get("referer");
        let sameOrigin = false;
        if (referer) {
          try {
            sameOrigin = new URL(referer).origin === reqUrl.origin;
          } catch {
            // unparsable Referer falls through
          }
        }
        if (!sameOrigin) {
          return new Response(null, { status: 302, headers: { Location: "/" } });
        }

        const isHttps = reqUrl.protocol === "https:";
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin/login/",
            "Set-Cookie": clearSessionCookieHeader({ isHttps }),
          },
        });
      },
    },
  },
});
