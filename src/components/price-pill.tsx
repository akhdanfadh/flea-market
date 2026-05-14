import type { Currency } from "@/db/schema.ts";

import { formatPrice } from "@/lib/money.ts";
import { cn } from "@/lib/utils.ts";

// Mercari-style overlay pinned to the bottom-left of an item photo. Lives at the
// `relative` photo-wrapper level (sibling to the image and StatusBanner) so it
// stays anchored across carousel slides and over the no-photo placeholder.
//
// `size` matches the photo it sits on:
// - `card`: list-grid tiles (~165-288px square across breakpoints) - small pill,
//   one bump at sm.
// - `detail`: detail page and modal (photo ~448px on mobile, up to ~528px on
//   detail-page lg, ~368px in the lg modal) - base pill is larger and steps up
//   again at sm and lg so it reads as the headline price next to a big photo.
//
// Free items get a green pill; priced items get a black/50 + backdrop-blur chip
// so the number stays legible over busy photos.
type Size = "card" | "detail";

const SIZE_CLASSES: Record<Size, string> = {
  card: "bottom-2 left-2 px-2 py-0.5 text-xs sm:bottom-3 sm:left-3 sm:px-2.5 sm:text-sm",
  detail:
    "bottom-2 left-2 px-2.5 py-0.5 text-sm sm:bottom-3 sm:left-3 sm:px-3 sm:py-1 sm:text-base lg:bottom-4 lg:left-4 lg:px-4 lg:py-1.5 lg:text-lg",
};

export function PricePill({
  amount,
  currency,
  size,
}: {
  amount: number | null;
  currency: Currency | null;
  size: Size;
}) {
  const isFree = amount === null || currency === null;
  return (
    <span
      className={cn(
        "absolute z-10 rounded-full font-semibold backdrop-blur-sm",
        isFree ? "bg-green-700 text-white" : "bg-black/50 text-white",
        SIZE_CLASSES[size],
      )}
    >
      {isFree ? "FREE" : formatPrice(amount, currency)}
    </span>
  );
}
