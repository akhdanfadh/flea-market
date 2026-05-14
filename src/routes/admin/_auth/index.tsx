import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { desc, eq, inArray } from "drizzle-orm";
import {
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  LanguagesIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import type { Currency, ItemPhoto, ItemStatus, Language } from "@/db/schema.ts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db/client.ts";
import { ITEM_STATUSES, LANGUAGES, itemTranslations, items } from "@/db/schema.ts";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/auth.server.ts";
import { formatPrice } from "@/lib/money.ts";
import { cn } from "@/lib/utils.ts";

type AdminItemRow = {
  id: string;
  slug: string;
  priceAmount: number | null;
  priceCurrency: Currency | null;
  status: ItemStatus;
  photos: ItemPhoto[];
  updatedAt: number;
  title: string;
  languages: Language[];
};

const getAdminItems = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminItemRow[]> => {
    if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
      throw redirect({ to: "/admin/login/" });
    }
    const db = getDb();
    const rows = await db.select().from(items).orderBy(desc(items.updatedAt));
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const trans = await db
      .select()
      .from(itemTranslations)
      .where(inArray(itemTranslations.itemId, ids));
    const enTitleById = new Map<string, string>();
    const langsById = new Map<string, Set<Language>>();
    for (const t of trans) {
      if (t.language === "en") enTitleById.set(t.itemId, t.title);
      const set = langsById.get(t.itemId) ?? new Set<Language>();
      set.add(t.language);
      langsById.set(t.itemId, set);
    }
    return rows.map((r) => {
      const langSet = langsById.get(r.id);
      // Filter LANGUAGES to preserve schema order (en, then id, then any
      // future addition) without relying on Set iteration order.
      const languages = langSet ? LANGUAGES.filter((l) => langSet.has(l)) : [];
      return {
        id: r.id,
        slug: r.slug,
        priceAmount: r.priceAmount,
        priceCurrency: r.priceCurrency,
        status: r.status,
        photos: r.photos,
        updatedAt: r.updatedAt.getTime(),
        title: enTitleById.get(r.id) ?? r.slug,
        languages,
      };
    });
  },
);

const setItemStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1), status: z.enum(ITEM_STATUSES) }))
  .handler(async ({ data }) => {
    if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
      throw redirect({ to: "/admin/login/" });
    }
    const db = getDb();
    const result = await db.update(items).set({ status: data.status }).where(eq(items.id, data.id));
    // Parity with deleteItem: surface a missing row to the caller so the
    // client toasts an error rather than a misleading "Status updated"
    // (e.g. when the row was deleted in another tab between page load and
    // click).
    if (result.rowsAffected === 0) {
      throw new Error("Item not found (it may have been deleted already)");
    }
  });

const deleteItem = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
      throw redirect({ to: "/admin/login/" });
    }
    const db = getDb();
    const found = await db
      .select({ photos: items.photos })
      .from(items)
      .where(eq(items.id, data.id))
      .limit(1);
    const row = found[0];
    // Item may have been deleted in another tab; surface to the caller so the
    // client toasts an error rather than a false "Item deleted".
    if (!row) throw new Error("Item not found (it may have been deleted already)");
    // FK ON DELETE CASCADE drops translations.
    await db.delete(items).where(eq(items.id, data.id));
    // Best-effort R2 cleanup - a failure here leaves an orphan, but we don't
    // want a flaky R2 delete to fail the request after the DB row is gone.
    // NOTE: if orphans show up in R2 listings, write a sweep script that
    // diffs R2 keys against `items.photos` references and removes the diff.
    for (const photo of row.photos) {
      try {
        await env.BUCKET.delete(photo.key);
      } catch {
        // intentionally swallowed - orphan handled out-of-band
      }
    }
  });

// Filter state lives in the URL so a refresh / share-link preserves it.
// Schema stays optional + catch(undefined) so junk values get dropped instead of
// throwing, and TanStack Router's outbound canonicalization strips the key
// when status is "all" (we map "all" -> undefined at write time).
const adminSearchSchema = z.object({
  status: z.enum(ITEM_STATUSES).optional().catch(undefined),
});
type StatusFilter = "all" | ItemStatus;

// Single source of truth for human-readable labels. The dropdown menu, the
// filter chips, the trigger button, and the success toast description all
// pull from here so adding a new status (e.g. "draft") means editing one
// place. STATUS_OPTIONS is derived below.
const STATUS_LABEL: Record<StatusFilter, string> = {
  all: "All",
  available: "Available",
  reserved: "Reserved",
  sold: "Sold",
};

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = (
  ["all", ...ITEM_STATUSES] as const
).map((value) => ({ value, label: STATUS_LABEL[value] }));

