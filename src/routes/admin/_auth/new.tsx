import { createFileRoute } from "@tanstack/react-router";

// Placeholder until the drafts refactor lands. The route exists so the
// admin table's "New item" Link resolves and typechecks; the real
// create flow ships in a follow-up commit.
export const Route = createFileRoute("/admin/_auth/new")({
  component: NewItemPlaceholder,
});

function NewItemPlaceholder() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>New item page lands with the drafts refactor.</p>
    </div>
  );
}
