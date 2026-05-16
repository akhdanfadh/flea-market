import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Link, createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import type { Currency, ItemPhoto } from "@/db/schema.ts";
import type { ItemPayload } from "@/lib/item-schema.ts";

import { ChangeStatusDialog } from "@/components/admin/change-status-dialog.tsx";
import { PhotoDropzone } from "@/components/admin/photo-dropzone.tsx";
import { PhotoGrid } from "@/components/admin/photo-grid.tsx";
import { StatusSelect } from "@/components/admin/status-select.tsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { getDb } from "@/db/client.ts";
import { CURRENCIES, itemTranslations, items } from "@/db/schema.ts";
import { requireAdmin } from "@/lib/auth-middleware.ts";
import { ITEM_NOT_FOUND_ERROR } from "@/lib/item-actions.ts";
import { itemIdSchema, itemPayloadSchema } from "@/lib/item-schema.ts";
import { MINOR_UNITS, isCurrency } from "@/lib/money.ts";
import { generateUniqueSlug, withSlugErrorWrap } from "@/lib/slug.server.ts";
import { useChangeStatus } from "@/lib/use-change-status.ts";

type ItemForEdit = {
  id: string;
  slug: string;
  status: "draft" | "available" | "reserved" | "sold";
  photos: ItemPhoto[];
  payload: ItemPayload;
  defaultCurrency: Currency;
};

const getItemForEdit = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((slug: unknown) => z.string().min(1).parse(slug))
  .handler(async ({ data: slug }): Promise<ItemForEdit | null> => {
    const db = getDb();
    const found = await db.select().from(items).where(eq(items.slug, slug)).limit(1);
    const item = found[0];
    if (!item) return null;
    const trans = await db
      .select()
      .from(itemTranslations)
      .where(eq(itemTranslations.itemId, item.id));
    const en = trans.find((t) => t.language === "en");
    const id = trans.find((t) => t.language === "id");
    // Inline the env-driven default currency so the loader makes one RPC,
    // not two. DEFAULT_CURRENCY is a build-time public var; no auth-tier
    // reason to fetch it separately.
    const defaultCurrency: Currency = isCurrency(env.DEFAULT_CURRENCY)
      ? env.DEFAULT_CURRENCY
      : "JPY";
    // EN translation is an app-level invariant. Fall back to the slug as the
    // title if the row was inserted bypassing the form (seed script bug,
    // ad-hoc tooling); the form can then render and let the admin fix it.
    return {
      id: item.id,
      slug: item.slug,
      status: item.status,
      photos: item.photos,
      payload: {
        slug: item.slug,
        priceAmount: item.priceAmount,
        priceCurrency: item.priceCurrency,
        translations: {
          en: en
            ? { title: en.title, description: en.description }
            : { title: item.slug, description: "" },
          id: id ? { title: id.title, description: id.description } : undefined,
        },
      },
      defaultCurrency,
    };
  });

const updateItem = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(z.object({ id: itemIdSchema, payload: itemPayloadSchema }))
  .handler(async ({ data }): Promise<{ slug: string }> => {
    const db = getDb();

    // Probe inside the tx so the slug-uniqueness check and the update
    // observe the same snapshot; withSlugErrorWrap translates a UNIQUE
    // collision at commit into a friendly message instead of the raw
    // libsql error.
    const slug = await withSlugErrorWrap(() =>
      db.transaction(async (tx) => {
        const resolved = await generateUniqueSlug(data.payload.slug, tx, data.id);
        const result = await tx
          .update(items)
          .set({
            slug: resolved,
            priceAmount: data.payload.priceAmount,
            priceCurrency: data.payload.priceCurrency,
          })
          .where(eq(items.id, data.id));
        if (result.rowsAffected === 0) {
          throw new Error(ITEM_NOT_FOUND_ERROR);
        }
        // Translations are admin-controlled fully - delete + reinsert is
        // simpler than diffing upsert vs delete per language.
        await tx.delete(itemTranslations).where(eq(itemTranslations.itemId, data.id));
        const translationRows = [
          {
            itemId: data.id,
            language: "en" as const,
            title: data.payload.translations.en.title,
            description: data.payload.translations.en.description,
          },
          ...(data.payload.translations.id
            ? [
                {
                  itemId: data.id,
                  language: "id" as const,
                  title: data.payload.translations.id.title,
                  description: data.payload.translations.id.description,
                },
              ]
            : []),
        ];
        await tx.insert(itemTranslations).values(translationRows);
        return resolved;
      }),
    );
    return { slug };
  });

