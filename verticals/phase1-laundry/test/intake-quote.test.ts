/**
 * T1 intake pricing over the delivered catalog + money contract (slice 2).
 * The owner's 2026-09-19 answers are exercised as DATA: whole kg rounded up
 * with a 1 kg minimum; cash in full in KHR + USD at the delivered rate.
 */
import { describe, expect, it } from "vitest";

import {
  basisPoints,
  parseLaundryCatalogSection,
  parseLaundryMoneySection,
  quoteIntakeLines,
  settleCashTender,
  usdCentsToKhr,
  type LaundryCatalogSection,
  type LaundryMoneySection,
} from "../src/index.js";

const WF_KG = "0a000000-0000-4000-8000-000000000001";
const DC_SUIT = "0a000000-0000-4000-8000-000000000002";
const DC_SHIRT = "0a000000-0000-4000-8000-000000000003";

const CATALOG_WIRE = {
  schema: "kitluy.config.catalog.v1",
  currency_code: "KHR",
  content_hash: "a".repeat(64),
  families: [
    { code: "WASH_FOLD", lane: "per_weight", name: "Wash & Fold", name_km: null, sort_order: 1 },
    { code: "DRY_CLEAN", lane: "per_piece", name: "Dry Clean", name_km: null, sort_order: 2 },
  ],
  categories: [],
  services: [
    {
      service_id: WF_KG,
      service_code: "WF-KG",
      family_code: "WASH_FOLD",
      name: "Wash & Fold per kg",
      pricing_mode: "PER_WEIGHT",
      currency_code: "KHR",
      unit_price_minor: 4000,
      service_version: 2,
    },
    {
      service_id: DC_SUIT,
      service_code: "DC-SUIT_2PC",
      family_code: "DRY_CLEAN",
      name: "Suit (2 pc)",
      pricing_mode: "PER_PIECE",
      currency_code: "KHR",
      unit_price_minor: 25000,
    },
    {
      service_id: DC_SHIRT,
      service_code: "DC-DRESS_SHIRT",
      family_code: "DRY_CLEAN",
      name: "Dress shirt",
      pricing_mode: "PER_PIECE",
      currency_code: "KHR",
      unit_price_minor: 8000,
    },
  ],
  garment_types: [],
};

const MONEY_WIRE = {
  schema: "kitluy.config.money.v1",
  currency_code: "KHR",
  currency_exponent: 0,
  money_rounding: "round_half_up_minor_unit",
  weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
  location_code: "DEMO-PP-01",
  fx: { USD: { khr_per_usd: 4100, effective_from: "2026-09-19T00:00:00Z" } },
};

const catalog = parseLaundryCatalogSection(CATALOG_WIRE) as LaundryCatalogSection;
const moneyKhr = parseLaundryMoneySection(MONEY_WIRE) as LaundryMoneySection;

describe("the delivered sections parse (one parser for the Hub and the face)", () => {
  it("reads the catalog with its service versions and the money contract with FX", () => {
    expect(catalog).not.toBeNull();
    expect(catalog.services.find((s) => s.serviceId === WF_KG)?.serviceVersion).toBe(2);
    expect(catalog.services.find((s) => s.serviceId === DC_SUIT)?.serviceVersion).toBe(1);
    expect(moneyKhr).toMatchObject({
      currencyCode: "KHR",
      currencyExponent: 0,
      locationCode: "DEMO-PP-01",
      khrPerUsd: 4100,
      weightRule: { increment: 1, rounding: "up", minimum: 1 },
    });
  });
});

