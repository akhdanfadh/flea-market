import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ItemPhoto } from "@/db/schema.ts";

import { getDb } from "@/db/client.ts";
import { items } from "@/db/schema.ts";
import { hasAdminSession, verifyBearer } from "@/lib/auth.server.ts";
import { itemIdSchema } from "@/lib/item-schema.ts";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// Mirrors the dropzone's client caps in photo-dropzone.tsx. The
// Content-Length fast-path rejects obvious oversizes before reading; the
// readBodyWithLimit pass below enforces the same cap on the actual byte
// stream, so chunked POSTs (no Content-Length) can't slip past either.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PHOTOS_PER_ITEM = 10;

export const Route = createFileRoute("/admin/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // CSRF defense is the SameSite=Lax cookie - cross-origin POSTs from a
        // browser don't include admin_session, so the auth check below fails
        // before any work happens. The image-MIME allow-list is a second
        // layer: a non-simple Content-Type (anything outside the CORS-simple
        // text/plain | application/x-www-form-urlencoded | multipart/form-data
        // set) trips a preflight, and we don't send permissive CORS headers
        // so the preflight fails. A cookieless Bearer attempt still requires
        // the secret. No explicit Referer check needed.
        const authed =
          (await verifyBearer(request, env.ADMIN_TOKEN)) ||
          (await hasAdminSession(request, env.COOKIE_SECRET));
        if (!authed) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const itemIdParse = itemIdSchema.safeParse(url.searchParams.get("item"));
        if (!itemIdParse.success) {
          return new Response("Invalid or missing item id", { status: 400 });
        }
        const itemId = itemIdParse.data;

        const contentType = request.headers.get("content-type") ?? "";
        const ext = EXT_BY_CONTENT_TYPE[contentType];
        if (!ext) {
          return new Response("Unsupported Media Type", { status: 415 });
        }

        const contentLength = request.headers.get("content-length");
        if (!request.body || contentLength === "0") {
          return new Response("Empty or missing body", { status: 400 });
        }
        const declaredLength = contentLength ? Number.parseInt(contentLength, 10) : NaN;
        if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
          return new Response("Payload too large", { status: 413 });
        }

        const db = getDb();
        // Fetch current photos to append onto. A missing row 404s before R2
        // touches anything - prevents writing R2 objects against deleted /
        // typo'd item ids.
        const found = await db
          .select({ photos: items.photos })
          .from(items)
          .where(eq(items.id, itemId))
          .limit(1);
        const row = found[0];
        if (!row) {
          return new Response("Item not found", { status: 404 });
        }
        if (row.photos.length >= MAX_PHOTOS_PER_ITEM) {
          return new Response(`Photo limit reached (${MAX_PHOTOS_PER_ITEM} max)`, {
            status: 409,
          });
        }

        // Read the body into a buffer with a hard byte cap so chunked
        // POSTs (no Content-Length header) get the same MAX_UPLOAD_BYTES
        // protection as length-declared ones. 25 MB worst case sits well
        // under Workers' 128 MB memory ceiling; the trade-off is we lose
        // request-stream-to-R2 piping, which doesn't matter at this size.
        const body = await readBodyWithLimit(request.body, MAX_UPLOAD_BYTES);
        if (body === null) {
          return new Response("Payload too large", { status: 413 });
        }

        const key = `${itemId}/${nanoid(8)}.${ext}`;
        await env.BUCKET.put(key, body, {
          httpMetadata: { contentType },
        });

        // Two-step: R2 PUT then a SELECT-then-UPDATE round-trip on
        // items.photos. Not transaction-atomic - if the DB step fails we
        // leave an orphan R2 object, and concurrent uploads against the
        // same row would race on the RMW (the dropzone serializes them
        // per-session to avoid this; see photo-dropzone.tsx). Both edges
        // are rare flakes at single-admin scale handled by a future GC
        // sweep (NOTE in deleteItem applies here too).
        const photos: ItemPhoto[] = [...row.photos, { key }];
        await db.update(items).set({ photos }).where(eq(items.id, itemId));

        return Response.json({ key, photos });
      },
    },
  },
});

// Streams the request body into memory with a hard byte cap. Returns the
// concatenated bytes on success, or null if the running total exceeded
// `limit`. Reading stops at the first chunk that pushes total past the
// limit, so the caller doesn't pay for the rest of an oversized upload.
async function readBodyWithLimit(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return buf;
}
