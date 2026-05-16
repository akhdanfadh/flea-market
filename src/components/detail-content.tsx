import { useEffect, useState } from "react";

import type { CarouselApi } from "@/components/ui/carousel";
import type { Currency, ItemPhoto, ItemStatus } from "@/db/schema.ts";

import { CartToggleButton } from "@/components/cart-toggle-button.tsx";
import { PricePill } from "@/components/price-pill.tsx";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { optimizedImageUrl } from "@/lib/images.ts";
import { linkifyText } from "@/lib/linkify.tsx";
import { STATUS_LABEL } from "@/lib/statuses.ts";
import { cn } from "@/lib/utils.ts";

// Detail page and modal overlay both render this. Pure presentation; takes the data it needs
// as props (no loader access here). The two callers handle chrome (page padding/Back link
// vs Dialog wrapping) and pass the same shape underneath.
export type DetailItem = {
  id: string;
  slug: string;
  priceAmount: number | null;
  priceCurrency: Currency | null;
  status: ItemStatus;
  photos: ItemPhoto[];
};

export type DetailTranslation = {
  title: string;
  description: string;
};

// Both nav buttons get the same overlay treatment so the chrome reads as one family
// with the modal close button (semi-transparent dark circles). Default shadcn position
// is -left-12 / -right-12 (outside the photo); we pull them back inside with left-2 /
// right-2 and drop the outline-variant border so they don't show a visible ring.
//
// dark: overrides exist because the underlying outline variant carries
// dark:bg-input/30 (a white-tinted overlay) and dark:hover:bg-input/50. Without
// explicit dark:bg-black/40 / dark:hover:bg-black/60 the variant would repaint the
// button white-translucent under our forced .dark root.
//
// The carousel button is vertically centered via -translate-y-1/2 (translate up by
// half its height after anchoring at top-1/2). The base Button class adds
// active:not-aria-[haspopup]:translate-y-px on press, which REPLACES --tw-translate-y
// from -50% to 1px and breaks the centering - the button visibly drops ~16px (half
// its 32px height). Override active with the same -translate-y-1/2 so press changes
// nothing. !important guards against tailwind-merge missing the variant.
const NAV_BUTTON_CLASS =
  "size-8 border-0 bg-black/40 text-white shadow-none backdrop-blur-sm hover:bg-black/60 hover:text-white dark:bg-black/40 dark:hover:bg-black/60 active:not-aria-[haspopup]:-translate-y-1/2!";

// Two surfaces consume this component, both bounded-height at lg: so the page
// itself never scrolls (modal is capped by its frame, page is capped to viewport
// minus header/footer in its wrapping route). Photo + title + price stay anchored;
// only the description scrolls. The variant differs only in how the info column's
// vertical extent is bounded (modal: a vh cap; page: fills the wrapper).
// Below lg: both variants render identically (stacked vertical flow, no internal scroll).
export type DetailVariant = "page" | "modal";

