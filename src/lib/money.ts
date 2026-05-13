import { CURRENCIES, type Currency } from "#/db/schema.ts";

// Minor-unit exponent per ISO 4217 code in the supported set.
// JPY and IDR have no fractional unit; USD uses 2 decimals.
// Typing as Record<Currency, number> means TS fails the build if we add a new
// entry to CURRENCIES without setting its exponent here.
export const MINOR_UNITS: Record<Currency, number> = {
  JPY: 0,
  IDR: 0,
  USD: 2,
};

export function isCurrency(value: string | null | undefined): value is Currency {
  return value !== null && value !== undefined && (CURRENCIES as readonly string[]).includes(value);
}

export function formatPrice(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).format(amount / 10 ** MINOR_UNITS[currency]);
}
