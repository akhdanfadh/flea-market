import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/images/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        let key: string;
        try {
          key = decodeURIComponent(url.pathname.slice("/images/".length));
        } catch {
          return new Response("Bad Request", { status: 400 });
        }
        if (!key) {
          return new Response("Not Found", { status: 404 });
        }

        const obj = await env.BUCKET.get(key);
        if (!obj) {
          return new Response("Not Found", { status: 404 });
        }

        const headers = new Headers();
        obj.writeHttpMetadata(headers);
        headers.set("Cache-Control", "public, max-age=31536000, immutable");
        headers.set("ETag", obj.httpEtag);
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(obj.body, { headers });
      },
    },
  },
});