export function DetailContent({
  item,
  translation,
  variant,
}: {
  item: DetailItem;
  translation: DetailTranslation;
  variant: DetailVariant;
}) {
  const hasMultiplePhotos = item.photos.length > 1;
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(1);
  // Subscribe to Embla's "select" event so the "1 / N" indicator follows the active
  // slide. Initial state already matches index 0; the effect re-syncs after Embla
  // initializes (and on every selection change after that).
  useEffect(() => {
    if (!api) return;
    setCurrent(api.selectedScrollSnap() + 1);
    const onSelect = () => setCurrent(api.selectedScrollSnap() + 1);
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:h-full">
      <div
        className={cn(
          "relative mx-auto w-full sm:max-w-md lg:mx-0 lg:max-w-none",
          // Page top-aligns the photo with the title so the layout reads like a
          // standard product page. Modal centers it vertically - the modal's frame
          // hugs the content, so a tall info column next to a short image looks
          // unbalanced unless the image is centered in the row.
          variant === "page" && "lg:self-start",
          variant === "modal" && "lg:self-center",
        )}
      >
        {item.photos.length > 0 ? (
          <Carousel
            className="w-full"
            // loop only matters when there's more than one slide. Embla's default
            // duration (25) stays - lower values introduce spring overshoot that reads
            // as bounce; not worth the marginal speed gain.
            opts={{ loop: hasMultiplePhotos }}
            setApi={setApi}
          >
            <CarouselContent>
              {item.photos.map((photo) => (
                <CarouselItem key={photo.key}>
                  <img
                    src={optimizedImageUrl(photo.key, { width: 1200 })}
                    alt={photo.alt ?? translation.title}
                    // object-contain shows the full photo - the visitor is
                    // deciding whether to buy and needs to see the whole item,
                    // not a center-cropped slice. The square frame stays so the
                    // carousel has no inter-slide layout shift and the PricePill
                    // / StatusBanner stay anchored. Bars fall back to bg-muted,
                    // matching the no-photo placeholder below.
                    className="aspect-square w-full rounded-md bg-muted object-contain"
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            {hasMultiplePhotos ? (
              <>
                <CarouselPrevious className={cn("left-2", NAV_BUTTON_CLASS)} />
                <CarouselNext className={cn("right-2", NAV_BUTTON_CLASS)} />
                <span className="absolute right-2 bottom-2 z-10 rounded-full bg-black/50 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                  {current} / {item.photos.length}
                </span>
              </>
            ) : null}
          </Carousel>
        ) : (
          <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
            No photo
          </div>
        )}
        <StatusBanner status={item.status} />
        <PricePill amount={item.priceAmount} currency={item.priceCurrency} size="detail" />
      </div>

      <div
        className={cn(
          // flex-col + gap-3 is the same vertical rhythm as the old space-y-3 but
          // also gives us flex-1 on the description below for the lg: scroll model.
          "mt-6 flex flex-col gap-3 lg:mt-0 lg:min-h-0",
          // Modal caps the column a few vh under DialogContent's lg:max-h-[75vh]
          // so the description scroll lives inside the modal frame. Short content
          // stays shorter than the cap and the modal shrinks to fit.
          variant === "modal" && "lg:max-h-[68vh]",
          // Page fills the wrapper (which is itself bounded to viewport minus
          // header/footer in $slug.tsx), making the description the only scroll.
          variant === "page" && "lg:h-full",
        )}
      >
        <h1 className="text-2xl font-semibold sm:text-3xl">{translation.title}</h1>
        {/* Sits between title and description so the primary call-to-action
            lands right after the visitor reads what the item is. On lg: the
            description below still scrolls (lg:flex-1 lg:overflow-y-auto)
            while the title and button stay pinned at the top. */}
        <CartToggleButton slug={item.slug} status={item.status} variant="detail" />
        {translation.description ? (
          // min-h-0 is required for flex-1 + overflow-y-auto to actually clip;
          // without it the flex item refuses to shrink below its content height
          // and overflow never kicks in.
          <p className="whitespace-pre-wrap text-base leading-relaxed text-muted-foreground lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
            {linkifyText(translation.description)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Horizontal status sash near the top of a non-available item's photo. Returns null
// for available so callers can render it unconditionally. Top-positioned (not center)
// so the photo's center stays clear - a "No photo" placeholder underneath stays
// readable, and on real photos the focal subject is usually in the middle.
// pointer-events-none so swipes through the carousel still register on the image.
//
// Exhaustive Record<ItemStatus, …> rather than an if/else chain so adding a new
// status to the schema enum fails to typecheck here until it's mapped - prevents
// the silent-fallthrough class of bug (a new status rendering as another's sash).
// `draft` returns null: the public site never renders drafts (loaders filter
// them), and admin preview of a draft is informational enough without a sash.
// Labels come from the shared STATUS_LABEL so the same string lives in exactly
// one place; this config is purely presentation (bg color, render-or-not).
const STATUS_BANNER: Record<ItemStatus, { bg: string } | null> = {
  draft: null,
  available: null,
  reserved: { bg: "bg-yellow-500" },
  sold: { bg: "bg-red-600" },
};

export function StatusBanner({ status }: { status: ItemStatus }) {
  const config = STATUS_BANNER[status];
  if (!config) return null;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-3 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-white shadow-md sm:top-4 sm:py-2 sm:text-base",
        config.bg,
      )}
    >
      {STATUS_LABEL[status]}
    </div>
  );
}
