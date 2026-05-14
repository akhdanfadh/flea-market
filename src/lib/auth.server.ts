import { timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "admin_session";
// The signed payload is a constant - a single-admin app has nothing per-session
// to encode, so the HMAC signature is the only thing standing between a forged
// value and access. Exported so signer (login) and verifiers stay in sync.
export const ADMIN_SESSION_PAYLOAD = "admin";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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
  // RFC 7235: the auth scheme is case-insensitive. `\s+` also tolerates `Bearer\t<token>`
  // and similar whitespace variations rather than silently 401-ing on them.
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return verifyToken(match[1], expected);
}

// Single source of truth for "is this signed string a valid admin session?".
// Callers fetch the signed value however they have it (getCookie inside an
// AsyncLocalStorage context, hand-parse on a Request, etc.) and feed it in.
export async function isAdminSession(
  signed: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signed) return false;
  return (await verifyCookie(signed, secret)) === ADMIN_SESSION_PAYLOAD;
}

export async function hasAdminSession(request: Request, secret: string): Promise<boolean> {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return isAdminSession(parseCookie(header, ADMIN_SESSION_COOKIE), secret);
}

function parseCookie(header: string, name: string): string | null {
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

export async function signCookie(value: string, secret: string): Promise<string> {
  const mac = await hmacSha256(value, secret);
  return `${value}.${bytesToHex(mac)}`;
}

export async function verifyCookie(signed: string, secret: string): Promise<string | null> {
  // Split on the LAST `.` so any value left of it round-trips, dots included.
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;

  const value = signed.slice(0, idx);
  const submittedMac = hexToBytes(signed.slice(idx + 1));
  if (!submittedMac) return null;

  const expectedMac = await hmacSha256(value, secret);
  if (expectedMac.length !== submittedMac.length) return null;
  return timingSafeEqual(expectedMac, submittedMac) ? value : null;
}

// `Secure` is gated on the request protocol so the cookie still sets when dev
// is served over plain HTTP on a LAN IP (phone testing). Browsers exempt
// localhost from the Secure requirement but not LAN IPs; production is always
// HTTPS so Secure is always emitted there. Mirrors src/routes/lang/$lang.ts.
export function buildSessionCookieHeader(
  signedValue: string,
  { isHttps }: { isHttps: boolean },
): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${signedValue}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    "HttpOnly",
    ...(isHttps ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookieHeader({ isHttps }: { isHttps: boolean }): string {
  return [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    "HttpOnly",
    ...(isHttps ? ["Secure"] : []),
  ].join("; ");
}

async function hmacSha256(message: string, secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(mac);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Precheck rejects non-hex characters up-front. Without it, Number.parseInt
// silently truncates at the first invalid nibble ("0g" -> 0), so the function
// would accept malformed hex as valid (non-exploitable - the bytes can't match
// the real HMAC - but reads stricter than it is).
const HEX_PATTERN = /^[0-9a-f]+$/i;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!HEX_PATTERN.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
