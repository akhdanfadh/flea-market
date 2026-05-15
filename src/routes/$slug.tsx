import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, ne } from "drizzle-orm";
import { ChevronLeftIcon } from "lucide-react";
import { z } from "zod";

import type { DetailItem } from "@/components/detail-content.tsx";

import { DetailContent } from "@/components/detail-content.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db/client.ts";
import { itemTranslations, items } from "@/db/schema.ts";
import { getLanguage } from "@/lib/lang.server.ts";
import { serializeItem } from "@/lib/serialize-item.ts";
import { cn } from "@/lib/utils.ts";

// `?from=admin` tells the back link to point at the admin table instead of
// the public catalog. The literal "admin" survives TanStack Router's default
// JSON.parse pass on inbound search values (it isn't valid JSON, so the
// parser falls back to the raw string) - same pattern as `?failed=yes` on
// the login route. Anything else gets caught and stripped.
const searchSchema = z.object({
  from: z.literal("admin").optional().catch(undefined),
});

type DetailPayload = {
  item: DetailItem;
  translation: { title: string; description: string };
};

const loadDetail = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<DetailPayload> => {
    const language = getLanguage();
    const db = getDb();

    const found = await db
      .select()
      .from(items)
      .where(and(eq(items.slug, slug), ne(items.status, "draft")))
      .limit(1);
    const item = found[0];
    if (!item) {
      // Drafts also land here - the loader treats them as "not found" so
      // visitors with a stale share link can't see a half-finished item.
      throw notFound();
    }

    const trs = await db
      .select()
      .from(itemTranslations)
      .where(
        and(
          eq(itemTranslations.itemId, item.id),
          inArray(itemTranslations.language, ["en", language]),
        ),
      );
    const pref = trs.find((t) => t.language === language);
    const en = trs.find((t) => t.language === "en");
    const t = pref ?? en;

    return {
      item: serializeItem(item),
      translation: t
        ? { title: t.title, description: t.description }
        : { title: item.slug, description: "" },
    };
  });

export const Route = createFileRoute("/$slug")({
  loader: ({ params }) => loadDetail({ data: params.slug }),
  validateSearch: searchSchema,
  head: ({ loaderData }) =>
    loaderData
      ? { meta: [{ title: `${loaderData.translation.title} | Akhdan's Flea Market` }] }
      : {},
  component: Detail,
  pendingComponent: DetailSkeleton,
  // pendingMs: don't flash a skeleton on fast loader resolves; only show after 200ms.
  // pendingMinMs: once shown, hold for 300ms so a near-instant arrival doesn't flicker.
  pendingMs: 200,
  pendingMinMs: 300,
});

// At lg: the wrapper consumes exactly the viewport row between SiteHeader and
// SiteFooter (both ~3.5rem tall under their p-4 padding) and hides its overflow,
// so the page itself doesn't scroll - only the description inside DetailContent
// scrolls. 7rem covers header + footer with a small visual margin; tune if either
// component's padding/typography changes. The grid-rows pattern keeps the back
// link auto-height and lets DetailContent fill the remainder via its lg:h-full;
// minmax(0, 1fr) lets the inner description's overflow-y:auto actually trigger
// instead of pushing the 1fr row past the viewport bottom.
const PAGE_FRAME_LG =
  "lg:grid lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-4 lg:h-[calc(100dvh-7rem)] lg:overflow-hidden";

const BACK_LINK_CLASS =
  "mb-4 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:mb-0";

function Detail() {
  const { item, translation } = Route.useLoaderData();
  const { from } = Route.useSearch();
  // Pathname-typed Link: TanStack Router's typed routes don't accept a union
  // for `to`, so render the right Link branch instead of computing the target.
  return (
    <div
      className={cn("mx-auto max-w-6xl px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8", PAGE_FRAME_LG)}
    >
      {from === "admin" ? (
        <Link to="/admin/" className={BACK_LINK_CLASS}>
          <ChevronLeftIcon className="size-4" />
          Back to items
        </Link>
      ) : (
        <Link to="/" className={BACK_LINK_CLASS}>
          <ChevronLeftIcon className="size-4" />
          Back to catalog
        </Link>
      )}
      <DetailContent item={item} translation={translation} variant="page" />
    </div>
  );
}

// Mirrors Detail's layout one-for-one so the skeleton-to-real transition has no shift.
// Only shown on client-side nav (SSR delivers fully-rendered HTML); thresholds on the
// route config keep it hidden on fast loads and stable on near-instant ones.
function DetailSkeleton() {
  return (
    <div
      className={cn("mx-auto max-w-6xl px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8", PAGE_FRAME_LG)}
    >
      <Skeleton className="mb-4 h-5 w-32 lg:mb-0" />
      <div className="lg:grid lg:h-full lg:grid-cols-2 lg:gap-8">
        <Skeleton className="mx-auto aspect-square w-full rounded-lg sm:max-w-md lg:mx-0 lg:max-w-none lg:self-center" />

        <div className="mt-6 flex flex-col gap-3 lg:mt-0 lg:h-full lg:min-h-0">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-6 w-24" />
          <div className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
