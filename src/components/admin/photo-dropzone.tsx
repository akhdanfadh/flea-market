import { CloudUploadIcon } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import type { ItemPhoto } from "@/db/schema.ts";

import { cn } from "@/lib/utils.ts";

// Mirrors the MIME allow-list in src/routes/admin/api/upload.ts. Server
// rejects anything outside this set with 415; the client gate just gives
// faster feedback.
const ACCEPT = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
};

// Maps the dropzone's accepted extensions back to the MIME type to send.
// Browsers without HEIF codec set `file.type = ""` on .heic files even
// when they accept the drop by extension; without this fallback the
// upload would POST Content-Type: "" and the server would 415.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PHOTOS = 10;

// Server-state model: each successful upload returns the full updated
// photos array (the endpoint appends in one SELECT-then-UPDATE round-
// trip), and the parent uses that to drive a router.invalidate() so
// the photo grid re-renders from loader data. No optimistic-thumbnail
// dance in the dropzone itself - the loading state lives in the
// parent's optimistic flow if needed.
export function PhotoDropzone({
  itemId,
  currentCount,
  onUploaded,
}: {
  itemId: string;
  currentCount: number;
  onUploaded: (photos: ItemPhoto[]) => void;
}) {
  const remainingSlots = Math.max(0, MAX_PHOTOS - currentCount);
  const disabled = remainingSlots <= 0;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    multiple: true,
    maxFiles: remainingSlots,
    maxSize: MAX_BYTES,
    disabled,
    onDrop: async (acceptedFiles, fileRejections) => {
      for (const rej of fileRejections) {
        toast.error(`${rej.file.name}: ${rej.errors[0]?.message ?? "rejected"}`);
      }
      // Upload sequentially rather than in parallel - the server appends to
      // items.photos one at a time, and parallel uploads against the same
      // row would race on the read-modify-write inside the upload endpoint.
      // Sequential is slower for multi-drop but correct. NOTE: the same
      // RMW pattern applies to removeItemPhoto / setItemPhotoOrder /
      // setItemPhotoAlt; interleaving any of those with an upload (multi-tab
      // is the realistic vector) can resurrect a deleted photo or drop a
      // new one. Acceptable at single-admin scale; a JSON1 json_set / etc.
      // mutation would be the upgrade if multi-tab editing becomes real.
      //
      // Always surface a single progress toast that flips to success on
      // completion. For multi-file drops it doubles as a counter so a slow
      // network drop of 5 photos doesn't look frozen for tens of seconds.
      // Per-file failures still get their own error toast.
      const total = acceptedFiles.length;
      // All files rejected by react-dropzone (oversized, wrong type) -
      // rejection toasts already fired above; nothing to upload.
      if (total === 0) return;
      const progressId = toast.loading(
        total > 1 ? `Uploading 1 of ${total}...` : "Uploading photo...",
      );
      let uploaded = 0;
      let latestPhotos: ItemPhoto[] | null = null;
      for (let i = 0; i < total; i++) {
        const file = acceptedFiles[i];
        if (total > 1) {
          toast.loading(`Uploading ${i + 1} of ${total}...`, { id: progressId });
        }
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        const contentType = file.type || CONTENT_TYPE_BY_EXT[ext] || "";
        try {
          const res = await fetch(`/admin/api/upload?item=${encodeURIComponent(itemId)}`, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: file,
            credentials: "same-origin",
          });
          if (!res.ok) {
            // Surface the endpoint's own error reason (e.g. "Item not found",
            // "Payload too large", "Unsupported Media Type") rather than a
            // bare status code, since they're already written to be human-
            // readable. Fall back to the status if the body is empty.
            const reason = await res.text().catch(() => "");
            toast.error(`${file.name}: ${reason || `upload failed (${res.status})`}`);
            continue;
          }
          const json = (await res.json()) as { key: string; photos: ItemPhoto[] };
          latestPhotos = json.photos;
          uploaded++;
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (uploaded > 0) {
        toast.success(`Uploaded ${uploaded} photo${uploaded === 1 ? "" : "s"}`, {
          id: progressId,
        });
      } else {
        toast.dismiss(progressId);
      }
      if (latestPhotos) onUploaded(latestPhotos);
    },
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-6 text-center transition-colors",
        !disabled && "cursor-pointer hover:border-ring",
        isDragActive && "border-primary bg-primary/5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input {...getInputProps()} />
      <CloudUploadIcon className="size-6 text-muted-foreground" />
      <div className="text-sm">
        {disabled
          ? `Photo limit reached (${MAX_PHOTOS} max)`
          : isDragActive
            ? "Drop photos here"
            : "Drop photos here or click to choose"}
      </div>
      <p className="text-xs text-muted-foreground">JPEG / PNG / WebP / HEIC, up to 25 MB each</p>
    </div>
  );
}