const removeItemPhoto = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(z.object({ id: itemIdSchema, key: z.string().min(1) }))
  .handler(async ({ data }) => {
    const db = getDb();
    const found = await db
      .select({ status: items.status, photos: items.photos })
      .from(items)
      .where(eq(items.id, data.id))
      .limit(1);
    const row = found[0];
    if (!row) throw new Error(ITEM_NOT_FOUND_ERROR);
    // Guard against deleting R2 objects that don't belong to this item.
    // Without this, a mistyped/malicious `key` would delete some other
    // item's photo while its DB row still references it (broken-image).
    // Filter-then-delete the row first would silently succeed even on a
    // bogus key; the explicit existence check makes the no-op case loud.
    const target = row.photos.find((p) => p.key === data.key);
    if (!target) return;
    // Symmetric to setItemStatus's entry gate: a published row always
    // keeps >=1 photo. The unpublish path (any -> draft) clears this
    // constraint, so the admin can wipe photos by moving to draft first.
    if (row.status !== "draft" && row.photos.length === 1) {
      throw new Error("Move to draft before removing the last photo.");
    }
    const photos = row.photos.filter((p) => p.key !== data.key);
    await db.update(items).set({ photos }).where(eq(items.id, data.id));
    // Best-effort R2 delete; same rationale as deleteItem.
    try {
      await env.BUCKET.delete(data.key);
    } catch {
      // intentionally swallowed - orphan handled out-of-band
    }
  });

const setItemPhotoOrder = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(z.object({ id: itemIdSchema, keys: z.array(z.string().min(1)).min(1) }))
  .handler(async ({ data }) => {
    const db = getDb();
    const found = await db
      .select({ photos: items.photos })
      .from(items)
      .where(eq(items.id, data.id))
      .limit(1);
    const row = found[0];
    if (!row) throw new Error(ITEM_NOT_FOUND_ERROR);
    // The incoming `keys` array must be a permutation of the current photos:
    // same length, all members exist, no duplicates. The duplicate check
    // matters because length+membership alone accepts `["A","A","B"]` against
    // `[A,B,C]` (lengths match, both names exist in byKey). Server fns don't
    // trust client input even when the client-side dnd-kit can't naturally
    // produce a duplicate.
    const byKey = new Map(row.photos.map((p) => [p.key, p]));
    const incoming = new Set(data.keys);
    if (
      data.keys.length !== row.photos.length ||
      incoming.size !== data.keys.length ||
      !data.keys.every((k) => byKey.has(k))
    ) {
      throw new Error("Photo set changed since the reorder started; refresh and try again");
    }
    const photos = data.keys.map((k) => byKey.get(k) as ItemPhoto);
    await db.update(items).set({ photos }).where(eq(items.id, data.id));
  });

const setItemPhotoAlt = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(z.object({ id: itemIdSchema, key: z.string().min(1), alt: z.string().max(200) }))
  .handler(async ({ data }) => {
    const db = getDb();
    const found = await db
      .select({ photos: items.photos })
      .from(items)
      .where(eq(items.id, data.id))
      .limit(1);
    const row = found[0];
    if (!row) throw new Error(ITEM_NOT_FOUND_ERROR);
    // Same shape as removeItemPhoto's stale-key guard: if the key isn't on
    // the row (caller's view is stale, or someone else removed it), early
    // return rather than writing an unchanged photos array back to the DB.
    const target = row.photos.find((p) => p.key === data.key);
    if (!target) return;
    const trimmed = data.alt.trim();
    const photos = row.photos.map((p) =>
      p.key === data.key ? { key: p.key, ...(trimmed ? { alt: trimmed } : {}) } : p,
    );
    await db.update(items).set({ photos }).where(eq(items.id, data.id));
  });

// Stable Sonner id so each X-click replaces the rolling toast rather than
// stacking. See removePhoto / commitPendingRemovals below.
const REMOVAL_TOAST_ID = "photo-removal-batch";
const REMOVAL_WINDOW_MS = 5000;

// Yellow left-rail accent applied to every Field whose value differs from
// the loader-returned default. `border-transparent` reserves the 10px slot
// at all times so toggling dirty state animates the border color only -
// no horizontal layout jump. Pulled out so changing the visual treatment
// is one edit, not 8.
const DIRTY_RAIL =
  "border-l-2 border-transparent pl-2 transition-colors data-dirty:border-primary/50";

// Hoisted so the `useRef` initializer below doesn't allocate a fresh empty
// object on every render. The ref is reassigned (never mutated in place)
// in toggleId / the loader-reset useEffect, so the shared reference is
// safe even if multiple component instances briefly share it.
const EMPTY_ID_TRANSLATION = { title: "", description: "" };

