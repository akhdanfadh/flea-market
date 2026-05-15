// Shared constants for the cart subsystem. Lives in its own module - no
// zustand import - because `src/lib/cart-actions.ts` is a server fn and
// importing the persist-backed store eagerly touches localStorage on
// rehydrate. Both the store and the server-side validator pull CART_LIMIT
// from here so the client cap and the Zod `.max()` can't silently desync.
export const CART_LIMIT = 50;
