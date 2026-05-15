import type { DragEndEvent } from "@dnd-kit/core";

import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, XIcon } from "lucide-react";

import type { ItemPhoto } from "@/db/schema.ts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { optimizedImageUrl } from "@/lib/images.ts";

// Photos are server state - parent owns the data and the mutation callbacks
// (which fire server fns and router.invalidate). This component is purely
// presentational + drag-source: it reads `photos` and emits onReorder /
// onRemove / onAltChange. Parent is responsible for optimistic UI; this
// component just renders what it's given.
export function PhotoGrid({
  photos,
  onReorder,
  onRemove,
  onAltChange,
}: {
  photos: ItemPhoto[];
  onReorder: (next: ItemPhoto[]) => void;
  onRemove: (key: string) => void;
  onAltChange: (key: string, alt: string) => void;
}) {
  // distance:5 keeps click-to-delete on the X and click-to-focus on the alt
  // input working - without it a single click registers as a drag-start and
  // the buttons never fire.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = photos.findIndex((p) => p.key === active.id);
    const newIndex = photos.findIndex((p) => p.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(photos, oldIndex, newIndex));
  }

  if (photos.length === 0) return null;

  return (
    // Explicit `id` so @dnd-kit doesn't fall back to its module-level
    // counter for accessibility IDs (`DndDescribedBy-N`). Without this,
    // any DndContext rendered earlier in the same SSR pass bumps the
    // counter while the client hydrate starts fresh from 0, and React
    // reports a hydration mismatch on the drag handle's
    // `aria-describedby`. The counter is global to the @dnd-kit module.
    <DndContext
      id="photo-grid"
      sensors={sensors}
      modifiers={[restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={photos.map((p) => p.key)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, idx) => (
            <SortablePhoto
              key={photo.key}
              photo={photo}
              isFirst={idx === 0}
              onRemove={() => onRemove(photo.key)}
              onAltChange={(alt) => onAltChange(photo.key, alt)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

const OVERLAY_BUTTON =
  "bg-black/40 dark:bg-black/40 hover:bg-black/60 dark:hover:bg-black/60 text-white";

function SortablePhoto({
  photo,
  isFirst,
  onRemove,
  onAltChange,
}: {
  photo: ItemPhoto;
  isFirst: boolean;
  onRemove: () => void;
  onAltChange: (alt: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.key,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-1.5 rounded-lg border border-input bg-background p-2"
    >
      <div className="relative">
        <img
          src={optimizedImageUrl(photo.key, { width: 200 })}
          alt={photo.alt ?? ""}
          className="aspect-square w-full rounded object-cover"
        />
        {isFirst && (
          <span className="absolute top-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
            Cover
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={`absolute top-1 right-1 size-7 ${OVERLAY_BUTTON}`}
          onClick={onRemove}
          aria-label="Remove photo"
        >
          <XIcon className="size-3.5" />
        </Button>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className={`absolute bottom-1 left-1 flex size-7 cursor-grab touch-none items-center justify-center rounded ${OVERLAY_BUTTON}`}
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
      </div>
      <Input
        type="text"
        defaultValue={photo.alt ?? ""}
        onBlur={(e) => {
          // Persist on blur (not per-keystroke) to avoid a server round-trip
          // per character. Uncontrolled so the loader-data refresh between
          // mutations doesn't reset the input mid-typing. Trim-compare
          // matches the server's `data.alt.trim()` so re-blurring an
          // already-trimmed value (e.g. typed " foo " -> stored "foo")
          // doesn't fire a redundant write on every subsequent blur.
          const next = e.target.value;
          if (next.trim() !== (photo.alt ?? "")) onAltChange(next);
        }}
        placeholder="Alt text (optional)"
        className="h-7 text-xs"
      />
    </div>
  );
}
