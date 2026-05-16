import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { desc, inArray, ne, sql } from "drizzle-orm";
import { SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { z } from "zod";

import type { DetailItem } from "@/components/detail-content.tsx";
import type { PublicItemStatus } from "@/lib/statuses.ts";

import { CartToggleButton } from "@/components/cart-toggle-button.tsx";
import { DetailContent, StatusBanner } from "@/components/detail-content.tsx";
import { PricePill } from "@/components/price-pill.tsx";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db/client.ts";
import { itemTranslations, items } from "@/db/schema.ts";
import { optimizedImageUrl } from "@/lib/images.ts";
import { getLanguage } from "@/lib/lang.server.ts";
import { serializeItem } from "@/lib/serialize-item.ts";
import { PUBLIC_STATUSES, STATUS_LABEL } from "@/lib/statuses.ts";
import { useHasMounted } from "@/lib/use-has-mounted.ts";
import { cn } from "@/lib/utils.ts";
import { useCart } from "@/stores/cart.ts";

// Optional + catch(undefined) on every field is intentional: TanStack Router runs
// validateSearch on outbound navigation as well as inbound, so any `.catch("all")`
// default would be re-applied and serialized into the URL. Keeping the schema
// optional means missing/junk values stay `undefined`, the router drops `undefined`
// keys from the URL, and consumers fill defaults with `?? "all"` at read time.
const PRICE_FILTERS = ["free", "paid"] as const;
type PriceValue = (typeof PRICE_FILTERS)[number];

// Escape regex metachars so user input drops into RegExp() unchanged.
// Covers the standard set; flea-market queries are typed by a human so
// exotic Unicode regex syntax isn't a concern here.
const REGEX_META = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(s: string): string {
  return s.replace(REGEX_META, "\\$&");
}

const searchSchema = z.object({
  // PUBLIC_STATUSES, not ITEM_STATUSES - `draft` is admin-only and must not
  // be acceptable as a public URL filter value. SQL loader filters drafts
  // anyway, but constraining the schema keeps the URL contract honest.
  status: z.enum(PUBLIC_STATUSES).optional().catch(undefined),
  price: z.enum(PRICE_FILTERS).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  // `item` opens a modal over the list with that slug's detail. The standalone
  // `/$slug` route still exists for direct nav, refresh, and right-click "open in
  // new tab" on a card.
  item: z.string().optional().catch(undefined),
});
type Search = z.infer<typeof searchSchema>;
type StatusFilter = "all" | PublicItemStatus;
type PriceFilter = "all" | PriceValue;

type Row = {
  item: DetailItem;
  translation: { title: string; description: string };
};

const loadList = createServerFn({ method: "GET" }).handler(async (): Promise<{ rows: Row[] }> => {
  const language = getLanguage();
  const db = getDb();

  // Status priority first so available items always sit above reserved
  // and sold ones, regardless of when each was listed - otherwise an old
  // sold item lands above a fresh available one and the visitor's eye
  // wastes a beat on a row they can't act on. createdAt DESC within each
  // group keeps "what's new" intact. Draft is filtered out above so the
  // CASE never needs to rank it. Priorities are driven from PUBLIC_STATUSES
  // (declaration order = priority) so reordering / renaming the constant
  // propagates here without a separate edit.
  const statusPriority = sql.join(
    PUBLIC_STATUSES.map((s, i) => sql`WHEN ${s} THEN ${i}`),
    sql` `,
  );
  const all = await db
    .select()
    .from(items)
    .where(ne(items.status, "draft"))
    .orderBy(sql`CASE ${items.status} ${statusPriority} END`, desc(items.createdAt));
  const ids = all.map((i) => i.id);
  const trs =
    ids.length === 0
      ? []
      : await db.select().from(itemTranslations).where(inArray(itemTranslations.itemId, ids));

  type Trans = (typeof trs)[number];
  const byItem = new Map<string, { en?: Trans; pref?: Trans }>();
  for (const t of trs) {
    let entry = byItem.get(t.itemId);
    if (!entry) {
      entry = {};
      byItem.set(t.itemId, entry);
    }
    if (t.language === "en") entry.en = t;
    if (t.language === language) entry.pref = t;
  }

  const rows: Row[] = all.map((item) => {
    const entry = byItem.get(item.id) ?? {};
    const t = entry.pref ?? entry.en;
    return {
      item: serializeItem(item),
      translation: t
        ? { title: t.title, description: t.description }
        : { title: item.slug, description: "" },
    };
  });

  return { rows };
});

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  loader: () => loadList(),
  component: Home,
  pendingComponent: ListSkeleton,
  // Same thresholds as $slug: skip the flash on fast loads, hold on near-instant ones.
  // Mainly helps the detail -> back-to-list transition feel snappy on slow connections.
  pendingMs: 200,
  pendingMinMs: 300,
});

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  ...PUBLIC_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] })),
];

