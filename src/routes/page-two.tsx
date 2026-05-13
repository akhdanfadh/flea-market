import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/page-two")({ component: PageTwo });

function PageTwo() {
  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold">Page two</h1>
      <p className="mt-4 text-lg">
        <Link to="/" className="text-blue-600 underline">
          Back
        </Link>
      </p>
    </div>
  );
}
