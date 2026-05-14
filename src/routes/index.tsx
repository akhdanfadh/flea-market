import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { desc, inArray, ne } from "drizzle-orm";
import { SearchIcon, SearchXIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { z } from "zod";

import type { DetailItem } from "@/components/detail-content.tsx";
import type { PublicItemStatus } from "@/lib/statuses.ts";

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

// Optional + catch(undefined) on every field is intentional: TanStack Router runs
// validateSearch on outbound navigation as well as inbound, so any `.catch("all")`
// default would be re-applied and serialized into the URL. Keeping the schema
// optional means missing/junk values stay `undefined`, the router drops `undefined`
// keys from the URL, and consumers fill defaults with `?? "all"` at read time.
const PRICE_FILTERS = ["free", "paid"] as const;
type PriceValue = (typeof PRICE_FILTERS)[number];

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

  const all = await db
    .select()
    .from(items)
    .where(ne(items.status, "draft"))
    .orderBy(desc(items.createdAt));
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
  const filtered = rows.filter(({ item, translation }) => {
    if (search.status !== undefined && item.status !== search.status) return false;
    if (search.price === "free" && item.priceAmount !== null) return false;
    if (search.price === "paid" && item.priceAmount === null) return false;
    if (q && !`${translation.title} ${translation.description}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

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
          {filtered.map(({ item, translation }) => (
            <li key={item.id}>
              <Card className="overflow-hidden pt-0 pb-4 transition hover:shadow-md">
                {/* Photo area: plain click opens the in-place modal (via the onClick
                    intercept). Cmd/middle/right-click falls through to the Link's
                    /$slug/ href, opening the standalone page in a new tab. */}
                <Link
                  to="/$slug/"
                  params={{ slug: item.slug }}
                  onClick={onCardClick(item.slug)}
                  // Photo click opens the modal (onClick preventDefault), so a
                  // hover-preload of /$slug/'s loader would be discarded. The title
                  // Link below keeps preload-on-intent because clicking it really
                  // does navigate to the standalone page.
                  preload={false}
                  className="block"
                >
                  <div className="relative">
                    {item.photos.length > 0 ? (
                      <img
                        src={optimizedImageUrl(item.photos[0]!.key, { width: 400 })}
                        alt={item.photos[0]!.alt ?? translation.title}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                        No photo
                      </div>
                    )}
                    <StatusBanner status={item.status} />
                    <PricePill
                      amount={item.priceAmount}
                      currency={item.priceCurrency}
                      size="card"
                    />
                  </div>
                </Link>
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
