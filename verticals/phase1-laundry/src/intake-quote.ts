/**
 * T1 intake pricing over the DELIVERED catalog and money contract —
 * T1-REAL-OPERATIONS-001 slice 2 (KLD-2026-09-19-T1-REAL-OPERATIONS-001 §2.1).
 *
 * ONE pure engine, run at both ends of the LAN:
 *   - the Store Hub prices every line itself from the ACTIVE snapshot's
 *     `catalog` + `pricing` sections and refuses a confirm whose displayed
 *     total differs (PRICE_MISMATCH);
 *   - the terminal face runs the same function over the same delivered
 *     sections to SHOW the person what the Hub will charge — a preview, never
 *     an authority. Nothing on a terminal invents a price (task register §2).
 *
 * Owner values applied as DATA (never defaulted here):
 *   - per-weight: billable kilograms under the money contract's weight rule
 *     (owner 2026-09-19: whole kg, rounded UP, minimum 1 kg) × the delivered
 *     per-kg price, through `pricePerWeightLine` with the contract's rounding;
 *   - per-piece: the delivered unit price × the count, through
 *     `pricePerPieceLine`;
 *   - express: the contract's `express_surcharge_bps` on the subtotal, only
 *     when the contract carries one and the Booking asks for it;
 *   - cash tender: the Booking currency in full at intake (owner: "cash in
 *     full, KHR + USD"), a USD leg converted at the contract's `khr_per_usd`
 *     — absent rate, no USD (nothing prices in USD until the owner supplies
 *     the rate, plan §7).
 *
 * All money is integer minor units (`@kitluy/money`, hard rule 12).
 */
import { money, type CurrencyCode } from "@kitluy/money";

import {
  billableKilograms,
  type DeliveredService,
  type LaundryCatalogSection,
  type LaundryMoneySection,
} from "./catalog-section.js";
import { pricePerPieceLine, pricePerWeightLine, type WeightRoundingRule } from "./pricing.js";

/** One requested line. Exactly one of `pieceCount` / `weighedGrams` per line. */
export interface IntakeLineRequest {
  /** `service_id` from the delivered catalog (uuid). */
  readonly serviceId: string;
  /** PER_PIECE: a positive integer count. */
  readonly pieceCount?: number;
  /** PER_WEIGHT: the weighed load in whole grams (integer, > 0). */
  readonly weighedGrams?: number;
}

export interface QuotedLine {
  readonly serviceId: string;
  readonly serviceCode: string;
  readonly serviceVersion: number;
  readonly displayName: string;
  readonly familyCode: string | null;
  readonly pricingMethod: "per_piece" | "per_weight";
  readonly unitCode: "piece" | "kg";
  readonly unitPriceMinor: bigint;
  /** numeric(18,4) quantity the Hub stores: pieces, or BILLABLE kilograms. */
  readonly quantity: string;
  readonly pieceCount: number | null;
  readonly weighedGrams: number | null;
  /** The billable weight after the contract's rule; null for a per-piece line. */
  readonly billableGrams: number | null;
  readonly lineSubtotalMinor: bigint;
}

export interface IntakeQuote {
  readonly currencyCode: CurrencyCode;
  readonly currencyExponent: number;
  readonly lines: readonly QuotedLine[];
  readonly subtotalMinor: bigint;
  readonly express: boolean;
  readonly expressSurchargeBps: number | null;
  readonly expressSurchargeMinor: bigint;
  readonly totalMinor: bigint;
}

export type IntakeQuoteRefusal =
  | { readonly code: "NO_LINES" }
  | { readonly code: "SERVICE_UNKNOWN"; readonly serviceId: string }
  | { readonly code: "PRICING_MODE_MISMATCH"; readonly serviceId: string }
  | { readonly code: "QUANTITY_INVALID"; readonly serviceId: string }
  | { readonly code: "CURRENCY_MISMATCH"; readonly serviceId: string }
  | { readonly code: "WEIGHT_RULE_MISSING" }
  | { readonly code: "MONEY_ROUNDING_UNKNOWN"; readonly moneyRounding: string }
  | { readonly code: "EXPRESS_NOT_CONFIGURED" };

export type IntakeQuoteResult =
  | { readonly ok: true; readonly quote: IntakeQuote }
  | { readonly ok: false; readonly refusal: IntakeQuoteRefusal };

/** The money contract's rounding key → the pricing engine's explicit rule. */
export function weightRoundingRuleOf(moneyRounding: string): WeightRoundingRule | null {
  if (moneyRounding === "round_half_up_minor_unit") return "round_half_up_minor_unit";
  if (moneyRounding === "round_up_minor_unit") return "round_up_minor_unit";
  return null;
}

