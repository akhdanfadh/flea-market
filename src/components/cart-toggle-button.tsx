import { CheckIcon, ShoppingCartIcon } from "lucide-react";
import { toast } from "sonner";

import type { ItemStatus } from "@/db/schema.ts";

import { Button } from "@/components/ui/button.tsx";
import { CART_LIMIT } from "@/lib/cart-constants.ts";
import { useHasMounted } from "@/lib/use-has-mounted.ts";
import { cn } from "@/lib/utils.ts";
import { useCart } from "@/stores/cart.ts";

type Variant = "card" | "detail";

const ADD_LABEL = "Add to cart";
const REMOVE_LABEL = "In cart - tap to remove";
const FULL_TOAST = `Cart is full (max ${CART_LIMIT} items).`;

// Toggle "this item is in my cart". Lives on:
// - list cards: small overlay chip pinned top-right of each photo
// - detail page / modal: full-width button under the info column
//
// Returns null for sold/draft - drafts are admin-only and sold items can't
// be acted on; surfacing the button there would be a false affordance. The
// store stays free to hold a slug whose item has since transitioned to sold
// (handled in the cart Sheet's stale-cart banner).
//
// SSR/hydration: `useCart` reads localStorage on the client only. To keep the
// SSR markup stable, we render the out-of-cart visual until `useHasMounted`
// flips true; only then does the real cart-membership decide what shows.
// For first-time visitors this is a no-op (cart is empty); for returning
// visitors the in-cart icons appear sub-frame after hydration, which is
// preferable to a hydration-mismatch warning or hiding the affordance
// entirely (the latter would reflow every list card on mount).
export function CartToggleButton({
  slug,
  status,
  variant,
}: {
  slug: string;
  status: ItemStatus;
  variant: Variant;
}) {
  const mounted = useHasMounted();
  const inCart = useCart((s) => s.slugs.has(slug));
  const add = useCart((s) => s.add);
  const remove = useCart((s) => s.remove);

  if (status === "sold" || status === "draft") return null;

  const active = mounted && inCart;

  // The store silently caps `add` at CART_LIMIT. Surface the overflow as a
  // toast so the visitor knows their click was a no-op; otherwise the button
  // would stay inert with no feedback.
  const toggle = () => {
    if (active) {
      remove(slug);
      return;
    }
    if (useCart.getState().slugs.size >= CART_LIMIT) {
      toast.error(FULL_TOAST);
      return;
    }
    add(slug);
  };

  if (variant === "card") {
    return (
      <button
        type="button"
        aria-label={active ? REMOVE_LABEL : ADD_LABEL}
        aria-pressed={active}
        // The card photo is wrapped by a sibling <Link> overlay (see
        // src/routes/index.tsx) - the toggle sits above it at z-20 so its
        // own clicks resolve here without reaching the Link. preventDefault
        // + stopPropagation are belt-and-suspenders defense against future
        // re-nesting; without them, a structural revert to nesting <button>
        // inside <a> would silently make cmd-click on the toggle open the
        // detail in a new tab instead of adding to cart.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        className={cn(
          // Bottom-right corner. Top-right would collide with the full-width
          // StatusBanner on reserved items (which sits at top-3 inset-x-0).
          // PricePill is bottom-left so the two chips balance across the
          // bottom of the photo. z-20 keeps the toggle above the Link overlay
          // at z-10 in the card structure.
          "absolute right-2 bottom-2 z-20 inline-flex size-8 items-center justify-center rounded-full bg-black/50 text-white shadow-md backdrop-blur-sm transition-colors hover:bg-black/70",
          // Same overlay family as PricePill / StatusBanner / the carousel
          // nav buttons in detail-content.tsx so the chrome reads as one set.
          // State is conveyed by the icon swap (cart → check), not color, so
          // the green "Free" pill stays the only colored chip on the card.
        )}
      >
        {active ? <CheckIcon className="size-4" /> : <ShoppingCartIcon className="size-4" />}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant={active ? "secondary" : "default"}
      size="lg"
      aria-pressed={active}
      onClick={toggle}
      className="w-full"
    >
      {active ? <CheckIcon /> : <ShoppingCartIcon />}
      {active ? REMOVE_LABEL : ADD_LABEL}
    </Button>
  );
}