// Renders the live countdown inside the rolling-removal toast. Ticks at
// 250ms (only the displayed integer second changes; faster than 1Hz keeps
// the transition feeling responsive when admin clicks X near a boundary).
// Deadline is passed as a prop so re-issuing the toast with a new value
// (admin extends the window by clicking X again) re-renders this with the
// fresh target without unmounting the component.
function RemovalCountdownDescription({ deadline }: { deadline: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => tick((t) => t + 1), 250);
    return () => window.clearInterval(interval);
  }, []);
  const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return <>Click Undo within {remaining}s to restore.</>;
}

export const Route = createFileRoute("/admin/_auth/$slug/edit")({
  loader: async ({ params }) => {
    const result = await getItemForEdit({ data: params.slug });
    if (!result) throw notFound();
    return result;
  },
  component: EditItemPage,
});

function EditItemPage() {
  const loaderData = Route.useLoaderData();
  const router = useRouter();

  // Photos are server state - optimisticPhotos reflects the user's intent
  // until invalidate refreshes loader data, or reverts on error.
  const [optimisticPhotos, setOptimisticPhotos] = useState<ItemPhoto[] | null>(null);

  // Mirror of the removal flicker fix below: clearing optimisticPhotos
  // synchronously after `await router.invalidate()` races with loaderData
  // propagation - the setState renders first with the pre-mutation
  // loaderData, briefly showing the old photo order (on reorder) or the
  // upload snapshot without the just-added photo (on upload). Clearing
  // here once loaderData.photos actually changes lands the clear in the
  // same render as the new loaderData, eliminating that backslide.
  useEffect(() => {
    // No-op when optimisticPhotos is already null (React bails out on
    // same-value setState). Depending on optimisticPhotos here would
    // collapse the snapshot the moment a mutation sets it, before the
    // server even sees the action - that's exactly the staleness this
    // effect exists to avoid. Reacting to loaderData.photos only is
    // intentional.
    setOptimisticPhotos(null);
  }, [loaderData.photos]);

  // Photo removal uses a deferred-commit "Undo" pattern: each click queues
  // the key into pendingRemovals and (re)starts a single 5s commit timer.
  // The rolling toast (same Sonner id each click) reflects the current
  // count and exposes a single Undo that cancels all queued removals.
  // Hides the queued keys from the visible grid while the window is open,
  // then keeps them hidden until invalidate refreshes loader data so
  // they don't briefly reappear between commit and refresh.
  //
  // pendingRemovalsRef mirrors the state synchronously so the setTimeout
  // callback can read the latest queue without firing a side effect from
  // inside a setState updater - StrictMode dev double-invokes updaters,
  // which would launch two concurrent commitPendingRemovals.
  //
  // NOTE: a corner case the rolling toast can't faithfully cover: if the
  // admin clicks X *while* a commit batch is in flight (the 5s window has
  // already elapsed for an earlier batch), the new click starts a fresh
  // toast/timer pair, but Undo on it cannot cancel the in-flight server
  // calls from the prior batch. At single-admin scale the window is small
  // (server round-trip) and the worst outcome is "I clicked X, then Undo,
  // and one of my photos was still removed." Accept rather than design a
  // separate `committing` state to compose against.
  const [pendingRemovals, setPendingRemovals] = useState<Set<string>>(() => new Set());
  const pendingRemovalsRef = useRef(pendingRemovals);
  useEffect(() => {
    pendingRemovalsRef.current = pendingRemovals;
  }, [pendingRemovals]);
  const commitTimerRef = useRef<number | null>(null);

  // After commitPendingRemovals runs server fns + invalidate, TanStack Router's
  // store update and a synchronous setPendingRemovals don't batch into one
  // render: the setState renders first with stale loaderData, briefly
  // resurrecting the just-removed photo before loaderData catches up. Instead
  // of clearing in commit, drop keys here once loaderData reflects the
  // removal - that render is already correct (the photo is absent from
  // loaderData), so dropping the now-redundant filter key changes nothing
  // visible. Failed keys stay in loaderData and are cleared explicitly
  // inside commitPendingRemovals so they reappear matching server state.
  useEffect(() => {
    if (pendingRemovals.size === 0) return;
    const loaderKeys = new Set(loaderData.photos.map((p) => p.key));
    const next = new Set(pendingRemovals);
    let dirty = false;
    for (const key of pendingRemovals) {
      if (!loaderKeys.has(key)) {
        next.delete(key);
        dirty = true;
      }
    }
    if (dirty) setPendingRemovals(next);
  }, [loaderData.photos, pendingRemovals]);

  // Two layers compose the visible grid: `optimisticPhotos` covers upload
  // and reorder intent until invalidate refreshes loader data, and the
  // `pendingRemovals` filter hides X-clicked photos for their 5s undo
  // window. Uploads and reorders use the optimistic snapshot; removals
  // use the filter so they reappear cleanly on undo without rebuilding
  // the snapshot.
  const photos = (optimisticPhotos ?? loaderData.photos).filter((p) => !pendingRemovals.has(p.key));

  // Status uses the shared useChangeStatus hook (same machinery as the
  // admin table row). A click on a DropdownMenuItem stages the target via
  // requestStatusChange; the AlertDialog rendered below confirms or cancels.
  const {
    status,
    busy: statusBusy,
    pendingTarget: pendingStatusTarget,
    requestChange: requestStatusChange,
    confirmChange: confirmStatusChange,
    cancelChange: cancelStatusChange,
  } = useChangeStatus({
    id: loaderData.id,
    currentStatus: loaderData.status,
    refreshFailedTitle: "Status updated, but the page didn't refresh",
  });

  const [idEnabled, setIdEnabled] = useState(loaderData.payload.translations.id !== undefined);
  const idParkedRef = useRef<{ title: string; description: string }>(
    loaderData.payload.translations.id ?? EMPTY_ID_TRANSLATION,
  );
  // Per-currency amount parking so switching currencies round-trips without
  // destroying the typed value. Seeded from the loader's {currency, amount}
  // when present; updated on every currency-switch with the amount the admin
  // had in the currency being left behind. Without this, a JPY 15000 item
  // edited as USD then back to JPY would lose the original 15000 and require
  // a page reload to recover.
  const currencyAmountsRef = useRef<Map<Currency, number>>(new Map());
  // Same parking pattern as idParkedRef: when the admin toggles "Free" on,
  // park the typed priced values so re-toggling restores them. Initial
  // values cover both states - if the item is priced, the typed values are
  // already there; if it's free, we still need defaults to populate on
  // first un-toggle.
  const pricedParkedRef = useRef<{ priceAmount: number; priceCurrency: Currency }>({
    priceAmount: loaderData.payload.priceAmount ?? 0,
    priceCurrency: loaderData.payload.priceCurrency ?? loaderData.defaultCurrency,
  });

  // onTouched validates after each field's first blur (then re-validates
  // on change while the error is showing). The admin types freely;
  // tabbing away from an invalid slug or out-of-range price surfaces the
  // error instead of holding it until Save.
  const form = useForm<ItemPayload>({
    resolver: standardSchemaResolver(itemPayloadSchema),
    mode: "onTouched",
    defaultValues: loaderData.payload,
  });

  const isFree = form.watch("priceAmount") === null && form.watch("priceCurrency") === null;
  // The Free and "Add Indonesian translation" toggles aren't RHF fields, so
  // fieldState.isDirty doesn't apply. Derive their dirty signals by comparing
  // the local toggle state to what the loader returned - this keeps the
  // yellow rail consistent with the per-field accent even when toggling the
  // section off hides the underlying Fields that would otherwise carry it.
  const loaderHadId = loaderData.payload.translations.id !== undefined;
  const idToggleDirty = idEnabled !== loaderHadId;
  const loaderWasFree =
    loaderData.payload.priceAmount === null && loaderData.payload.priceCurrency === null;
  const freeToggleDirty = isFree !== loaderWasFree;
  const priceCurrency = form.watch("priceCurrency");

  // Re-init only when the underlying item changes (e.g. navigating from one
  // edit page to another). loaderData.payload is a fresh object on every
  // router.invalidate() (photo upload, status change, alt edit, etc.) - if
  // we keyed on that, every photo mutation would clobber the admin's in-
  // progress title/description/price edits. Keying on the item id keeps
  // typed form state across invalidates while still resetting on a real
  // route-level navigation between items.
  useEffect(() => {
    form.reset(loaderData.payload);
    setIdEnabled(loaderData.payload.translations.id !== undefined);
    idParkedRef.current = loaderData.payload.translations.id ?? EMPTY_ID_TRANSLATION;
    pricedParkedRef.current = {
      priceAmount: loaderData.payload.priceAmount ?? 0,
      priceCurrency: loaderData.payload.priceCurrency ?? loaderData.defaultCurrency,
    };
    currencyAmountsRef.current.clear();
    if (loaderData.payload.priceCurrency !== null && loaderData.payload.priceAmount !== null) {
      currencyAmountsRef.current.set(
        loaderData.payload.priceCurrency,
        loaderData.payload.priceAmount,
      );
    }
    // form is stable; reading loaderData.payload from closure is fine since
    // we only re-fire when the id changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.id]);

  function toggleId(next: boolean) {
    setIdEnabled(next);
    if (next) {
      form.setValue("translations.id", idParkedRef.current, { shouldDirty: true });
    } else {
      const current = form.getValues("translations.id");
      if (current) idParkedRef.current = current;
      form.setValue("translations.id", undefined, { shouldDirty: true });
    }
  }

  function toggleFree(next: boolean) {
    if (next) {
      // Park whatever is currently typed before nulling, so a re-toggle
      // brings it back instead of resetting to 0 + default currency.
      const currentAmount = form.getValues("priceAmount");
      const currentCurrency = form.getValues("priceCurrency");
      if (currentAmount !== null && currentCurrency !== null) {
        pricedParkedRef.current = {
          priceAmount: currentAmount,
          priceCurrency: currentCurrency,
        };
      }
      form.setValue("priceAmount", null, { shouldDirty: true });
      form.setValue("priceCurrency", null, { shouldDirty: true });
    } else {
      form.setValue("priceAmount", pricedParkedRef.current.priceAmount, { shouldDirty: true });
      form.setValue("priceCurrency", pricedParkedRef.current.priceCurrency, { shouldDirty: true });
    }
  }

  // Save flow is gated by an AlertDialog ("just like delete" + status).
  // RHF's onSubmit stashes the validated payload into pendingSave; the
  // dialog reads pendingSave !== null as its `open` signal. Confirm fires
  // performSave; cancel just clears pendingSave. No success toast - the
  // dialog closing + the form's dirty rails clearing on form.reset are
  // the signal. Errors still toast (the dialog has already closed by
  // the time the rejection lands).
  const [pendingSave, setPendingSave] = useState<ItemPayload | null>(null);
  const [saving, setSaving] = useState(false);

  function onFormSubmit(payload: ItemPayload) {
    setPendingSave(payload);
  }

  async function performSave(payload: ItemPayload) {
    let result: { slug: string };
    try {
      result = await updateItem({ data: { id: loaderData.id, payload } });
    } catch (err) {
      toast.error("Failed to save", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    // Reset the form so the saved values become the new "clean" baseline.
    // Without this, every dirty rail stays yellow after save because RHF
    // still compares against the original loader defaults. Includes the
    // server-resolved slug (may differ from payload.slug on collision
    // auto-suffix). Runs in both branches: the slug-change navigate
    // re-triggers the loader-reset useEffect, but only on loaderData.id,
    // which doesn't change here - we'd otherwise keep stale defaults.
    form.reset({ ...payload, slug: result.slug });
    if (result.slug !== loaderData.slug) {
      // Slug changed (manual edit or collision-suffix). Navigate to the new
      // URL so the loader refetches under the canonical slug. The form is
      // already reset above so the URL-vs-form-slug skew that previously
      // produced an infinite collision-suffix loop is also handled.
      try {
        await router.navigate({
          to: "/admin/$slug/edit/",
          params: { slug: result.slug },
        });
      } catch {
        // Save landed server-side; admin can reload to see the new URL.
      }
    } else {
      try {
        await router.invalidate();
      } catch {
        // Metadata is saved server-side; the form holds the user's edits.
      }
    }
  }

  async function confirmSave() {
    if (!pendingSave) return;
    const payload = pendingSave;
    setPendingSave(null);
    setSaving(true);
    try {
      await performSave(payload);
    } finally {
      setSaving(false);
    }
  }

  // Photo mutations all share this shape: optimistic update -> server fn ->
  // invalidate. The loaderData-sync effect above clears optimisticPhotos
  // once the refresh lands, so success doesn't need an inline clear. Error
  // reverts synchronously since loaderData hasn't changed.
  async function withOptimisticPhotos(
    next: ItemPhoto[],
    action: () => Promise<void>,
    errorTitle: string,
  ) {
    setOptimisticPhotos(next);
    try {
      await action();
      await router.invalidate();
    } catch (err) {
      setOptimisticPhotos(null);
      toast.error(errorTitle, {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onPhotosUploaded(next: ItemPhoto[]) {
    // Upload already completed server-side; this just covers the brief render
    // gap between the dropzone returning and the loader refresh picking up
    // the new photos array. No mutation to call here.
    setOptimisticPhotos(next);
    try {
      await router.invalidate();
    } catch {
      // The photos are on the server; only the page refresh failed. Keep
      // the optimistic snapshot in place so the just-uploaded thumbnails
      // remain visible until the next invalidate (e.g. on the next photo
      // mutation). Clearing in `finally` would briefly hide them.
      toast.warning("Photos uploaded, but the page didn't refresh", {
        description: "Reload to see the latest state.",
      });
    }
  }

  function removePhoto(key: string) {
    // Belt-and-suspenders with PhotoGrid's disabled state: a keyboard
    // activation or stale render shouldn't slip past the published-row
    // photo-gate. Server enforces the same in removeItemPhoto.
    if (photos.length === 1 && status !== "draft") return;
    // Read+compute via the ref (synchronous mirror of pendingRemovals) so
    // we don't fire side effects from inside a setState updater. setState
    // itself stays straightforward.
    const alreadyPending = pendingRemovalsRef.current.has(key);
    const newCount = alreadyPending
      ? pendingRemovalsRef.current.size
      : pendingRemovalsRef.current.size + 1;
    if (!alreadyPending) {
      setPendingRemovals((prev) => new Set(prev).add(key));
    }

    if (commitTimerRef.current !== null) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      // Snapshot keys from the ref (not via setState updater) so commit
      // fires exactly once even under StrictMode double-invocation. The
      // keys stay in pendingRemovals while commit is in flight so the
      // photos stay hidden until invalidate refreshes loader data;
      // commitPendingRemovals clears them via setPendingRemovals after.
      void commitPendingRemovals(Array.from(pendingRemovalsRef.current));
    }, REMOVAL_WINDOW_MS);

    const deadline = Date.now() + REMOVAL_WINDOW_MS;
    toast.message(`${newCount} photo${newCount === 1 ? "" : "s"} will be permanently removed`, {
      id: REMOVAL_TOAST_ID,
      description: <RemovalCountdownDescription deadline={deadline} />,
      action: {
        label: "Undo",
        onClick: () => {
          if (commitTimerRef.current !== null) {
            clearTimeout(commitTimerRef.current);
            commitTimerRef.current = null;
          }
          setPendingRemovals(new Set());
          toast.dismiss(REMOVAL_TOAST_ID);
        },
      },
      duration: REMOVAL_WINDOW_MS,
    });
  }

  async function commitPendingRemovals(keys: string[]) {
    // Attempt every key independently - each removeItemPhoto operates on its
    // own row, so a transient failure for one key shouldn't abandon the rest
    // unattempted. Otherwise the user's "remove A, B, C" intent silently
    // collapses to "tried A, gave up on B and C" with no clear signal.
    let succeeded = 0;
    const failures: { key: string; error: unknown }[] = [];
    for (const key of keys) {
      try {
        await removeItemPhoto({ data: { id: loaderData.id, key } });
        succeeded++;
      } catch (err) {
        failures.push({ key, error: err });
      }
    }
    try {
      await router.invalidate();
    } catch {
      // Swallow: any successful removals are now on the server; the toast
      // below covers user feedback even if the page state lags.
    }
    // Only clear FAILED keys here. Succeeded ones are dropped by the
    // loaderData-sync effect once React commits the post-invalidate render -
    // clearing them inline causes a flicker (stale-loaderData render
    // resurrects the photo for one frame). Failures stay in loaderData,
    // so the effect won't drop them and they'd stay hidden indefinitely
    // without this explicit clear.
    if (failures.length > 0) {
      const failedKeys = new Set(failures.map((f) => f.key));
      setPendingRemovals((prev) => {
        const next = new Set(prev);
        for (const key of failedKeys) next.delete(key);
        return next;
      });
    }
    if (failures.length === 0) {
      toast.success(`${succeeded} photo${succeeded === 1 ? "" : "s"} removed`, {
        id: REMOVAL_TOAST_ID,
      });
    } else if (succeeded === 0) {
      const first = failures[0].error;
      toast.error(`Failed to remove photo${failures.length === 1 ? "" : "s"}`, {
        id: REMOVAL_TOAST_ID,
        description: first instanceof Error ? first.message : String(first),
      });
    } else {
      const first = failures[0].error;
      toast.warning(`Removed ${succeeded} of ${keys.length} photos`, {
        id: REMOVAL_TOAST_ID,
        description: `${failures.length} failed: ${first instanceof Error ? first.message : String(first)}`,
      });
    }
  }

  function reorderPhotos(next: ItemPhoto[]) {
    void withOptimisticPhotos(
      next,
      () => setItemPhotoOrder({ data: { id: loaderData.id, keys: next.map((p) => p.key) } }),
      "Failed to reorder photos",
    );
  }

  function changePhotoAlt(key: string, alt: string) {
    // Alt edits don't need optimistic state - the input is uncontrolled and
    // shows the typed value locally; the server fn just persists it.
    setItemPhotoAlt({ data: { id: loaderData.id, key, alt } }).catch((err: unknown) => {
      toast.error("Failed to save alt text", {
        description: err instanceof Error ? err.message : String(err),
      });
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to="/admin/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Back to items
      </Link>
      {/* Header row: heading on the left, StatusSelect + Save on the right.
          Single line on sm+ via flex-wrap (the gap-y handles wrap spacing
          on narrow screens where the row stacks vertically). The Save here
          is a separate <button form="..."> that submits the form below by
          id - so the controls aren't trapped at the bottom of a long form. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-base font-semibold">Edit item</h2>
        <div className="flex items-center gap-2">
          <StatusSelect
            status={status}
            canExitDraft={photos.length > 0}
            busy={statusBusy}
            onChange={requestStatusChange}
          />
          <Button
            type="submit"
            form="edit-item-form"
            size="sm"
            disabled={saving || form.formState.isSubmitting}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <ChangeStatusDialog
        pendingTarget={pendingStatusTarget}
        currentStatus={status}
        onConfirm={confirmStatusChange}
        onCancel={cancelStatusChange}
      />
      <AlertDialog
        open={pendingSave !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSave(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The edits will replace the current values for this item.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="bg-background">
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Photos</h3>
        <PhotoDropzone
          itemId={loaderData.id}
          currentCount={photos.length}
          onUploaded={onPhotosUploaded}
        />
        <PhotoGrid
          photos={photos}
          canRemoveLast={status === "draft"}
          onReorder={reorderPhotos}
          onRemove={removePhoto}
          onAltChange={changePhotoAlt}
        />
        <p className="text-xs text-muted-foreground">
          First photo is the cover thumbnail. Drag the grip handle to reorder. Published item should
          have at least one photo.
          {status !== "draft" && " Change item to draft to remove the last photo."}
        </p>
      </section>

      <Separator />

      <form id="edit-item-form" onSubmit={form.handleSubmit(onFormSubmit)}>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>Price</FieldLegend>
            <FieldGroup>
              <Field
                orientation="horizontal"
                data-dirty={freeToggleDirty || undefined}
                className={DIRTY_RAIL}
              >
                <Checkbox id="free-toggle" checked={isFree} onCheckedChange={toggleFree} />
                <FieldLabel htmlFor="free-toggle">Free (no price)</FieldLabel>
              </Field>

              {!isFree && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
                  <Controller
                    control={form.control}
                    name="priceCurrency"
                    render={({ field, fieldState }) => (
                      <Field data-dirty={fieldState.isDirty || undefined} className={DIRTY_RAIL}>
                        <FieldLabel htmlFor="price-currency">Currency</FieldLabel>
                        <Select
                          value={field.value ?? loaderData.defaultCurrency}
                          onValueChange={(v) => {
                            // Park the amount under the currency we're leaving
                            // so a round-trip (JPY -> USD -> JPY) restores
                            // what the admin had instead of losing it. New
                            // currencies start at 0 + focus so the admin
                            // re-enters the value rather than silently
                            // persisting a reinterpreted minor-units price
                            // (1500 JPY = Y1500 but 1500 USD = $15.00).
                            // Conversion is explicitly out of scope (see
                            // ARCHITECTURE.md non-goals).
                            //
                            // clearErrors + shouldValidate:false suppresses the
                            // "Enter a price greater than zero" red flash that
                            // RHF's reValidateMode='onChange' would otherwise
                            // fire after a prior failed submit on this field -
                            // the admin's about to type, so revalidate then.
                            const nextCurrency = v as Currency;
                            const currentCurrency = field.value;
                            const currentAmount = form.getValues("priceAmount");
                            if (currentCurrency !== null && currentAmount !== null) {
                              currencyAmountsRef.current.set(currentCurrency, currentAmount);
                            }
                            field.onChange(nextCurrency);
                            form.clearErrors("priceAmount");
                            const parked = currencyAmountsRef.current.get(nextCurrency);
                            form.setValue("priceAmount", parked ?? 0, {
                              shouldDirty: true,
                              shouldValidate: false,
                            });
                            if (parked === undefined) form.setFocus("priceAmount");
                          }}
                        >
                          <SelectTrigger id="price-currency" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map((c) => (
                              <SelectItem key={c} value={c}>
                                {c}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                  <Controller
                    control={form.control}
                    name="priceAmount"
                    render={({ field, fieldState }) => {
                      const minor = priceCurrency === null ? 0 : MINOR_UNITS[priceCurrency];
                      const step = minor === 0 ? "1" : `0.${"0".repeat(Math.max(0, minor - 1))}1`;
                      const displayValue =
                        field.value === null ? "" : (field.value / 10 ** minor).toString();
                      return (
                        <Field
                          data-invalid={fieldState.invalid || undefined}
                          data-dirty={fieldState.isDirty || undefined}
                          className={DIRTY_RAIL}
                        >
                          <FieldLabel htmlFor="price-amount">Amount</FieldLabel>
                          {/* min="0" guards the arrow-spinner from going
                              negative, but isn't tightened to `step` because
                              that would fire the browser's native
                              constraint-violation tooltip on every keystroke
                              of "0". The schema (priceAmount >= 1 minor unit)
                              and the Zod resolver own the actual validation,
                              surfaced via FieldError below with a friendlier
                              message that points the admin at the Free
                              toggle for zero-cost items. */}
                          <Input
                            id="price-amount"
                            type="number"
                            inputMode={minor === 0 ? "numeric" : "decimal"}
                            step={step}
                            min="0"
                            value={displayValue}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                field.onChange(null);
                                return;
                              }
                              const parsed = Number.parseFloat(raw);
                              if (Number.isNaN(parsed)) return;
                              field.onChange(Math.round(parsed * 10 ** minor));
                            }}
                            aria-invalid={fieldState.invalid}
                          />
                          <FieldError errors={[fieldState.error]} />
                        </Field>
                      );
                    }}
                  />
                </div>
              )}
            </FieldGroup>
          </FieldSet>

          <Separator />

          <FieldSet>
            <FieldLegend>English</FieldLegend>
            <FieldGroup>
              <Controller
                control={form.control}
                name="translations.en.title"
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid || undefined}
                    data-dirty={fieldState.isDirty || undefined}
                    className={DIRTY_RAIL}
                  >
                    <FieldLabel htmlFor="en-title">Title</FieldLabel>
                    <Input id="en-title" {...field} aria-invalid={fieldState.invalid} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="translations.en.description"
                render={({ field, fieldState }) => (
                  <Field
                    data-invalid={fieldState.invalid || undefined}
                    data-dirty={fieldState.isDirty || undefined}
                    className={DIRTY_RAIL}
                  >
                    <FieldLabel htmlFor="en-desc">Description</FieldLabel>
                    <Textarea id="en-desc" {...field} rows={4} aria-invalid={fieldState.invalid} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <Field
            orientation="horizontal"
            data-dirty={idToggleDirty || undefined}
            className={DIRTY_RAIL}
          >
            <Checkbox id="add-id-translation" checked={idEnabled} onCheckedChange={toggleId} />
            <FieldLabel htmlFor="add-id-translation">Add Indonesian translation</FieldLabel>
          </Field>

          {idEnabled && (
            <FieldSet>
              <FieldLegend>Indonesian</FieldLegend>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="translations.id.title"
                  render={({ field, fieldState }) => (
                    <Field
                      data-invalid={fieldState.invalid || undefined}
                      data-dirty={fieldState.isDirty || undefined}
                      className={DIRTY_RAIL}
                    >
                      <FieldLabel htmlFor="id-title">Title</FieldLabel>
                      <Input
                        id="id-title"
                        {...field}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="translations.id.description"
                  render={({ field, fieldState }) => (
                    <Field
                      data-invalid={fieldState.invalid || undefined}
                      data-dirty={fieldState.isDirty || undefined}
                      className={DIRTY_RAIL}
                    >
                      <FieldLabel htmlFor="id-desc">Description</FieldLabel>
                      <Textarea
                        id="id-desc"
                        {...field}
                        value={field.value ?? ""}
                        rows={4}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldSet>
          )}

          <Separator />

          <Controller
            control={form.control}
            name="slug"
            render={({ field, fieldState }) => (
              <Field
                data-invalid={fieldState.invalid || undefined}
                data-dirty={fieldState.isDirty || undefined}
                className={DIRTY_RAIL}
              >
                <FieldLabel htmlFor="slug">URL slug</FieldLabel>
                <Input
                  id="slug"
                  {...field}
                  maxLength={100}
                  aria-invalid={fieldState.invalid}
                  className="font-mono"
                />
                <FieldDescription>
                  Editing the slug changes the listing's public URL on save.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </form>
    </div>
  );
}
