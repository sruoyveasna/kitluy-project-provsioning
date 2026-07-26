/**
 * @kitluy/money — Money as integer minor units.
 *
 * Source authority: rebuild bible v4.0.0 §9.4 — "Floating-point money is
 * prohibited"; KHR and USD are first-class; every monetary amount carries a
 * currency code. Exact database storage type and rounding policy belong to the
 * approved Supabase schema/money contract
 * ([REQUIRED: Supabase schema v1.0.0 money contract]); this package provides
 * the in-process representation and arithmetic.
 *
 * Tax rules and exchange-rate policy are NOT inferred here (owner decisions
 * KLMF-TAX-001 and exchange-rate policy are pending).
 *
 * STATUS: BUILT + TESTED (test/money.test.ts).
 */

/** First-class currencies (RB v4 header + §9.4). */
export const CURRENCIES = {
  /** Cambodian riel — zero minor-unit digits (whole riel). */
  KHR: { code: "KHR", minorUnitDigits: 0 },
  /** United States dollar — two minor-unit digits (cents). */
  USD: { code: "USD", minorUnitDigits: 2 },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

/**
 * A monetary amount in integer minor units (KHR: riel, USD: cents), stored as
 * a bigint so arbitrary sums never lose integer precision.
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minorUnits: bigint;
}

export class MoneyError extends Error {
  constructor(
    readonly code:
      "CURRENCY_MISMATCH" | "NON_INTEGER_AMOUNT" | "UNKNOWN_CURRENCY" | "INVALID_ALLOCATION",
    message: string,
  ) {
    super(message);
    this.name = "MoneyError";
  }
}

export function money(currency: CurrencyCode, minorUnits: bigint | number): Money {
  if (!(currency in CURRENCIES)) {
    throw new MoneyError("UNKNOWN_CURRENCY", `Unknown currency: ${String(currency)}`);
  }
  if (typeof minorUnits === "number") {
    if (!Number.isSafeInteger(minorUnits)) {
      throw new MoneyError(
        "NON_INTEGER_AMOUNT",
        `Money requires integer minor units, got ${minorUnits}. Floating-point money is prohibited (RB v4 §9.4).`,
      );
    }
    minorUnits = BigInt(minorUnits);
  }
  return { currency, minorUnits };
}

export const khr = (riel: bigint | number): Money => money("KHR", riel);
export const usdCents = (cents: bigint | number): Money => money("USD", cents);

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      "CURRENCY_MISMATCH",
      `Cannot combine ${a.currency} with ${b.currency}. Convert explicitly with a recorded exchange-rate snapshot first.`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { currency: a.currency, minorUnits: a.minorUnits + b.minorUnits };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { currency: a.currency, minorUnits: a.minorUnits - b.minorUnits };
}

export function multiplyByQuantity(a: Money, quantity: bigint | number): Money {
  if (typeof quantity === "number" && !Number.isSafeInteger(quantity)) {
    throw new MoneyError(
      "NON_INTEGER_AMOUNT",
      "multiplyByQuantity takes integer quantities; fractional quantities (e.g. weight) must go through an approved pricing calculation with an explicit rounding rule.",
    );
  }
  return { currency: a.currency, minorUnits: a.minorUnits * BigInt(quantity) };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minorUnits < b.minorUnits ? -1 : a.minorUnits > b.minorUnits ? 1 : 0;
}

export const isZero = (a: Money): boolean => a.minorUnits === 0n;
export const isNegative = (a: Money): boolean => a.minorUnits < 0n;

/**
 * Largest-remainder allocation: splits an amount into shares whose sum is
 * exactly the original amount (no riel/cent created or lost). Used for
 * proportional distribution (e.g. a discount spread across lines).
 */
export function allocate(a: Money, ratios: readonly number[]): Money[] {
  if (ratios.length === 0 || ratios.some((r) => !Number.isSafeInteger(r) || r < 0)) {
    throw new MoneyError(
      "INVALID_ALLOCATION",
      "allocate requires a non-empty list of non-negative integer ratios.",
    );
  }
  const total = ratios.reduce((s, r) => s + BigInt(r), 0n);
  if (total === 0n) {
    throw new MoneyError("INVALID_ALLOCATION", "allocate requires at least one positive ratio.");
  }
  const shares = ratios.map((r) => (a.minorUnits * BigInt(r)) / total);
  let remainder = a.minorUnits - shares.reduce((s, v) => s + v, 0n);
  // Distribute the remainder one minor unit at a time, deterministically from
  // the first ratio onward (stable, auditable order).
  const result = [...shares];
  const step = remainder < 0n ? -1n : 1n;
  let i = 0;
  while (remainder !== 0n) {
    const idx = i % result.length;
    result[idx] = (result[idx] ?? 0n) + step;
    remainder -= step;
    i += 1;
  }
  return result.map((minorUnits) => ({ currency: a.currency, minorUnits }));
}

/**
 * Plain-number rendering of the amount. KHR shows whole riel; USD shows two
 * decimals. Locale digit-grouping and symbols live in @kitluy/localization.
 */
export function formatAmount(a: Money): string {
  const digits = CURRENCIES[a.currency].minorUnitDigits;
  const negative = a.minorUnits < 0n;
  const abs = negative ? -a.minorUnits : a.minorUnits;
  if (digits === 0) return `${negative ? "-" : ""}${abs.toString()}`;
  const s = abs.toString().padStart(digits + 1, "0");
  const whole = s.slice(0, -digits);
  const frac = s.slice(-digits);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
