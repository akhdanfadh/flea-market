import { createFileRoute } from "@tanstack/react-router";

import { LANGUAGES } from "@/db/schema.ts";

const SUPPORTED = new Set<string>(LANGUAGES);

export const Route = createFileRoute("/lang/$lang")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const lang = params.lang;
        if (!SUPPORTED.has(lang)) {
          return new Response("Bad Request", { status: 400 });
        }

        // Only honor the request when Referer is same-origin: cookie write and redirect
        // both gate on it. This is a state-changing GET, so an off-site link like
        // <a href="https://flea-market.akhdan.dev/lang/id">click</a> would otherwise flip
        // a visitor's language cross-site (SameSite=Lax permits top-level navigations
        // and the cookie write would succeed). The "real" usage is always in-app - user
        // clicks the LanguagePill <a> while on /, which carries a same-origin Referer.
        //
        // NOTE: if we ever set a strict Referrer-Policy header (e.g. `no-referrer` or
        // `same-origin` that omits referrer cross-site), in-app toggles would silently
        // stop setting the cookie. The site doesn't ship one today; add a relax-for-
        // same-origin policy at the same time as any tightening.
        const reqUrl = new URL(request.url);
        let sameOrigin = false;
        let location = "/";
        const referer = request.headers.get("referer");
        if (referer) {
          try {
            const refUrl = new URL(referer);
            if (refUrl.origin === reqUrl.origin) {
              sameOrigin = true;
              location = refUrl.pathname + refUrl.search + refUrl.hash;
            }
          } catch {
            // unparsable Referer falls through (sameOrigin stays false)
          }
        }

        if (!sameOrigin) {
          // Cross-origin / missing Referer: redirect home without setting the cookie.
          // The visitor's current language preference is untouched.
          return new Response(null, { status: 302, headers: { Location: "/" } });
        }

        // Secure is required in production but blocks the cookie over plain HTTP on
        // non-localhost hosts (LAN IPs for phone testing, custom local domains, etc.).
        // Browsers exempt "localhost" specifically; everything else needs HTTPS for
        // Secure cookies. Only emit Secure when the request is actually HTTPS.
        const isHttps = reqUrl.protocol === "https:";
        const cookie = [
          `lang=${lang}`,
          "Path=/",
          "Max-Age=31536000",
          "SameSite=Lax",
          ...(isHttps ? ["Secure"] : []),
          "HttpOnly",
        ].join("; ");

        return new Response(null, {
          status: 302,
          headers: {
            Location: location,
            "Set-Cookie": cookie,
          },
        });
      },
    },
  },
});
