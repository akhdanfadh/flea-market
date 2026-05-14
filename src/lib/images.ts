// R2 objects are served by the Worker at `/images/<key>` (see `src/routes/images/$.ts`).
// Cloudflare's Image Transformations resolves a relative source path against the current zone,
// so we never need to embed the full origin URL.
export function optimizedImageUrl(
  key: string,
  options: { width: number; quality?: number },
): string {
  // In `pnpm dev` (Miniflare), Cloudflare's edge image transformer at /cdn-cgi/image is not
  // emulated, so we fall through to the raw Worker proxy at /images/<key>. Production always
  // goes through the transformer.
  // NOTE: this means dev list pages download full-size originals
  // from local R2 instead of width=400 thumbnails - fine for the seed photos, but a 3 MB phone
  // shot will be visibly heavier in dev than in prod.
  if (import.meta.env.DEV) {
    return `/images/${key}`;
  }
  const quality = options.quality ?? 75;
  return `/cdn-cgi/image/width=${options.width},quality=${quality},format=auto/images/${key}`;
}