/** `value × bps / 10000`, rounded half-up to the minor unit. */
export function basisPoints(value: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0) throw new Error("bps must be a non-negative integer.");
  const numerator = value * BigInt(bps);
  const quotient = numerator / 10_000n;
  const remainder = numerator % 10_000n;
  return remainder * 2n >= 10_000n ? quotient + 1n : quotient;
}

function fourDecimals(value: number): string {
  return value.toFixed(4);
}

/**
 * Price the requested lines exactly as the Store Hub will. Pure: the same
 * inputs always give the same quote, and a refusal names the first line that
 * cannot be priced.
 */
export function quoteIntakeLines(
  catalog: LaundryCatalogSection,
  moneyContract: LaundryMoneySection,
  lines: readonly IntakeLineRequest[],
  options: { readonly express?: boolean } = {},
): IntakeQuoteResult {
  if (lines.length === 0) return { ok: false, refusal: { code: "NO_LINES" } };
  const currency = moneyContract.currencyCode as CurrencyCode;
  const rounding = weightRoundingRuleOf(moneyContract.moneyRounding);
  if (rounding === null) {
    return {
      ok: false,
      refusal: { code: "MONEY_ROUNDING_UNKNOWN", moneyRounding: moneyContract.moneyRounding },
    };
  }
  const byId = new Map<string, DeliveredService>(
    catalog.services.map((service) => [service.serviceId.toLowerCase(), service]),
  );

  const quoted: QuotedLine[] = [];
  let subtotal = 0n;
  for (const line of lines) {
    const service = byId.get(line.serviceId.toLowerCase());
    if (service === undefined) {
      return { ok: false, refusal: { code: "SERVICE_UNKNOWN", serviceId: line.serviceId } };
    }
    if (service.currencyCode !== currency) {
      return { ok: false, refusal: { code: "CURRENCY_MISMATCH", serviceId: line.serviceId } };
    }
    const hasPieces = line.pieceCount !== undefined;
    const hasWeight = line.weighedGrams !== undefined;
    if (hasPieces === hasWeight) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    const unitPrice = money(currency, BigInt(service.unitPriceMinor));

    if (service.pricingMode === "PER_PIECE") {
      if (!hasPieces) {
        return { ok: false, refusal: { code: "PRICING_MODE_MISMATCH", serviceId: line.serviceId } };
      }
      const pieceCount = line.pieceCount ?? 0;
      if (!Number.isSafeInteger(pieceCount) || pieceCount <= 0 || pieceCount > 9_999) {
        return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
      }
      const priced = pricePerPieceLine({
        kind: "per_piece",
        serviceCode: service.serviceCode,
        unitPriceSnapshot: unitPrice,
        pieceCount,
      });
      quoted.push({
        serviceId: service.serviceId,
        serviceCode: service.serviceCode,
        serviceVersion: service.serviceVersion,
        displayName: service.displayName,
        familyCode: service.familyCode,
        pricingMethod: "per_piece",
        unitCode: "piece",
        unitPriceMinor: unitPrice.minorUnits,
        quantity: fourDecimals(pieceCount),
        pieceCount,
        weighedGrams: null,
        billableGrams: null,
        lineSubtotalMinor: priced.minorUnits,
      });
      subtotal += priced.minorUnits;
      continue;
    }

    // PER_WEIGHT
    if (!hasWeight) {
      return { ok: false, refusal: { code: "PRICING_MODE_MISMATCH", serviceId: line.serviceId } };
    }
    const weighedGrams = line.weighedGrams ?? 0;
    if (!Number.isSafeInteger(weighedGrams) || weighedGrams <= 0 || weighedGrams > 9_999_000) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    if (moneyContract.weightRule === null) {
      return { ok: false, refusal: { code: "WEIGHT_RULE_MISSING" } };
    }
    // The owner's rule as data: whole kg, rounded up, minimum 1 (plan §1).
    const billableKg = billableKilograms(weighedGrams / 1000, moneyContract.weightRule);
    const billableGrams = Math.round(billableKg * 1000);
    if (billableGrams <= 0) {
      return { ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: line.serviceId } };
    }
    const priced = pricePerWeightLine(
      {
        kind: "per_weight",
        serviceCode: service.serviceCode,
        pricePerKgSnapshot: unitPrice,
        weightGrams: billableGrams,
      },
      rounding,
    );
    quoted.push({
      serviceId: service.serviceId,
      serviceCode: service.serviceCode,
      serviceVersion: service.serviceVersion,
      displayName: service.displayName,
      familyCode: service.familyCode,
      pricingMethod: "per_weight",
      unitCode: "kg",
      unitPriceMinor: unitPrice.minorUnits,
      quantity: fourDecimals(billableGrams / 1000),
      pieceCount: null,
      weighedGrams,
      billableGrams,
      lineSubtotalMinor: priced.minorUnits,
    });
    subtotal += priced.minorUnits;
  }

  const express = options.express === true;
  let expressSurcharge = 0n;
  if (express) {
    if (moneyContract.expressSurchargeBps === null) {
      return { ok: false, refusal: { code: "EXPRESS_NOT_CONFIGURED" } };
    }
    expressSurcharge = basisPoints(subtotal, moneyContract.expressSurchargeBps);
  }

  return {
    ok: true,
    quote: {
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      lines: quoted,
      subtotalMinor: subtotal,
      express,
      expressSurchargeBps: moneyContract.expressSurchargeBps,
      expressSurchargeMinor: expressSurcharge,
      totalMinor: subtotal + expressSurcharge,
    },
  };
}

