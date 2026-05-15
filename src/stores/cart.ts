import { create } from "zustand";
import { persist } from "zustand/middleware";

import { CART_LIMIT } from "@/lib/cart-constants.ts";

type CartState = {
  slugs: Set<string>;
  add: (slug: string) => void;
  remove: (slug: string) => void;
  removeMany: (slugs: string[]) => void;
};

// Set in memory (O(1) membership tests on every list-card render), array on
// disk (JSON-serializable). `partialize` collapses on write; `merge` rebuilds
// on rehydrate. Keeping the in-memory and on-disk shapes asymmetric avoids
// pulling in `superjson` just for one `Set` round-trip.
//
// NOTE: the store keys items by `slug`, not `id`. Slugs are admin-editable
// (see /admin/_auth/$slug/edit.tsx); a slug change after a visitor has
// queued the item silently drops the row from their cart on next open.
// Acceptable at single-admin scale - revisit if multi-instance changes
// rename frequency, then migrate to `id`.
//
// NOTE: Zustand persist v5 does not subscribe to the `storage` event, so
// two tabs of the public site drift their cart state until reload. Matches
// the documented single-user / single-device flow (ARCHITECTURE.md #Cart
// and contact flow). Add a custom storage listener if multi-tab sync ever
// becomes a real requirement.
export const useCart = create<CartState>()(
  persist(
    (set) => ({
      slugs: new Set<string>(),
      add: (slug) =>
        set((s) => {
          if (s.slugs.has(slug)) return s;
          if (s.slugs.size >= CART_LIMIT) return s;
          const next = new Set(s.slugs);
          next.add(slug);
          return { slugs: next };
        }),
      remove: (slug) =>
        set((s) => {
          if (!s.slugs.has(slug)) return s;
          const next = new Set(s.slugs);
          next.delete(slug);
          return { slugs: next };
        }),
      removeMany: (slugs) =>
        set((s) => {
          const next = new Set(s.slugs);
          let changed = false;
          for (const slug of slugs) {
            if (next.delete(slug)) changed = true;
          }
          return changed ? { slugs: next } : s;
        }),
    }),
    {
      name: "flea-market:cart",
      version: 1,
      partialize: (state) => ({ slugs: Array.from(state.slugs) }),
      merge: (persisted, current) => ({
        ...current,
        slugs: new Set((persisted as { slugs?: string[] } | undefined)?.slugs ?? []),
      }),
    },
  ),
);
