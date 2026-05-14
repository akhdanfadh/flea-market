import { getLanguage } from "#/lib/lang.server.ts";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";

import appCss from "../styles.css?url";

const loadRootContext = createServerFn({ method: "GET" }).handler(() => ({
  language: getLanguage(),
}));

export const Route = createRootRoute({
  loader: () => loadRootContext(),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "TanStack Start Starter",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
  errorComponent: ({ error }) => (
    <RootDocument>
      <div className="p-6">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <pre className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </div>
    </RootDocument>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  // Loader data is unavailable when this renders under errorComponent (the
  // loader itself may have thrown), so fall back to the default language.
  const loaderData = Route.useLoaderData();
  const language = loaderData?.language ?? "en";
  return (
    <html lang={language}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
