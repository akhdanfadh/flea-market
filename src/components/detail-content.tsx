import type { Currency, ItemPhoto, ItemStatus } from "#/db/schema.ts";

import { optimizedImageUrl } from "#/lib/images.ts";
import { formatPrice } from "#/lib/money.ts";
import { cn } from "#/lib/utils.ts";
import { useEffect, useState } from "react";

import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";

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
// The carousel button is vertically centered via -translate-y-1/2 (translate up by
// half its height after anchoring at top-1/2). The base Button class adds
// active:not-aria-[haspopup]:translate-y-px on press, which REPLACES --tw-translate-y
// from -50% to 1px and breaks the centering — the button visibly drops ~16px (half
// its 32px height). Override active with the same -translate-y-1/2 so press changes
// nothing. !important guards against tailwind-merge missing the variant.
const NAV_BUTTON_CLASS =
  "size-8 border-0 bg-black/40 text-white shadow-none backdrop-blur-sm hover:bg-black/60 hover:text-white active:not-aria-[haspopup]:-translate-y-1/2!";

export function DetailContent({
  item,
  translation,
}: {
  item: DetailItem;
  translation: DetailTranslation;
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
    <div>
      <div className="relative mx-auto w-full sm:max-w-md">
        {item.photos.length > 0 ? (
          <Carousel
            className="w-full"
            // loop only matters when there's more than one slide. Embla's default
            // duration (25) stays — lower values introduce spring overshoot that reads
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
                    className="aspect-square w-full rounded-md object-cover"
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
      </div>

      <div className="mt-6 space-y-3">
        <h1 className="text-2xl font-semibold sm:text-3xl">{translation.title}</h1>
        <p className="text-xl font-medium">
          {item.priceAmount === null || item.priceCurrency === null
            ? "Free"
            : formatPrice(item.priceAmount, item.priceCurrency)}
        </p>
        {translation.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {translation.description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// Horizontal status sash near the top of a non-available item's photo. Returns null
// for available so callers can render it unconditionally. Top-positioned (not center)
// so the photo's center stays clear — a "No photo" placeholder underneath stays
// readable, and on real photos the focal subject is usually in the middle.
// pointer-events-none so swipes through the carousel still register on the image.
export function StatusBanner({ status }: { status: ItemStatus }) {
  if (status === "available") return null;
  const isSold = status === "sold";
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-3 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-white shadow-md sm:top-4 sm:py-2 sm:text-base",
        isSold ? "bg-red-600" : "bg-yellow-500",
      )}
    >
      {isSold ? "Sold" : "Reserved"}
    </div>
  );
}
