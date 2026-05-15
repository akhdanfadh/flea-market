import { SiLine, SiMessenger } from "@icons-pack/react-simple-icons";
import { getRouteApi, useLocation } from "@tanstack/react-router";
import { AlertTriangleIcon, CopyIcon, ShoppingCartIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Language } from "@/db/schema.ts";
import type { CartRow } from "@/lib/cart-actions.ts";
import type { MessageItem } from "@/lib/messages.ts";

import { Button } from "@/components/ui/button.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.tsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { getCartItems } from "@/lib/cart-actions.ts";
import { optimizedImageUrl } from "@/lib/images.ts";
import { enMessage, formatInlineTotals, idMessage } from "@/lib/messages.ts";
import { formatPrice } from "@/lib/money.ts";
import { useHasMounted } from "@/lib/use-has-mounted.ts";
import { useCart } from "@/stores/cart.ts";

const rootApi = getRouteApi("__root__");

// UI strings are English-only. Item titles/descriptions and the generated
// message body still localize via the loader's resolved `language`; the cart
// chrome (badges, buttons, banners, captions) stays in English regardless.
const COPY_SUCCESS = "Message copied to clipboard.";
const COPY_FAILURE = "Could not copy. Long-press the message and copy manually.";

// Fixed bottom-right floating button mounted in __root.tsx so it follows the
// visitor across every public page.
//
// Visibility gates:
// - `useHasMounted`: until true, render nothing. Server renders count=0 (no
//   cart access on the server); persist middleware rehydrates on the client
//   and the count would jump - either a hydration mismatch or a visible
//   flash. Hiding the FAB until mount sidesteps both. First paint after
//   reload shows the button sub-frame later than other chrome; accepted
//   trade-off for a clean hydration story.
// - pathname gate: the admin IS the seller; "send cart to yourself" makes no
//   sense on /admin/* surfaces. Hide there.
export function CartFab() {
  const { language, fbHandle, lineHandle, origin } = rootApi.useLoaderData();
  const mounted = useHasMounted();
  const slugs = useCart((s) => s.slugs);
  const count = slugs.size;
  const [open, setOpen] = useState(false);
  const pathname = useLocation({ select: (s) => s.pathname });
  const onAdmin = pathname.startsWith("/admin/");

  if (!mounted || onAdmin) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Centered, max-w-6xl-clamped wrapper so the FAB aligns to the
          content edge on wide viewports instead of drifting to the far
          screen edge. Matches the footer's max-w-6xl + p-4. The wrapper
          is pointer-events-none so it doesn't intercept clicks across the
          full bottom strip; the button re-enables pointer events on itself. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-6xl justify-end p-4">
        <SheetTrigger
          render={
            <Button
              variant="default"
              size="lg"
              aria-label="Open cart"
              // z-40 stays below the Sheet overlay (z-50) so opening the
              // drawer doesn't leave the FAB visible on top of the backdrop.
              // Pill shape (auto width, h-14, pl-5/pr-6) reads as a labeled
              // action rather than a generic icon; the wider hit target also
              // lands cleaner under a thumb on mobile than a 56px circle.
              className="pointer-events-auto relative h-14 gap-2 rounded-full pr-6 pl-5 text-base font-semibold shadow-xl/30"
            />
          }
        >
          <ShoppingCartIcon className="size-6!" />
          <span className="uppercase tracking-wide">Cart</span>
          {count > 0 ? (
            <span
              aria-hidden
              className="absolute -top-1 -right-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 font-semibold text-destructive-foreground shadow"
            >
              {count}
            </span>
          ) : null}
        </SheetTrigger>
      </div>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Your cart</SheetTitle>
        </SheetHeader>
        <CartSheetBody
          open={open}
          slugs={slugs}
          language={language}
          fbHandle={fbHandle}
          lineHandle={lineHandle}
          origin={origin}
        />
      </SheetContent>
    </Sheet>
  );
}

