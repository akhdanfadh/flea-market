import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/_auth/")({
  component: AdminIndex,
});

function AdminIndex() {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>Item CRUD lands in Step 8.</p>
    </div>
  );
}
