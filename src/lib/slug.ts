// Bare slug-shape constraint: alphanumeric on both ends, hyphens allowed in
// the middle only, 1-100 chars total. The `YYYYMMDD-<kebab-case-title>`
// convention is enforced by `slugifyTitle` below, not by this regex - the
// admin can manually edit a slug into anything that matches the shape.
// Lives in src/lib/ instead of inline to a route so the upload endpoint and
// the admin form share one source of truth.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

// Date portion uses local time on purpose: the admin's calendar (Sendai today,
// Jakarta next) is what visitors see. UTC would put a 9-hour offset between
// what the admin typed and what the URL says on the same day.
export function slugifyTitle(title: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const datePrefix = `${yyyy}${mm}${dd}`;

  // NFKD splits accented characters into base letter + combining mark
  // (e.g. "señor" -> "n" + tilde-combining). Stripping `\p{M}` (Unicode
  // category Mark) before the alphanum collapse keeps "senor" instead of
  // letting the tilde turn into "sen-or".
  const titleSlug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Cap title portion at 87 chars: 8 date + 1 separator + room for collision
  // suffix `-NNN` = 100. Trim a trailing hyphen that the slice may have left.
  const titlePortion = titleSlug.slice(0, 87).replace(/-$/, "");
  return titlePortion ? `${datePrefix}-${titlePortion}` : datePrefix;
}