// Split out so the fetch effect doesn't fire on the FAB's first render
// (Sheet is closed) and so the body can drive its own loading state.
function CartSheetBody({
  open,
  slugs,
  language,
  fbHandle,
  lineHandle,
  origin,
}: {
  open: boolean;
  slugs: Set<string>;
  language: Language;
  fbHandle: string;
  lineHandle: string;
  origin: string;
}) {
  const removeFromCart = useCart((s) => s.remove);
  const removeMany = useCart((s) => s.removeMany);
  const [rows, setRows] = useState<CartRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  // Slugs we sent to the server on the last fetch. The "missing" classification
  // (below) intersects against THIS, not the live `slugs`, so a slug added
  // after the fetch can't be mistakenly flagged as "no longer available" and
  // swept by the "Remove unavailable" action. Not triggerable today (the
  // Sheet's backdrop blocks card clicks, and persist doesn't bridge cross-tab
  // writes), but the invariant is brittle without an explicit anchor.
  const requestedSlugsRef = useRef<Set<string>>(new Set());

  // Refetch only on Sheet open or explicit retry, NOT on every `slugs`
  // mutation. Removing a row would otherwise trigger a network round-trip
  // the visitor didn't ask for, and if that refetch fails it surfaces the
  // refresh-failure banner immediately after their own action - which
  // reads as the system breaking. The render-time `safeRows.filter` (below)
  // handles the visual diff optimistically.
  useEffect(() => {
    if (!open) return;
    if (slugs.size === 0) {
      setRows([]);
      setError(false);
      requestedSlugsRef.current = new Set();
      return;
    }
    const requestedAtFetch = Array.from(slugs);
    let cancelled = false;
    setLoading(true);
    setError(false);
    getCartItems({ data: { slugs: requestedAtFetch } })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
        requestedSlugsRef.current = new Set(requestedAtFetch);
      })
      .catch(() => {
        if (cancelled) return;
        // Distinguish "fetch failed" from "no items returned" - the latter
        // is a valid empty result (e.g. all slugs resolved to drafts), the
        // former needs a retry affordance.
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // slugs is intentionally absent from deps - read from closure on open/retry
    // only. See the section comment above the effect for rationale.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open, retryNonce]);

  if (slugs.size === 0) {
    return (
      <div className="flex flex-1 flex-col p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShoppingCartIcon />
            </EmptyMedia>
            <EmptyTitle>Your cart is empty</EmptyTitle>
            <EmptyDescription>Tap the cart icon on any item to start adding.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  if (loading && rows === null) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error && rows === null) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">Couldn&apos;t load your cart. Check your connection and retry.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="w-full"
        >
          Retry
        </Button>
      </div>
    );
  }

  // Render-time filter against the live store membership so a row vanishes
  // immediately on remove - otherwise `rows` keeps the stale entry until
  // the next refetch (the effect doesn't auto-fire on mutation; see above).
  const safeRows = (rows ?? []).filter((r) => slugs.has(r.item.slug));
  const soldRows = safeRows.filter((r) => r.item.status === "sold");
  const messageRows = safeRows.filter((r) => r.item.status !== "sold");
  const messageItems: MessageItem[] = messageRows.map((r) => ({
    title: r.translation.title,
    slug: r.item.slug,
    priceAmount: r.item.priceAmount,
    priceCurrency: r.item.priceCurrency,
    status: r.item.status,
  }));

  // Slugs the visitor saved but the server didn't return (item went to
  // draft, was deleted, or the slug was renamed). Intersect against the
  // last fetched-set (requestedSlugsRef) so a slug added after the fetch
  // isn't mistakenly classified - the new slug just doesn't render until
  // the next refetch, which is the same UX as the documented refetch policy.
  const returnedSlugs = new Set((rows ?? []).map((r) => r.item.slug));
  const missingSlugs =
    rows !== null
      ? Array.from(slugs).filter((s) => requestedSlugsRef.current.has(s) && !returnedSlugs.has(s))
      : [];
  const unavailableSlugs = [...soldRows.map((r) => r.item.slug), ...missingSlugs];
  const hasUnavailable = unavailableSlugs.length > 0;

  // Item titles and the generated message body localize; the cart chrome
  // around them does not.
  const messageText =
    messageItems.length === 0
      ? ""
      : language === "id"
        ? idMessage(messageItems, origin)
        : enMessage(messageItems, origin);
  const totalsLine = formatInlineTotals(messageItems);

  const handleCopyOnly = () => {
    if (!messageText) return;
    navigator.clipboard
      .writeText(messageText)
      .then(() => toast.success(COPY_SUCCESS))
      .catch(() => toast.error(COPY_FAILURE));
  };

  // window.open fires synchronously inside the click handler so iOS Safari's
  // user-gesture popup gate accepts the new tab. Clipboard copy is a separate
  // explicit action via "Copy message" - the visitor copies, then taps a
  // contact button to open the chat and pastes there.
  //
  // openContact normalises the handle defensively. The env contract is
  // "host/path, no protocol" (see wrangler.jsonc). Two failure modes worth
  // closing off:
  // - "https://m.me/foo" (someone pastes the full URL) -> would produce
  //   "https://https://m.me/foo" and silently break -> strip the prefix.
  // - "//evil.com" or "/foo" (someone starts with a slash) -> would produce
  //   "https:////evil.com" which browsers normalise to host=evil.com ->
  //   require a host-then-path shape.
  // Operator-controlled input, so this is defense in depth, not a real
  // attack surface.
  const openContact = (handle: string) => {
    const stripped = handle.replace(/^https?:\/\//i, "");
    if (!/^[a-z0-9.-]+\/.+$/i.test(stripped)) return;
    window.open(`https://${stripped}`, "_blank", "noopener,noreferrer");
  };
  const openFacebook = () => openContact(fbHandle);
  const openLine = () => openContact(lineHandle);

  const handleRemoveUnavailable = () => {
    if (unavailableSlugs.length === 0) return;
    removeMany(unavailableSlugs);
  };

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Refresh-failure banner. Renders only when we have prior data AND
          the latest fetch failed - the cart shows stale rows that might
          have transitioned (e.g. an item went sold upstream) but the
          drawer would silently keep the old status. The no-prior-data
          case is handled above by the full error screen. */}
      {error && rows !== null ? (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <p>Couldn&apos;t refresh - showing the last loaded data.</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="font-medium underline-offset-4 hover:underline"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {/* Unified "unavailable" banner: sold rows are rendered dimmed below
          but excluded from the message; missing slugs (draft / deleted /
          renamed) don't render a row at all but still inflate the count.
          One banner covers both cases with a single cleanup action. */}
      {hasUnavailable ? (
        <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <div className="flex-1 space-y-2">
            <p>Some items in your cart are no longer available.</p>
            <button
              type="button"
              onClick={handleRemoveUnavailable}
              className="font-medium underline-offset-4 hover:underline"
            >
              Remove unavailable items
            </button>
          </div>
        </div>
      ) : null}

      {safeRows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {safeRows.map(({ item, translation }) => {
            const isSold = item.status === "sold";
            const isReserved = item.status === "reserved";
            const isFree = item.priceAmount === null || item.priceCurrency === null;
            const thumb = item.photos[0];
            return (
              <li
                key={item.id}
                className={`flex items-start gap-3 rounded-md border border-border p-2 ${isSold ? "opacity-60" : ""}`}
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                  {thumb ? (
                    <img
                      src={optimizedImageUrl(thumb.key, { width: 160 })}
                      alt={thumb.alt ?? translation.title}
                      className="size-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium">{translation.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        isFree ? "bg-green-700 text-white" : "bg-muted text-foreground"
                      }`}
                    >
                      {item.priceAmount !== null && item.priceCurrency !== null
                        ? formatPrice(item.priceAmount, item.priceCurrency)
                        : "Free"}
                    </span>
                    {isSold ? (
                      <span className="rounded-full bg-red-600/20 px-2 py-0.5 text-xs font-medium text-red-300">
                        Sold
                      </span>
                    ) : null}
                    {isReserved ? (
                      <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-300">
                        Reserved
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Remove from cart"
                  onClick={() => removeFromCart(item.slug)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {totalsLine ? (
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">Total</span>
          <span className="font-semibold">{totalsLine}</span>
        </div>
      ) : null}

      {/* Suggested message + Copy button. Sits above the contact options so
          the visitor reviews/copies the prefilled text, then picks a channel
          to send it on. Carries the section separator under the totals so the
          contact section below stacks flush. */}
      {messageText ? (
        <div className="flex flex-col gap-2 border-t pt-4">
          <label htmlFor="cart-message" className="text-sm font-medium">
            Suggested reach-out message:
          </label>
          <Textarea
            id="cart-message"
            readOnly
            value={messageText}
            rows={8}
            className="font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handleCopyOnly}
            className="w-full"
          >
            <CopyIcon />
            Copy message
          </Button>
        </div>
      ) : null}

      {/* Contact section. Heading + two contact buttons stacked on the left,
          QR on the right. Always shown, independent of cart contents - a
          visitor can still want to reach the seller even with an empty /
          all-sold cart.

          min-w-0 on the left column lets the button labels wrap on narrow
          viewports instead of pushing the QR offscreen and triggering
          horizontal scroll; whitespace-normal/text-left override Button's
          default nowrap so the wrap actually happens. */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-sm font-medium">Scan QR or reach me via:</p>
          <Button type="button" size="lg" onClick={openFacebook} className="w-full">
            <SiMessenger className="size-4" />
            {/* min-w-0 lets the span shrink below its content so `truncate`
                (which needs an overflow boundary to clip against) can clamp
                the URL with an ellipsis instead of pushing the QR offscreen. */}
            <span className="min-w-0 flex-1 truncate text-left">{fbHandle}</span>
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={openLine} className="w-full">
            <SiLine className="size-4" />
            <span className="min-w-0 flex-1 truncate text-left">{lineHandle}</span>
          </Button>
        </div>
        <img
          src="/line-qr.jpg"
          alt="LINE QR code"
          // loading="lazy" is defense in depth - Base UI's Dialog.Portal
          // doesn't render children when closed (no `keepMounted`), so the
          // <img> isn't in the DOM until first open and the browser would
          // never fetch eagerly. The attribute survives a future port to
          // keepMounted without re-fetching unopened drawers.
          loading="lazy"
          // Square, 144px when there's room, but capped at 50% of the row
          // so a narrow Sheet doesn't let the QR push the contact buttons
          // offscreen. No shrink-0 - we want this column to shrink in tight
          // viewports.
          className="aspect-square w-36 max-w-1/2 rounded-md bg-muted"
        />
      </div>
    </div>
  );
}
