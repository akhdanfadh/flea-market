import { Link } from "@tanstack/react-router";
import { ShieldIcon } from "lucide-react";

export function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl items-center justify-between p-4 text-sm text-muted-foreground">
        <span className="hidden sm:block sm:flex-1" aria-hidden />
        <span className="sm:flex-1 sm:text-center">
          &copy; {new Date().getFullYear()} Akhdan Fadhilah.
        </span>
        <span className="sm:flex-1 sm:text-right">
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
        </span>
      </div>
    </footer>
  );
}
