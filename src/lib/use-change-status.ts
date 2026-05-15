import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ItemStatus } from "@/db/schema.ts";

import { setItemStatus } from "@/lib/item-actions.ts";

// Shared status-mutation machinery for the admin table row and the edit
// page header. Status changes are gated by an AlertDialog ("just like
// delete"): a click on a DropdownMenuItem stages the target via
// `requestChange`; the caller renders <ChangeStatusDialog> wired to
// `pendingTarget`, `confirmChange`, and `cancelChange`. The actual
// mutation, optimistic UI, and router.invalidate() only fire after
// confirm. No success toast - the dialog closing is the signal.
//
// Error/warning toasts are kept: "mutation failed" reverts the optimistic
// state and surfaces the error; "mutation succeeded but invalidate
// failed" keeps the optimistic state (it matches the server) and warns
// the admin to reload.
export function useChangeStatus({
  id,
  currentStatus,
  refreshFailedTitle,
}: {
  id: string;
  currentStatus: ItemStatus;
  refreshFailedTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<ItemStatus | null>(null);
  const [pendingTarget, setPendingTarget] = useState<ItemStatus | null>(null);
  // TanStack Router doesn't remount the route component on param-only nav
  // (e.g. /admin/a/edit -> /admin/b/edit). Without this reset, item B
  // would briefly show item A's mid-flight optimistic status before the
  // loader/invalidate catches up, and would also inherit any staged
  // pending dialog target from A.
  useEffect(() => {
    setOptimistic(null);
    setPendingTarget(null);
  }, [id]);
  // Clear `optimistic` once the loader-refreshed `currentStatus` prop
  // catches up. Doing this manually right after `await router.invalidate()`
  // races: invalidate's promise resolves once the new data is in the
  // router store, but the React subscription that flushes `currentStatus`
  // down to this hook lands in a separate render. A direct
  // `setOptimistic(null)` after the await briefly renders
  // `optimistic=null, currentStatus=<stale prop>` -> status reverts to the
  // pre-change value for ~one frame before the new prop arrives. Deriving
  // the clear from `currentStatus === optimistic` keeps the optimistic
  // value alive across that gap.
  useEffect(() => {
    if (optimistic !== null && currentStatus === optimistic) {
      setOptimistic(null);
    }
  }, [optimistic, currentStatus]);
  const status = optimistic ?? currentStatus;

  function requestChange(next: ItemStatus) {
    if (next === status) return;
    setPendingTarget(next);
  }

  function cancelChange() {
    setPendingTarget(null);
  }

  async function confirmChange() {
    if (pendingTarget === null) return;
    const next = pendingTarget;
    setPendingTarget(null);
    setOptimistic(next);
    setBusy(true);
    try {
      await setItemStatus({ data: { id, status: next } });
    } catch (err) {
      setOptimistic(null);
      toast.error("Failed to update status", {
        description: err instanceof Error ? err.message : String(err),
      });
      setBusy(false);
      return;
    }
    try {
      await router.invalidate();
      // Don't clear optimistic here - the useEffect above does it once
      // currentStatus catches up, avoiding the prop-flush race.
    } catch {
      toast.warning(refreshFailedTitle, { description: "Reload to see the latest state." });
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, pendingTarget, requestChange, confirmChange, cancelChange };
}
