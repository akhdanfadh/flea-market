import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

import type { Language } from "@/db/schema.ts";

import { LANGUAGES } from "@/db/schema.ts";

function isLanguage(value: string | undefined): value is Language {
  return value !== undefined && (LANGUAGES as readonly string[]).includes(value);
}

// Must only be called inside a request context (server route handler or createServerFn handler).
// `getCookie` / `getRequestHeader` read from AsyncLocalStorage and will throw otherwise.
export function getLanguage(): Language {
  const cookie = getCookie("lang");
  if (isLanguage(cookie)) {
    return cookie;
  }

  // NOTE: q-weights (`Accept-Language: id;q=0.5, en`) are not parsed; we walk the
  // header in source order. Real browsers (Chrome/Firefox/Safari) already emit the
  // list sorted by q descending, so the first match is the preferred language.
  // Revisit if a non-browser client (curl scripts, exotic IMEs, header-rewriting
  // proxies) ever surfaces in the wild.
  const accept = getRequestHeader("accept-language");
  if (accept) {
    for (const part of accept.split(",")) {
      const tag = part.split(";")[0]!.trim().toLowerCase().split("-")[0]!;
      if (isLanguage(tag)) {
        return tag;
      }
    }
  }

  const fallback = env.DEFAULT_LANGUAGE;
  return isLanguage(fallback) ? fallback : "en";
}
