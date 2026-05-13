import { timingSafeEqual } from "node:crypto";

export async function verifyToken(submitted: string, expected: string): Promise<boolean> {
  const submittedHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(submitted)),
  );
  const expectedHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  );
  return timingSafeEqual(submittedHash, expectedHash);
}

export async function verifyBearer(request: Request, expected: string): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer (.+)$/);
  if (!match) return false;
  return verifyToken(match[1], expected);
}
