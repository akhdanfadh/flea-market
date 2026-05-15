import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ItemStatus } from "@/db/schema.ts";

import { setItemStatus } from "@/lib/item-actions.ts";

// Shared optimistic-status machinery for the admin table row and the edit
// page header. The two call sites differ only in wording (the table names
// the item in the success toast; the edit page already shows the item),
// so the message strings live at the call site and the hook owns the
// state, the mutation call, and the invalidate/toast choreography.
//
// The split awaits inside `change` distinguish "mutation failed" (revert
// optimistic, error toast) from "mutation succeeded but invalidate
// failed" (keep optimistic so the UI matches the server, warn toast).
export function useChangeStatus({
  id,
  currentStatus,
  buildSuccessDescription,
  refreshFailedTitle,
}: {
  id: string;
  currentStatus: ItemStatus;
  buildSuccessDescription: (prev: ItemStatus, next: ItemStatus) => string;
  refreshFailedTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<ItemStatus | null>(null);
  // TanStack Router doesn't remount the route component on param-only nav
  // (e.g. /admin/a/edit -> /admin/b/edit). Without this reset, item B
  // would briefly show item A's mid-flight optimistic status before the
  // loader/invalidate catches up.
  useEffect(() => {
    setOptimistic(null);
  }, [id]);
  const status = optimistic ?? currentStatus;

  async function change(next: ItemStatus) {
    if (next === status) return;
    const prev = status;
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
      setOptimistic(null);
      toast.success("Status updated", { description: buildSuccessDescription(prev, next) });
    } catch {
      toast.warning(refreshFailedTitle, { description: "Reload to see the latest state." });
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, change };
}
