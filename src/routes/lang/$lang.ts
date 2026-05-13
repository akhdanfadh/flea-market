import { LANGUAGES } from "#/db/schema.ts";
import { createFileRoute } from "@tanstack/react-router";

const SUPPORTED = new Set<string>(LANGUAGES);

export const Route = createFileRoute("/lang/$lang")({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const lang = params.lang;
        if (!SUPPORTED.has(lang)) {
          return new Response("Bad Request", { status: 400 });
        }

        // Only redirect to a Referer that shares the request's origin (scheme + host + port).
        // Falls back to "/" on missing / unparsable / cross-origin Referer; blocks open redirects.
        let location = "/";
        const referer = request.headers.get("referer");
        if (referer) {
          try {
            const refUrl = new URL(referer);
            const reqUrl = new URL(request.url);
            if (refUrl.origin === reqUrl.origin) {
              location = refUrl.pathname + refUrl.search + refUrl.hash;
            }
          } catch {
            // unparsable Referer falls through to "/"
          }
        }

        const cookie = [
          `lang=${lang}`,
          "Path=/",
          "Max-Age=31536000",
          "SameSite=Lax",
          "Secure",
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
