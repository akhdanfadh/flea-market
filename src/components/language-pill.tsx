import { LANGUAGES, type Language } from "#/db/schema.ts";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";

export function LanguagePill({ current }: { current: Language }) {
  return (
    <ButtonGroup aria-label="Language">
      {LANGUAGES.map((lng) => {
        const active = lng === current;
        // NOTE: raw <a>, not TanStack Router's <Link>, on purpose. /lang/$lang is
        // a server route that 302s with a Set-Cookie header; <Link>'s client-side
        // nav would skip the response entirely and the cookie would never set.
        // AGENTS.md #4 Code rule 1 is overruled here (full reload required).
        // Base UI Button needs nativeButton={false} when render swaps in an <a>.
        return (
          <Button
            key={lng}
            render={<a href={`/lang/${lng}`} aria-current={active ? "page" : undefined} />}
            nativeButton={false}
            variant={active ? "default" : "outline"}
            size="sm"
            className="uppercase tracking-wide"
          >
            {lng}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