export const Route = createFileRoute("/admin/_auth/")({
  validateSearch: adminSearchSchema,
  loader: () => getAdminItems(),
  component: AdminIndex,
  // Same thresholds as the public list: skip the flash on fast loads,
  // hold on near-instant ones. Only fires on client-side nav (e.g.
  // edit -> back to list); SSR delivers fully-rendered HTML first time.
  pendingComponent: AdminListSkeleton,
  pendingMs: 200,
  pendingMinMs: 300,
});

function AdminIndex() {
  const rows = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const statusFilter: StatusFilter = search.status ?? "all";
  const filtered = statusFilter === "all" ? rows : rows.filter((r) => r.status === statusFilter);

  const setStatus = (v: StatusFilter) => {
    navigate({
      search: (prev) => ({ ...prev, status: v === "all" ? undefined : v }),
      replace: true,
    });
  };

  const countLabel =
    filtered.length === rows.length
      ? `Items (${rows.length})`
      : `Items (${filtered.length} of ${rows.length})`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{countLabel}</h2>
        <Button render={<Link to="/admin/new/" />} nativeButton={false} size="sm">
          <PlusIcon className="size-4" />
          New item
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-2 text-xs tracking-wide text-muted-foreground uppercase">Status</span>
        {STATUS_OPTIONS.map((opt) => {
          const active = opt.value === statusFilter;
          return (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => setStatus(opt.value)}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No items yet</EmptyTitle>
            <EmptyDescription>Create the first listing to get started.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/admin/new/" />} nativeButton={false} size="sm">
              <PlusIcon className="size-4" />
              Create item
            </Button>
          </EmptyContent>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              No items have status &quot;{STATUS_LABEL[statusFilter]}&quot;.{" "}
              <button
                type="button"
                onClick={() => setStatus("all")}
                className="underline underline-offset-2 hover:text-foreground"
              >
                Clear filter
              </button>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Price</TableHead>
                <TableHead aria-label="Photo count">
                  <ImageIcon className="size-4" />
                </TableHead>
                <TableHead aria-label="Languages">
                  <LanguagesIcon className="size-4" />
                </TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&>tr:nth-child(even):not(:hover)]:bg-muted/20">
              {filtered.map((row) => (
                <ItemRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ItemRow({ row }: { row: AdminItemRow }) {
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  // Optimistic status reflects the click instantly so the colored trigger
  // and the menu's check mark update without waiting on the round-trip.
  // Cleared after router.invalidate() refreshes row.status from the server,
  // or cleared on failure so the unchanged `row.status` shows through again.
  const [optimisticStatus, setOptimisticStatus] = useState<ItemStatus | null>(null);
  const displayStatus = optimisticStatus ?? row.status;

  async function changeStatus(next: ItemStatus) {
    if (next === displayStatus) return;
    const prev = displayStatus;
    setOptimisticStatus(next);
    setStatusBusy(true);
    // Split the awaits so we can distinguish "mutation failed" from "mutation
    // succeeded but refresh failed" - in the latter case the server has the
    // new value, so we keep optimistic state set and toast a warning rather
    // than a misleading "Failed to update status".
    try {
      await setItemStatus({ data: { id: row.id, status: next } });
    } catch (err) {
      setOptimisticStatus(null);
      toast.error("Failed to update status", {
        description: err instanceof Error ? err.message : String(err),
      });
      setStatusBusy(false);
      return;
    }
    try {
      await router.invalidate();
      setOptimisticStatus(null);
      toast.success("Status updated", {
        description: `Changed from ${STATUS_LABEL[prev]} to ${STATUS_LABEL[next]} for "${row.title}"`,
      });
    } catch {
      // Mutation already landed server-side; leave the optimistic UI in place
      // so the admin still sees what they picked.
      toast.warning("Status updated, but the table didn't refresh", {
        description: "Reload to see the latest state.",
      });
    } finally {
      setStatusBusy(false);
    }
  }

  function confirmDelete() {
    // Close the dialog first so its exit animation runs before the row
    // unmounts via router.invalidate(). Without this the dialog vanishes
    // mid-animation when the deleted row drops out of the loader data.
    setDeleteOpen(false);
    // toast.promise bridges the dialog-close -> row-disappear gap with a
    // visible "Deleting..." loading state. Delete has no optimistic UI
    // (the row only goes away after invalidate refreshes the loader), so
    // a loading toast is genuine feedback rather than a contradiction.
    // NOTE: in the exotic case where deleteItem succeeds but router.invalidate
    // rejects (e.g. session expired mid-request), the toast.error path fires
    // with "Failed to delete item" even though the server-side delete landed.
    // The row stays in the stale table until the next nav. Acceptable at
    // single-admin scale; splitting the awaits to express this distinction is
    // harder under toast.promise than under manual try/catch.
    toast.promise(
      (async () => {
        await deleteItem({ data: { id: row.id } });
        await router.invalidate();
      })(),
      {
        loading: "Deleting item...",
        success: {
          message: "Item deleted",
          description: `Removed "${row.title}"`,
        },
        error: (err: unknown) => ({
          message: "Failed to delete item",
          description: err instanceof Error ? err.message : String(err),
        }),
      },
    );
  }

  return (
    <TableRow>
      <TableCell>
        <div className="max-w-xs">
          <Link
            to="/$slug/"
            params={{ slug: row.slug }}
            className="block truncate font-medium hover:underline"
            title={row.title}
          >
            {row.title}
          </Link>
          <div className="block truncate font-mono text-xs text-muted-foreground" title={row.slug}>
            {row.slug}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={statusBusy}
                className={cn("justify-between", STATUS_TRIGGER[displayStatus])}
              >
                {/* All labels stacked in one grid cell so CSS sizes the button */}
                {/* to the widest. Non-active labels are `invisible` (kept in */}
                {/* layout) + `aria-hidden` (skipped by screen readers). */}
                <span className="grid text-left">
                  {ITEM_STATUSES.map((s) => (
                    <span
                      key={s}
                      aria-hidden={s !== displayStatus || undefined}
                      className={cn("col-start-1 row-start-1", s !== displayStatus && "invisible")}
                    >
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </span>
                <ChevronDownIcon className="size-3.5 opacity-70" />
              </Button>
            }
          />
          {/* Popup base style is `w-(--anchor-width) min-w-32` (128px floor). */}
          {/* The trigger now sizes itself to the widest label, so drop the */}
          {/* min and let the popup match the anchor exactly. */}
          <DropdownMenuContent align="start" className="min-w-0">
            {ITEM_STATUSES.map((s) => {
              const isCurrent = s === displayStatus;
              return (
                <DropdownMenuItem key={s} disabled={isCurrent} onClick={() => changeStatus(s)}>
                  {STATUS_LABEL[s]}
                  {isCurrent && <CheckIcon className="ml-auto size-3.5 opacity-70" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
      <TableCell>
        {row.priceAmount === null || row.priceCurrency === null
          ? "Free"
          : formatPrice(row.priceAmount, row.priceCurrency)}
      </TableCell>
      <TableCell>{row.photos.length}</TableCell>
      <TableCell>
        <span className="font-mono text-xs">{row.languages.join(",")}</span>
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {formatUpdatedAt(row.updatedAt)}
      </TableCell>
      <TableCell>
        <ButtonGroup>
          <Button
            render={<Link to="/admin/$slug/edit/" params={{ slug: row.slug }} />}
            nativeButton={false}
            size="sm"
            variant="outline"
          >
            <PencilIcon className="size-3.5" />
            <span className="sr-only">Edit</span>
          </Button>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="outline">
                  <Trash2Icon className="size-3.5 text-destructive" />
                  <span className="sr-only">Delete</span>
                </Button>
              }
            />
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete &quot;{row.title}&quot;?</AlertDialogTitle>
                <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="bg-background">
                <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={confirmDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </ButtonGroup>
      </TableCell>
    </TableRow>
  );
}

// Mirrors AdminIndex's layout one-for-one so the skeleton -> real transition
// has no shift. Client-side nav only (SSR delivers fully-rendered HTML).
function AdminListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Skeleton className="mr-2 h-4 w-12" />
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-14" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="space-y-2 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            // Static placeholder rows; index is the only stable key here.
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ISO-ish compact: "2026-05-14 21:22". Locale-independent (no Intl) so the
// format is identical across browsers, but renders in the browser's local
// timezone via getHours()/getDate() etc - admin sees wall-clock time, not
// UTC. Intentional: at single-admin scale the admin's wall clock is the
// reference frame.
function formatUpdatedAt(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// Status color lives on the trigger Button itself, not a nested pill. Each
// entry overrides the outline variant's `dark:bg-input/30` rule (CLAUDE.md
// §4 rule 9 - a plain `bg-*` loses the cascade against the dark: variant
// the base classes carry).
const STATUS_TRIGGER: Record<ItemStatus, string> = {
  available:
    "border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25",
  reserved:
    "border-amber-500/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:text-amber-200 dark:bg-amber-500/15 dark:hover:bg-amber-500/25",
  sold: "border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200 dark:bg-rose-500/15 dark:hover:bg-rose-500/25",
};
