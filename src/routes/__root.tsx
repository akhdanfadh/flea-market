import { TanStackDevtools } from "@tanstack/react-devtools";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createServerFn } from "@tanstack/react-start";

import { SiteFooter } from "@/components/site-footer.tsx";
import { SiteHeader } from "@/components/site-header.tsx";
import { getLanguage } from "@/lib/lang.server.ts";
import appCss from "@/styles.css?url";

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
        title: "Akhdan's Flea Market",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon/favicon.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon/favicon-96x96.png" },
      { rel: "apple-touch-icon", href: "/favicon/apple-touch-icon.png" },
      { rel: "manifest", href: "/favicon/site.webmanifest" },
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
    <html lang={language} className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="flex min-h-dvh flex-col">
        <SiteHeader language={language} />
        <main className="flex-1">{children}</main>
        <SiteFooter />
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
