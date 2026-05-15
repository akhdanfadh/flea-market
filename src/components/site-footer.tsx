import { Link, useLocation } from "@tanstack/react-router";
import { GithubIcon, LogOutIcon, ShieldIcon } from "lucide-react";

export function SiteFooter() {
  // Anything under /admin/ except /admin/login/ is guarded by the _auth
  // layout's beforeLoad, so reaching such a path implies an authed session.
  // Pathname is a sufficient proxy for "show logout" without surfacing the
  // HttpOnly cookie state to the client.
  const pathname = useLocation({ select: (s) => s.pathname });
  const onAuthedAdmin = pathname.startsWith("/admin/") && !pathname.startsWith("/admin/login/");

  return (
    <footer>
      <div className="mx-auto flex max-w-6xl items-center justify-start gap-2 p-4 text-sm text-muted-foreground sm:justify-center">
        {/* Admin/logout sits inline-left of the copyright text because the
            bottom-right slot is occupied by the cart FAB. */}
        {onAuthedAdmin ? (
          // Real POST form so SameSite=Lax cookie + Referer CSRF check on
          // /admin/logout/ both apply; a Link would skip the Set-Cookie clear.
          <form action="/admin/logout/" method="POST" className="inline-flex">
            <button
              type="submit"
              aria-label="Log out"
              className="inline-flex items-center hover:text-foreground"
            >
              <LogOutIcon className="size-3.5" />
            </button>
          </form>
        ) : (
          <Link
            to="/admin/"
            aria-label="Admin"
            // preload={false} because the router has defaultPreload: "intent". Every
            // anonymous hover would otherwise fire requireAdminSession's server-fn
            // POST, surface admin existence in the network tab, and waste invocations.
            preload={false}
            className="inline-flex items-center hover:text-foreground"
          >
            <ShieldIcon className="size-3.5" />
          </Link>
        )}
        <a
          href="https://github.com/akhdanfadh/flea-market"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Source on GitHub"
          className="inline-flex items-center hover:text-foreground"
        >
          <GithubIcon className="size-3.5" />
        </a>
        <span>&copy; {new Date().getFullYear()} Akhdan Fadhilah.</span>
      </div>
    </footer>
  );
}
