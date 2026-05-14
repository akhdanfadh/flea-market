import { Link, createRouter as createTanStackRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

function DefaultNotFound() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That page does not exist (or no longer does).
      </p>
      <p className="mt-4">
        <Link to="/" search={() => ({})} className="underline">
          Back to the catalog
        </Link>
      </p>
    </div>
  );
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    trailingSlash: "always",
    defaultNotFoundComponent: DefaultNotFound,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