// ---------------------------------------------------------------------------
// Cash tender at intake — KHR + USD (owner 2026-09-19: cash in full)
// ---------------------------------------------------------------------------

export interface CashTenderRequest {
  /** Handed over in the Booking currency (whole riel for KHR). */
  readonly localMinor: bigint;
  /** Handed over in US dollars, in cents. Only with a delivered `khr_per_usd`. */
  readonly usdCents: bigint;
}

export interface TenderLeg {
  readonly tenderType: "cash";
  readonly currencyCode: CurrencyCode;
  readonly currencyExponent: number;
  readonly amountMinor: bigint;
  /** For a foreign leg: its value in the Booking currency and the rate used. */
  readonly localEquivalentMinor: bigint;
  readonly khrPerUsd: number | null;
}

export interface CashSettlement {
  readonly currencyCode: CurrencyCode;
  readonly currencyExponent: number;
  /** Everything handed over, in the Booking currency. */
  readonly tenderedMinor: bigint;
  /** What settles the Booking: the full total (cash in full at intake). */
  readonly appliedMinor: bigint;
  /** Returned to the customer, in the Booking currency. */
  readonly changeDueMinor: bigint;
  readonly legs: readonly TenderLeg[];
}

export type CashTenderRefusal =
  | { readonly code: "TENDER_INVALID" }
  | { readonly code: "FX_RATE_UNAVAILABLE" }
  | { readonly code: "TENDER_INSUFFICIENT"; readonly shortMinor: bigint };

export type CashSettlementResult =
  | { readonly ok: true; readonly settlement: CashSettlement }
  | { readonly ok: false; readonly refusal: CashTenderRefusal };

/** `usdCents × khrPerUsd / 100`, rounded half-up to whole riel. */
export function usdCentsToKhr(usdCents: bigint, khrPerUsd: number): bigint {
  if (!Number.isInteger(khrPerUsd) || khrPerUsd < 1) throw new Error("khrPerUsd must be >= 1.");
  const numerator = usdCents * BigInt(khrPerUsd);
  const quotient = numerator / 100n;
  const remainder = numerator % 100n;
  return remainder * 2n >= 100n ? quotient + 1n : quotient;
}

/**
 * Settle a Booking total in cash. The Booking currency leg is taken at face
 * value; a USD leg is converted at the contract's rate. Cash in full: the
 * tender must cover the total; the excess is change in the Booking currency.
 */
export function settleCashTender(
  totalMinor: bigint,
  moneyContract: LaundryMoneySection,
  tender: CashTenderRequest,
): CashSettlementResult {
  const currency = moneyContract.currencyCode as CurrencyCode;
  if (tender.localMinor < 0n || tender.usdCents < 0n || totalMinor < 0n) {
    return { ok: false, refusal: { code: "TENDER_INVALID" } };
  }
  const legs: TenderLeg[] = [];
  let tendered = 0n;
  if (tender.localMinor > 0n) {
    legs.push({
      tenderType: "cash",
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      amountMinor: tender.localMinor,
      localEquivalentMinor: tender.localMinor,
      khrPerUsd: null,
    });
    tendered += tender.localMinor;
  }
  if (tender.usdCents > 0n) {
    // A dollar figure nobody can reproduce is refused: no rate, no USD leg.
    if (currency !== "KHR" || moneyContract.khrPerUsd === null) {
      return { ok: false, refusal: { code: "FX_RATE_UNAVAILABLE" } };
    }
    const equivalent = usdCentsToKhr(tender.usdCents, moneyContract.khrPerUsd);
    legs.push({
      tenderType: "cash",
      currencyCode: "USD",
      currencyExponent: 2,
      amountMinor: tender.usdCents,
      localEquivalentMinor: equivalent,
      khrPerUsd: moneyContract.khrPerUsd,
    });
    tendered += equivalent;
  }
  if (tendered < totalMinor) {
    return {
      ok: false,
      refusal: { code: "TENDER_INSUFFICIENT", shortMinor: totalMinor - tendered },
    };
  }
  return {
    ok: true,
    settlement: {
      currencyCode: currency,
      currencyExponent: moneyContract.currencyExponent,
      tenderedMinor: tendered,
      appliedMinor: totalMinor,
      changeDueMinor: tendered - totalMinor,
      legs,
    },
  };
}
