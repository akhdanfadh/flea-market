import { useEffect, useState } from "react";

// Returns false during SSR and on the first client render, then true after the
// post-mount effect fires. Use this to gate UI that reads client-only state
// (Zustand `persist`, localStorage, `window.location`) so the server output
// matches the first client render exactly. Cart-derived UI relies on this:
// without the gate the SSR/first-paint markup reads "empty cart" and the second
// client render immediately repaints the cart's persisted state, which React
// flags as a hydration mismatch and the user sees as a flash.
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