describe("quoteIntakeLines", () => {
  it("prices per-piece lines from the delivered unit price", () => {
    const result = quoteIntakeLines(catalog, moneyKhr, [
      { serviceId: DC_SUIT, pieceCount: 2 },
      { serviceId: DC_SHIRT, pieceCount: 3 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.lines.map((l) => [l.serviceCode, l.quantity, l.lineSubtotalMinor])).toEqual(
      [
        ["DC-SUIT_2PC", "2.0000", 50_000n],
        ["DC-DRESS_SHIRT", "3.0000", 24_000n],
      ],
    );
    expect(result.quote.subtotalMinor).toBe(74_000n);
    expect(result.quote.totalMinor).toBe(74_000n);
    expect(result.quote.expressSurchargeMinor).toBe(0n);
  });

  it("bills whole kilograms rounded UP with a 1 kg minimum (owner rule as data)", () => {
    const cases: readonly [number, string, bigint][] = [
      [200, "1.0000", 4_000n], // below the minimum → 1 kg
      [1000, "1.0000", 4_000n],
      [1001, "2.0000", 8_000n], // any excess rounds up
      [3500, "4.0000", 16_000n],
      [7000, "7.0000", 28_000n],
    ];
    for (const [grams, quantity, subtotal] of cases) {
      const result = quoteIntakeLines(catalog, moneyKhr, [
        { serviceId: WF_KG, weighedGrams: grams },
      ]);
      expect(result.ok, `${grams} g`).toBe(true);
      if (!result.ok) continue;
      const line = result.quote.lines[0];
      expect(line?.pricingMethod).toBe("per_weight");
      expect(line?.unitCode).toBe("kg");
      expect(line?.weighedGrams).toBe(grams);
      expect(line?.quantity).toBe(quantity);
      expect(line?.lineSubtotalMinor).toBe(subtotal);
    }
  });

  it("applies the express surcharge only when the contract carries one", () => {
    const withExpress = parseLaundryMoneySection({
      ...MONEY_WIRE,
      express_surcharge_bps: 5000,
    }) as LaundryMoneySection;
    const result = quoteIntakeLines(
      catalog,
      withExpress,
      [{ serviceId: DC_SHIRT, pieceCount: 1 }],
      { express: true },
    );
    expect(result.ok && result.quote.expressSurchargeMinor).toBe(4_000n);
    expect(result.ok && result.quote.totalMinor).toBe(12_000n);
    const refused = quoteIntakeLines(catalog, moneyKhr, [{ serviceId: DC_SHIRT, pieceCount: 1 }], {
      express: true,
    });
    expect(refused).toEqual({ ok: false, refusal: { code: "EXPRESS_NOT_CONFIGURED" } });
  });

  it("refuses what it cannot price rather than guessing", () => {
    expect(quoteIntakeLines(catalog, moneyKhr, [])).toEqual({
      ok: false,
      refusal: { code: "NO_LINES" },
    });
    const unknown = "0a000000-0000-4000-8000-0000000000ff";
    expect(quoteIntakeLines(catalog, moneyKhr, [{ serviceId: unknown, pieceCount: 1 }])).toEqual({
      ok: false,
      refusal: { code: "SERVICE_UNKNOWN", serviceId: unknown },
    });
    expect(quoteIntakeLines(catalog, moneyKhr, [{ serviceId: WF_KG, pieceCount: 1 }])).toEqual({
      ok: false,
      refusal: { code: "PRICING_MODE_MISMATCH", serviceId: WF_KG },
    });
    expect(
      quoteIntakeLines(catalog, moneyKhr, [{ serviceId: DC_SUIT, weighedGrams: 1000 }]),
    ).toEqual({ ok: false, refusal: { code: "PRICING_MODE_MISMATCH", serviceId: DC_SUIT } });
    expect(quoteIntakeLines(catalog, moneyKhr, [{ serviceId: DC_SUIT, pieceCount: 0 }])).toEqual({
      ok: false,
      refusal: { code: "QUANTITY_INVALID", serviceId: DC_SUIT },
    });
    expect(quoteIntakeLines(catalog, moneyKhr, [{ serviceId: DC_SUIT, pieceCount: 1.5 }])).toEqual({
      ok: false,
      refusal: { code: "QUANTITY_INVALID", serviceId: DC_SUIT },
    });
    expect(
      quoteIntakeLines(catalog, moneyKhr, [{ serviceId: DC_SUIT, pieceCount: 1, weighedGrams: 1 }]),
    ).toEqual({ ok: false, refusal: { code: "QUANTITY_INVALID", serviceId: DC_SUIT } });
    const noRule = parseLaundryMoneySection({
      ...MONEY_WIRE,
      weight_rule: undefined,
    }) as LaundryMoneySection;
    expect(quoteIntakeLines(catalog, noRule, [{ serviceId: WF_KG, weighedGrams: 1000 }])).toEqual({
      ok: false,
      refusal: { code: "WEIGHT_RULE_MISSING" },
    });
    const usdContract = parseLaundryMoneySection({
      ...MONEY_WIRE,
      currency_code: "USD",
      currency_exponent: 2,
    }) as LaundryMoneySection;
    expect(quoteIntakeLines(catalog, usdContract, [{ serviceId: DC_SUIT, pieceCount: 1 }])).toEqual(
      { ok: false, refusal: { code: "CURRENCY_MISMATCH", serviceId: DC_SUIT } },
    );
  });

  it("is deterministic: the face's preview equals the Hub's price for the same inputs", () => {
    const lines = [
      { serviceId: WF_KG, weighedGrams: 2400 },
      { serviceId: DC_SUIT, pieceCount: 1 },
    ];
    const a = quoteIntakeLines(catalog, moneyKhr, lines);
    const b = quoteIntakeLines(catalog, moneyKhr, lines);
    expect(a).toEqual(b);
    expect(a.ok && a.quote.totalMinor).toBe(12_000n + 25_000n);
  });
});

describe("cash tender at intake (KHR + USD)", () => {
  it("converts USD cents at the delivered rate, rounding half-up to whole riel", () => {
    expect(usdCentsToKhr(100n, 4100)).toBe(4_100n);
    expect(usdCentsToKhr(1n, 4100)).toBe(41n);
    expect(usdCentsToKhr(150n, 4100)).toBe(6_150n);
    expect(usdCentsToKhr(1n, 4150)).toBe(42n); // 41.5 → 42
    expect(usdCentsToKhr(1n, 4149)).toBe(41n); // 41.49 → 41
    expect(basisPoints(10_000n, 1250)).toBe(1_250n);
    expect(basisPoints(3n, 5000)).toBe(2n); // 1.5 → 2
  });

  it("settles in full, returns change in KHR, and records each leg", () => {
    const result = settleCashTender(37_000n, moneyKhr, { localMinor: 10_000n, usdCents: 1_000n });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settlement).toMatchObject({
      currencyCode: "KHR",
      tenderedMinor: 51_000n,
      appliedMinor: 37_000n,
      changeDueMinor: 14_000n,
    });
    expect(result.settlement.legs).toEqual([
      {
        tenderType: "cash",
        currencyCode: "KHR",
        currencyExponent: 0,
        amountMinor: 10_000n,
        localEquivalentMinor: 10_000n,
        khrPerUsd: null,
      },
      {
        tenderType: "cash",
        currencyCode: "USD",
        currencyExponent: 2,
        amountMinor: 1_000n,
        localEquivalentMinor: 41_000n,
        khrPerUsd: 4100,
      },
    ]);
  });

  it("refuses a short tender, a USD tender without a rate, and negative money", () => {
    expect(settleCashTender(37_000n, moneyKhr, { localMinor: 30_000n, usdCents: 0n })).toEqual({
      ok: false,
      refusal: { code: "TENDER_INSUFFICIENT", shortMinor: 7_000n },
    });
    const noFx = parseLaundryMoneySection({ ...MONEY_WIRE, fx: undefined }) as LaundryMoneySection;
    expect(settleCashTender(1_000n, noFx, { localMinor: 0n, usdCents: 100n })).toEqual({
      ok: false,
      refusal: { code: "FX_RATE_UNAVAILABLE" },
    });
    expect(settleCashTender(1_000n, moneyKhr, { localMinor: -1n, usdCents: 0n })).toEqual({
      ok: false,
      refusal: { code: "TENDER_INVALID" },
    });
    // Exact cash: no change, one leg.
    const exact = settleCashTender(4_000n, moneyKhr, { localMinor: 4_000n, usdCents: 0n });
    expect(exact.ok && exact.settlement.changeDueMinor).toBe(0n);
    expect(exact.ok && exact.settlement.legs.length).toBe(1);
  });
});
