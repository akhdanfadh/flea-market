import { createFileRoute } from "@tanstack/react-router";

// Placeholder until the drafts refactor lands. The route exists so the
// admin table's per-row Edit Link resolves and typechecks; the real
// edit + publish flow ships in a follow-up commit.
export const Route = createFileRoute("/admin/_auth/$slug/edit")({
  component: EditItemPlaceholder,
});

function EditItemPlaceholder() {
  const { slug } = Route.useParams();
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        Edit page for <span className="font-mono">{slug}</span> lands with the drafts refactor.
      </p>
    </div>
  );
}
