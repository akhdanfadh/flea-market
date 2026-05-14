import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray } from "drizzle-orm";

import type { DetailItem } from "@/components/detail-content.tsx";

import { DetailContent } from "@/components/detail-content.tsx";
import { Skeleton } from "@/components/ui/skeleton";
import { getDb } from "@/db/client.ts";
import { itemTranslations, items } from "@/db/schema.ts";
import { getLanguage } from "@/lib/lang.server.ts";
import { serializeItem } from "@/lib/serialize-item.ts";

type DetailPayload = {
  item: DetailItem;
  translation: { title: string; description: string };
};

const loadDetail = createServerFn({ method: "GET" })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }): Promise<DetailPayload> => {
    const language = getLanguage();
    const db = getDb();

    const found = await db.select().from(items).where(eq(items.slug, slug)).limit(1);
    const item = found[0];
    if (!item) {
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

function Detail() {
  const { item, translation } = Route.useLoaderData();

  return (
    <div className="mx-auto max-w-4xl pt-2 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
      <DetailContent item={item} translation={translation} />
    </div>
  );
}

// Mirrors Detail's layout one-for-one so the skeleton-to-real transition has no shift.
// Only shown on client-side nav (SSR delivers fully-rendered HTML); thresholds on the
// route config keep it hidden on fast loads and stable on near-instant ones.
function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-4xl pt-2 px-4 pb-4 sm:px-6 sm:pb-6 md:px-8 md:pb-8">
      <Skeleton className="aspect-square w-full rounded-lg sm:max-w-md" />

      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-6 w-24" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}
