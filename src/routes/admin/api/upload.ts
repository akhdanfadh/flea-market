import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { hasAdminSession, verifyBearer } from "@/lib/auth.server.ts";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// Slug format is `YYYYMMDD-<kebab-case-title>`: alphanumeric on both ends,
// hyphens allowed in the middle only, 1-100 chars total.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export const Route = createFileRoute("/admin/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // CSRF defense is layered rather than via a Referer guard: SameSite=Lax
        // blocks the admin_session cookie on cross-site POST, the `image/*` MIME
        // allow-list below means any cross-origin POST trips a CORS preflight
        // (we don't send permissive CORS headers, so the preflight fails), and
        // 415 rejects anything outside the allow-list. A cookieless Bearer
        // attempt still requires the secret. No explicit Referer check needed.
        const authed =
          (await verifyBearer(request, env.ADMIN_TOKEN)) ||
          (await hasAdminSession(request, env.COOKIE_SECRET));
        if (!authed) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const slug = url.searchParams.get("slug");
        if (!slug || !SLUG_PATTERN.test(slug)) {
          return new Response("Invalid or missing slug", { status: 400 });
        }

        const contentType = request.headers.get("content-type") ?? "";
        const ext = EXT_BY_CONTENT_TYPE[contentType];
        if (!ext) {
          return new Response("Unsupported Media Type", { status: 415 });
        }

        if (!request.body || request.headers.get("content-length") === "0") {
          return new Response("Empty or missing body", { status: 400 });
        }

        const key = `${slug}/${Date.now()}-${randomHex(4)}.${ext}`;
        await env.BUCKET.put(key, request.body, {
          httpMetadata: { contentType },
        });

        return Response.json({ key });
      },
    },
  },
});

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
