// R2 objects are served by the Worker at `/images/<key>` (see `src/routes/images/$.ts`).
// Cloudflare's Image Transformations resolves a relative source path against the current zone,
// so we never need to embed the full origin URL.
export function optimizedImageUrl(
  key: string,
  options: { width: number; quality?: number },
): string {
  const quality = options.quality ?? 75;
  return `/cdn-cgi/image/width=${options.width},quality=${quality},format=auto/images/${key}`;
}
