import { Link } from "@tanstack/react-router";

import type { Language } from "@/db/schema.ts";

import { LanguagePill } from "@/components/language-pill.tsx";
import { SiteLogo } from "@/components/site-logo.tsx";

export function SiteHeader({ language }: { language: Language }) {
  return (
    <header>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 p-4 sm:px-6 md:px-8">
        <Link
          to="/"
          search={() => ({})}
          className="flex items-center gap-2 text-xl font-bold leading-none tracking-tight sm:text-2xl"
        >
          <SiteLogo />
          <span>Akhdan&apos;s Flea Market</span>
        </Link>
        <LanguagePill current={language} />
      </div>
    </header>
  );
}
