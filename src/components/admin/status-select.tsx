import { CheckIcon, ChevronDownIcon } from "lucide-react";

import type { ItemStatus } from "@/db/schema.ts";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ITEM_STATUSES } from "@/db/schema.ts";
import { STATUS_LABEL, STATUS_TRIGGER } from "@/lib/statuses.ts";
import { cn } from "@/lib/utils.ts";

// Shared status picker used by the admin table row AND the edit page header.
// Pure UI - parent owns the actual mutation call (setItemStatus) plus
// optimistic state and toasts. Single invariant: a draft can only leave
// draft state when it has >=1 photo (`canExitDraft`). Going back to draft
// is always allowed; published-state transitions are free. The server fn
// enforces the same rule, so a curl bypassing the UI still hits the gate.
export function StatusSelect({
  status,
  canExitDraft,
  busy,
  onChange,
}: {
  status: ItemStatus;
  canExitDraft: boolean;
  busy?: boolean;
  onChange: (next: ItemStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            className={cn("justify-between", STATUS_TRIGGER[status])}
          >
            {/* All labels stacked in one grid cell so CSS sizes the button */}
            {/* to the widest. Non-active labels are `invisible` (kept in */}
            {/* layout) + `aria-hidden` (skipped by screen readers). */}
            <span className="grid text-left">
              {ITEM_STATUSES.map((s) => (
                <span
                  key={s}
                  aria-hidden={s !== status || undefined}
                  className={cn("col-start-1 row-start-1", s !== status && "invisible")}
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
      {/* The trigger sizes itself to the widest label, so drop the min and */}
      {/* let the popup match the anchor exactly. */}
      <DropdownMenuContent align="start" className="min-w-0">
        {ITEM_STATUSES.map((s) => {
          const isCurrent = s === status;
          // Photo gate: any draft -> published target is blocked when
          // the row has no photos. Once a photo exists, the admin picks
          // freely between available / reserved / sold.
          const isPhotoGated = status === "draft" && s !== "draft" && !canExitDraft;
          return (
            <DropdownMenuItem
              key={s}
              disabled={isCurrent || isPhotoGated}
              onClick={() => onChange(s)}
            >
              {STATUS_LABEL[s]}
              {isCurrent && <CheckIcon className="ml-auto size-3.5 opacity-70" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
