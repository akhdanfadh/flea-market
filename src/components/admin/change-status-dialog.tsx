import { useRef } from "react";

import type { ItemStatus } from "@/db/schema.ts";

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
import { STATUS_LABEL } from "@/lib/statuses.ts";

// Confirmation gate for every status change, shared between the admin
// table row and the edit page header. The hook (`useChangeStatus`)
// owns the pending state; this component is pure UI. `itemTitle` is
// optional - the admin table passes it so the dialog reads
// "'Item name' will move from X to Y", the edit page omits it since
// the title is already on screen.
export function ChangeStatusDialog({
  pendingTarget,
  currentStatus,
  itemTitle,
  onConfirm,
  onCancel,
}: {
  pendingTarget: ItemStatus | null;
  currentStatus: ItemStatus;
  itemTitle?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Freeze the rendered labels while the dialog plays its exit animation.
  // When pendingTarget transitions to null (Cancel/Confirm), Base UI keeps
  // AlertDialogContent mounted to animate out - but title/description
  // would re-evaluate against the now-null target and briefly render
  // "Change status to ?". Snapshotting the last open-state values into
  // refs keeps the labels stable across the exit; refs mutated during
  // render are fine for memoizing derived data (React docs allow this).
  const lastTargetRef = useRef<ItemStatus | null>(pendingTarget);
  const lastCurrentRef = useRef<ItemStatus>(currentStatus);
  if (pendingTarget !== null) {
    lastTargetRef.current = pendingTarget;
    lastCurrentRef.current = currentStatus;
  }
  const targetLabel = lastTargetRef.current ? STATUS_LABEL[lastTargetRef.current] : "";
  const currentLabel = STATUS_LABEL[lastCurrentRef.current];
  return (
    <AlertDialog
      open={pendingTarget !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Change status to {targetLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            {itemTitle
              ? `"${itemTitle}" will move from ${currentLabel} to ${targetLabel}.`
              : `Will move from ${currentLabel} to ${targetLabel}.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="bg-background">
          <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