const PRICE_OPTIONS: Array<{ value: PriceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
];

function Home() {
  const { rows } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();

  // "all" / "" sentinel from the UI maps to undefined, which the router drops from
  // the URL. replace: true keeps per-keystroke edits out of the browser history.
  const setSearch = (patch: { status?: StatusFilter; price?: PriceFilter; q?: string }) => {
    navigate({
      search: (prev) => {
        const next: Search = { ...prev };
        if (patch.status !== undefined) {
          next.status = patch.status === "all" ? undefined : patch.status;
        }
        if (patch.price !== undefined) {
          next.price = patch.price === "all" ? undefined : patch.price;
        }
        if (patch.q !== undefined) {
          next.q = patch.q === "" ? undefined : patch.q;
        }
        return next;
      },
      replace: true,
    });
  };

  // Defaults applied at consumption; schema stays partial.
  const statusFilter: StatusFilter = search.status ?? "all";
  const priceFilter: PriceFilter = search.price ?? "all";
  const qInput = search.q ?? "";
  const hasActiveFilter = search.status !== undefined || search.price !== undefined || !!search.q;

  // Reset is a deliberate action; not replace:true so back-arrow restores the filtered view.
  const resetFilters = () => {
    navigate({ search: {} });
  };

  const activeModalRow = search.item
    ? rows.find(({ item }) => item.slug === search.item)
    : undefined;
  // Keep the last shown row around during the Dialog's close animation. Without this,
  // closing clears search.item synchronously, the conditional content unmounts, and
  // the Dialog briefly fades out an empty popover surface.
  // We update the ref in an effect (not during render) - concurrent renders can be
  // aborted and would otherwise leave the ref ahead of committed state.
  const lastModalRowRef = useRef(activeModalRow);
  useEffect(() => {
    if (activeModalRow) lastModalRowRef.current = activeModalRow;
  }, [activeModalRow]);
  const modalRow = activeModalRow ?? lastModalRowRef.current;
  // The URL mask makes the bar read /$slug/ but the matched route is still /, so
  // /$slug's head() never fires for the modal. Mirror it client-side here; cleanup
  // restores the listing title on close. Pure client nav, so no SSR concern.
  useEffect(() => {
    if (!activeModalRow) return;
    const prev = document.title;
    document.title = `${activeModalRow.translation.title} | Akhdan's Flea Market`;
    return () => {
      document.title = prev;
    };
  }, [activeModalRow]);
  // The route mask makes the URL bar show "/$slug/" while the router is actually still
  // matching "/" with ?item=slug - the modal-over-list pattern Instagram/Pinterest use.
  // unmaskOnReload: a refresh at /some-slug/ skips the mask and renders the standalone
  // detail route, so shared links go to the full page exactly as Instagram does.
  // We track whether THIS session pushed the modal entry; canGoBack() alone returns
  // true even when the previous entry is cross-origin, which would let close()
  // navigate off-site for a visitor who landed on /?item=foo via an external link.
  const modalPushedBySessionRef = useRef(false);
  const openModal = (slug: string) => {
    modalPushedBySessionRef.current = true;
    navigate({
      to: "/",
      search: (prev) => ({ ...prev, item: slug }),
      mask: { to: "/$slug/", params: { slug }, unmaskOnReload: true },
    });
  };
  // Closing pops the modal's pushed entry instead of pushing a new one - same shape
  // as Instagram: each modal session leaves exactly one entry in history, and
  // browser back from a closed state goes to whatever was before the modal opened.
  // Two fallback cases:
  //   - "pasted /?item=slug" with no prior entry: canGoBack is false -> push /.
  //   - opened from an external link (canGoBack true but the entry isn't ours):
  //     same push-/ behavior, so X never sends the visitor off-site.
  const closeModal = (open: boolean) => {
    if (open) return;
    if (modalPushedBySessionRef.current && router.history.canGoBack()) {
      modalPushedBySessionRef.current = false;
      router.history.back();
    } else {
      navigate({ to: "/", search: (prev) => ({ ...prev, item: undefined }) });
    }
  };
  // Modifier-click and middle-click fall through to the Link, opening the full /$slug
  // page in a new tab/window. Plain left-click opens the modal in place.
  const onCardClick = (slug: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openModal(slug);
  };

  // Trim at filter-time only. The visible Input still shows what the user typed
  // (including in-progress trailing spaces), but pure-whitespace queries don't
  // exclude everything via `.includes("   ")`.
  const q = qInput.trim().toLowerCase();
  // Word-start match for ASCII queries so "rice" doesn't surface items
  // whose description mentions "price" - the visitor didn't search for
  // a substring. CJK queries fall through to substring matching since
  // Japanese has no whitespace word boundaries and \b would never fire
  // between characters; "仙台" still needs to find "仙台駅" in the wild.
  const queryRe = q && /^[a-z0-9]/.test(q) ? new RegExp(`\\b${escapeRegex(q)}`) : null;
  const matchesQuery = (text: string) => (queryRe ? queryRe.test(text) : !q || text.includes(q));

  const filtered = rows.filter(({ item, translation }) => {
    if (search.status !== undefined && item.status !== search.status) return false;
    if (search.price === "free" && item.priceAmount !== null) return false;
    if (search.price === "paid" && item.priceAmount === null) return false;
    if (q && !matchesQuery(`${translation.title} ${translation.description}`.toLowerCase())) {
      return false;
    }
    return true;
  });
  // Bias the search results so title matches float above description-only
  // matches. Title is the "obvious" thing the visitor was looking for;
  // description hits stay surfaced (so "Sendai" or "PSE-certified" still
  // find the rice cooker) but rank below. Stable sort preserves the
  // status/createdAt order within each rank group. Skipped when q is
  // empty so the DB-driven order survives unfiltered browsing.
  if (q) {
    filtered.sort((a, b) => {
      const aRank = matchesQuery(a.translation.title.toLowerCase()) ? 0 : 1;
      const bRank = matchesQuery(b.translation.title.toLowerCase()) ? 0 : 1;
      return aRank - bRank;
    });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
      <div className="space-y-3 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <InputGroup className="max-w-md flex-1">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Search item's name or description..."
              value={qInput}
              onChange={(e) => setSearch({ q: e.target.value })}
            />
          </InputGroup>
          {hasActiveFilter ? (
            <Button type="button" onClick={resetFilters} variant="link">
              Reset
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <FilterRow
            label="Status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(v) => setSearch({ status: v })}
          />
          <FilterRow
            label="Price"
            options={PRICE_OPTIONS}
            value={priceFilter}
            onChange={(v) => setSearch({ price: v })}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        // Two zero-states with different remedies: the catalog is genuinely empty
        // (fresh deploy, all items deleted) vs the filters/search exclude everything.
        // No-items has no useful action; no-matches gets the Reset button.
        rows.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No items yet</EmptyTitle>
              <EmptyDescription>
                The catalog is empty. Check back later, or contact the owner if you were expecting
                to see something here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No items match</EmptyTitle>
              <EmptyDescription>
                Try adjusting the filters above, or clear them to see the full catalog.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
                Reset filters
              </Button>
            </EmptyContent>
          </Empty>
        )
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((row) => (
            <li key={row.item.id}>
              <ListCard row={row} onCardClick={onCardClick} />
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!activeModalRow} onOpenChange={closeModal}>
        {/* Scroll lives on the inner div so the absolutely-positioned close button below
            stays pinned to the dialog corner instead of scrolling away with the content. */}
        <DialogContent
          showCloseButton={false}
          className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-md lg:max-h-[75vh] lg:max-w-3xl"
        >
          {/* Semi-transparent corner close button - pinned to the DialogContent frame,
              so it stays put while the inner content scrolls underneath. */}
          <button
            type="button"
            onClick={() => closeModal(false)}
            aria-label="Close"
            className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60"
          >
            <XIcon className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </button>
          {/* Below lg: this wrapper scrolls the whole stacked content. At lg: it lets
              the inner grid set its own height (modal hugs its content up to 90vh) and
              hands scroll responsibility to the info column, which carries its own
              max-h so the modal never exceeds DialogContent's frame. */}
          <div className="max-h-[90vh] overflow-y-auto p-4 lg:overflow-visible">
            {modalRow ? (
              <>
                <DialogTitle className="sr-only">{modalRow.translation.title}</DialogTitle>
                <DialogDescription className="sr-only">Item details</DialogDescription>
                {/* key={slug} forces a full remount when the modal swaps items so
                    Embla resets and the "N / M" indicator can't go stale. Currently
                    the modal blocks underneath cards, but cheap insurance if we ever
                    add prev/next inside the modal. */}
                <DetailContent
                  key={modalRow.item.slug}
                  item={modalRow.item}
                  translation={modalRow.translation}
                  variant="modal"
                />
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Per-row component so the cart subscription is scoped: a cart mutation only
// re-renders the affected card (the one whose slug membership flipped),
// not the entire list. Same hydration strategy as CartToggleButton - until
// useHasMounted flips true the ring stays off, matching the SSR markup.
function ListCard({
  row,
  onCardClick,
}: {
  row: Row;
  onCardClick: (slug: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { item, translation } = row;
  const mounted = useHasMounted();
  const inCart = useCart((s) => s.slugs.has(item.slug));
  const selected = mounted && inCart;
  const sold = item.status === "sold";
  const reserved = item.status === "reserved";
  return (
    <Card
      className={cn(
        "relative overflow-hidden pt-0 pb-4 transition hover:shadow-md",
        selected && "border-transparent ring-4 ring-primary",
        // Unavailable cards recede so available items dominate the grid.
        // Reserved sits at 80% (soft signal - it might still come back),
        // sold drops to 40% and grayscales the photo (hard signal - done).
        // Opacity cascades to the banner too; the colored sash stays the
        // primary indicator and remains legible at both levels.
        reserved && "opacity-80",
        sold && "opacity-40",
      )}
    >
      {/* Inner ring drawn on a separate overlay (not via inset-ring on the
          Card) so it paints ABOVE the photo. Tailwind's inset-ring is an
          inset box-shadow, which renders behind the element's child
          content - the opaque <img> would hide it on the photo half of
          the card. An absolutely-positioned overlay stacks above the
          photo, so its inset box-shadow lands on top. z-30 keeps it above
          the photo (img), the Link overlay (z-10), and the cart toggle
          (z-20); pointer-events-none so it doesn't intercept clicks.
          Always mounted (color toggles transparent <-> primary) so the
          inset ring transitions in lockstep with the Card's outer ring;
          conditional mount would pop in instantly while the outer ring
          fades over 150ms. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-30 rounded-[inherit] ring-4 ring-inset transition",
          selected ? "ring-primary" : "ring-transparent",
        )}
      />
      {/* Photo area: the Link is an absolute overlay (z-10) covering
          the photo for clicks; the cart toggle is a sibling at z-20
          so its own clicks resolve before reaching the Link. This
          keeps the structure HTML-valid - nesting <button> inside
          <a> is disallowed by the spec and bites assistive tech.
          Plain click on the photo opens the in-place modal (via
          onCardClick's preventDefault). Cmd/middle/right-click on
          the photo falls through to the Link's /$slug/ href. */}
      <div className="relative">
        {item.photos.length > 0 ? (
          <img
            src={optimizedImageUrl(item.photos[0]!.key, { width: 400 })}
            alt={item.photos[0]!.alt ?? translation.title}
            className={cn("aspect-square w-full object-cover", sold && "grayscale")}
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
            No photo
          </div>
        )}
        <StatusBanner status={item.status} />
        <PricePill amount={item.priceAmount} currency={item.priceCurrency} size="card" />
        <Link
          to="/$slug/"
          params={{ slug: item.slug }}
          onClick={onCardClick(item.slug)}
          // Photo click opens the modal (onClick preventDefault), so a
          // hover-preload of /$slug/'s loader would be discarded. The title
          // Link below keeps preload-on-intent because clicking it really
          // does navigate to the standalone page.
          preload={false}
          // The title Link in <CardHeader> below carries the accessible
          // name. Hiding this Link from a11y prevents a screen reader
          // from announcing the same title twice per card; tabIndex=-1
          // keeps it out of the keyboard tab order for the same reason.
          // Mouse / touch clicks still fire onClick and open the modal.
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 z-10"
        />
        <CartToggleButton slug={item.slug} status={item.status} variant="card" />
      </div>
      {/* Title: plain Link to the standalone /$slug/ page. No onClick
          intercept, so a regular click does an SPA nav to the full detail
          page (not the modal). Underlines on hover for affordance. */}
      <CardHeader>
        <CardTitle className="line-clamp-2">
          <Link
            to="/$slug/"
            params={{ slug: item.slug }}
            className="underline-offset-4 hover:underline"
          >
            {translation.title}
          </Link>
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

function FilterRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-2 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

// Shown only on client-side navigation when the loader takes longer than pendingMs.
// SSR delivers fully-rendered HTML on first visit, so this never renders then. The
// main beneficiary is the detail -> back-to-list transition on slow connections.
function ListSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
      <div className="space-y-3 pb-6">
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Skeleton className="h-7 w-72 rounded-full" />
          <Skeleton className="h-7 w-48 rounded-full" />
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          // Static skeleton tiles in render order; key is the index.
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}>
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="mt-2 h-5 w-3/4" />
            <Skeleton className="mt-1 h-4 w-1/2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
