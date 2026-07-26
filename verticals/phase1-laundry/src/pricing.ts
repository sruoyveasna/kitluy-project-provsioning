/**
 * Laundry pricing contracts: per-piece and per-weight (RB v4 §2.1 Phase 1
 * delta; BB v2 §15.2). Booking lines retain immutable price snapshots —
 * "POS must not recalculate historical lines from later catalog changes"
 * (POS spec §5.6).
 *
 * The per-weight rounding rule is NOT guessed: the exact rounding policy is a
 * [REQUIRED] value of the Supabase schema/money contract, so weight-based
 * calculation demands an explicit rule from approved configuration.
 */
import type { Money } from "@kitluy/money";
import { isNegative, multiplyByQuantity } from "@kitluy/money";

export interface PerPiecePriceLine {
  readonly kind: "per_piece";
  readonly serviceCode: string;
  /** Immutable unit-price snapshot at intake time. */
  readonly unitPriceSnapshot: Money;
  readonly pieceCount: number;
}

export interface PerWeightPriceLine {
  readonly kind: "per_weight";
  readonly serviceCode: string;
  /** Immutable price-per-kilogram snapshot at intake time. */
  readonly pricePerKgSnapshot: Money;
  /** Weight captured from the scale in grams (integer — no float weights). */
  readonly weightGrams: number;
}

export type LaundryPriceLine = PerPiecePriceLine | PerWeightPriceLine;

/** Explicit rounding rules a configuration may select for per-weight totals. */
export type WeightRoundingRule = "round_half_up_minor_unit" | "round_up_minor_unit";

export function pricePerPieceLine(line: PerPiecePriceLine): Money {
  if (!Number.isSafeInteger(line.pieceCount) || line.pieceCount <= 0) {
    throw new Error("pieceCount must be a positive integer.");
  }
  if (isNegative(line.unitPriceSnapshot)) throw new Error("Unit price cannot be negative.");
  return multiplyByQuantity(line.unitPriceSnapshot, line.pieceCount);
}

/**
 * Per-weight total = pricePerKg × weightGrams / 1000, rounded by the explicit
 * rule from approved Store configuration. All arithmetic is integer bigint.
 */
export function pricePerWeightLine(line: PerWeightPriceLine, rule: WeightRoundingRule): Money {
  if (!Number.isSafeInteger(line.weightGrams) || line.weightGrams <= 0) {
    throw new Error("weightGrams must be a positive integer (scale capture).");
  }
  if (isNegative(line.pricePerKgSnapshot)) throw new Error("Price cannot be negative.");
  const numerator = line.pricePerKgSnapshot.minorUnits * BigInt(line.weightGrams);
  const denominator = 1000n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  let minorUnits = quotient;
  if (remainder > 0n) {
    if (rule === "round_up_minor_unit") minorUnits += 1n;
    else if (remainder * 2n >= denominator) minorUnits += 1n; // half-up
  }
  return { currency: line.pricePerKgSnapshot.currency, minorUnits };
}
