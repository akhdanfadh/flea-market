import type { Currency, ItemStatus } from "@/db/schema.ts";

import { formatPrice } from "@/lib/money.ts";

// Wire shape consumed by the message templates and on-screen subtotal. Same
// shape the cart Sheet builds from the resolved cart rows minus sold items
// (sold rows are filtered upstream so they're absent from both the body and
// the totals). `status` is here so reserved items get an inline "[Reserved]"
// marker in the body - it signals to the seller that the visitor knows the
// item's taken and is asking anyway, in case it falls through.
export type MessageItem = {
  title: string;
  slug: string;
  priceAmount: number | null;
  priceCurrency: Currency | null;
  status: ItemStatus;
};

type CurrencySubtotal = { currency: Currency; amount: number };

// Sums priced items by currency, preserving the first-seen order so a JPY +
// USD cart formats as "¥X + $Y" not "$Y + ¥X" depending on Map iteration.
// Free items (priceAmount === null) skip the sum entirely.
function subtotalsByCurrency(items: MessageItem[]): CurrencySubtotal[] {
  const order: Currency[] = [];
  const sums = new Map<Currency, number>();
  for (const item of items) {
    if (item.priceAmount === null || item.priceCurrency === null) continue;
    if (!sums.has(item.priceCurrency)) {
      order.push(item.priceCurrency);
      sums.set(item.priceCurrency, 0);
    }
    sums.set(item.priceCurrency, sums.get(item.priceCurrency)! + item.priceAmount);
  }
  return order.map((currency) => ({ currency, amount: sums.get(currency)! }));
}

// "¥13,000 + Rp250,000" for mixed; "¥13,000" for single-currency; "" when
// every item is free (caller decides to drop the Total line entirely).
export function formatInlineTotals(items: MessageItem[]): string {
  const subtotals = subtotalsByCurrency(items);
  if (subtotals.length === 0) return "";
  return subtotals.map((s) => formatPrice(s.amount, s.currency)).join(" + ");
}

type MessageCopy = {
  // Intro line. English conjugates by number ("this item" vs "these items");
  // Indonesian uses reduplication for plural ("barang" vs "barang-barang").
  introSingular: string;
  introPlural: string;
  totalLabel: string;
  // Availability question. Same singular/plural split as the intro.
  availabilitySingular: string;
  availabilityPlural: string;
  closing: string;
  signoff: string;
  freeLabel: string;
  reservedTag: string;
};

function buildMessage(items: MessageItem[], origin: string, copy: MessageCopy): string {
  const lines: string[] = [];
  const isSingle = items.length === 1;
  lines.push(isSingle ? copy.introSingular : copy.introPlural, "");
  for (const it of items) {
    const price =
      it.priceAmount === null || it.priceCurrency === null
        ? copy.freeLabel
        : formatPrice(it.priceAmount, it.priceCurrency);
    const tag = it.status === "reserved" ? ` ${copy.reservedTag}` : "";
    lines.push(`- ${it.title} - ${price}${tag}`);
    lines.push(`  ${origin}/${it.slug}/`);
  }
  const totals = formatInlineTotals(items);
  if (totals) lines.push("", `${copy.totalLabel}: ${totals}`);
  const availability = isSingle ? copy.availabilitySingular : copy.availabilityPlural;
  lines.push("", availability, copy.closing, "", copy.signoff);
  return lines.join("\n");
}

export function enMessage(items: MessageItem[], origin: string): string {
  if (items.length === 0) return "";
  return buildMessage(items, origin, {
    introSingular: "Hi! I'm interested in this item from your flea market:",
    introPlural: "Hi! I'm interested in these items from your flea market:",
    totalLabel: "Total",
    availabilitySingular: "Is this still available?",
    availabilityPlural: "Are these still available?",
    closing: "If so, when and where can we meet?",
    signoff: "Thanks!",
    freeLabel: "Free",
    reservedTag: "[Reserved]",
  });
}

export function idMessage(items: MessageItem[], origin: string): string {
  if (items.length === 0) return "";
  return buildMessage(items, origin, {
    introSingular: "Halo! Saya tertarik dengan barang berikut dari flea market Anda:",
    introPlural: "Halo! Saya tertarik dengan barang-barang berikut dari flea market Anda:",
    totalLabel: "Total",
    availabilitySingular: "Apakah masih tersedia?",
    availabilityPlural: "Apakah masih tersedia?",
    closing: "Kalau iya, kapan dan di mana kita bisa bertemu?",
    signoff: "Terima kasih!",
    freeLabel: "Free",
    reservedTag: "[Reserved]",
  });
}
