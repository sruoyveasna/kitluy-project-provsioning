/**
 * The Laundry catalog and money contract AS DELIVERED to a Store Hub and its
 * terminals — T1-REAL-OPERATIONS-001 (slice 1 shape; slice 2 moved it here).
 *
 * Two sections of the Store Hub's signed configuration snapshot:
 *
 *   `catalog` — schema `kitluy.config.catalog.v1`: the cloud door's projection
 *               (group 0233) of the Store's ACTIVE services with the EFFECTIVE
 *               KHR price for the Location, their families (Wash & Fold /
 *               Dry Clean / Wash & Press), the grid categories and the
 *               Wash & Fold garment checklist. Prices come from
 *               `kitluy_laundry.service_prices` — never from this file.
 *   `pricing` — schema `kitluy.config.money.v1`: the Store's money contract
 *               (currency, exponent, billable-weight rule, money rounding, FX,
 *               location code, optional express surcharge). Owner values.
 *
 * ONE parser for both ends of the LAN: the Store Hub prices a Booking from the
 * same sections the terminal renders, so what the face shows is what the Hub
 * charges (owner decision KLD-2026-09-19-T1-REAL-OPERATIONS-001 §3). Parsed
 * against a CLOSED shape; anything malformed is `null` and the caller says
 * "not delivered" / refuses rather than guessing. Nothing here is a fixture.
 *
 * Lives in the Laundry vertical (not neutral Core): families, garments and
 * per-kg lanes are Laundry vocabulary (CLAUDE.md hard rule 2).
 */
export const LAUNDRY_CATALOG_SCHEMA = "kitluy.config.catalog.v1" as const;
export const LAUNDRY_MONEY_SCHEMA = "kitluy.config.money.v1" as const;

export type CatalogLane = "per_weight" | "per_piece";
export type PricingMode = "PER_PIECE" | "PER_WEIGHT";

export interface DeliveredFamily {
  readonly code: string;
  readonly lane: CatalogLane;
  readonly name: string;
  readonly nameKm: string | null;
  readonly sortOrder: number;
}

export interface DeliveredCategory {
  readonly code: string;
  readonly name: string;
  readonly nameKm: string | null;
  readonly sortOrder: number;
  readonly familyCodes: readonly string[];
}

export interface DeliveredService {
  readonly serviceId: string;
  readonly serviceCode: string;
  readonly familyCode: string | null;
  readonly name: string;
  readonly displayName: string;
  readonly nameKm: string | null;
  readonly garmentCode: string | null;
  readonly categoryCode: string | null;
  readonly iconKey: string | null;
  readonly sortOrder: number;
  readonly pricingMode: PricingMode;
  readonly currencyCode: string;
  /** Whole minor units of `currencyCode` (KHR: whole riel). */
  readonly unitPriceMinor: number;
  readonly minChargeMinor: number | null;
  readonly locationPrice: boolean;
  /** `kitluy_laundry.services.version` at projection time; 1 when the door omits it. */
  readonly serviceVersion: number;
}

export interface DeliveredGarmentType {
  readonly code: string;
  readonly name: string;
  readonly nameKm: string | null;
  readonly categoryCode: string | null;
  readonly sortOrder: number;
  readonly familyCodes: readonly string[];
}

export interface LaundryCatalogSection {
  readonly schema: typeof LAUNDRY_CATALOG_SCHEMA;
  readonly currencyCode: string;
  readonly contentHash: string;
  readonly families: readonly DeliveredFamily[];
  readonly categories: readonly DeliveredCategory[];
  readonly services: readonly DeliveredService[];
  readonly garmentTypes: readonly DeliveredGarmentType[];
}

export interface WeightRule {
  readonly unit: "kg";
  /** Billable increment in kg (1 = whole kilograms). */
  readonly increment: number;
  readonly rounding: "up" | "nearest";
  readonly minimum: number;
}

export interface LaundryMoneySection {
  readonly schema: typeof LAUNDRY_MONEY_SCHEMA;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly moneyRounding: string;
  readonly weightRule: WeightRule | null;
  readonly locationCode: string | null;
  /** Whole riel per US dollar, when the owner configured a rate. */
  readonly khrPerUsd: number | null;
  readonly expressSurchargeBps: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX64 = /^[0-9a-f]{64}$/u;
const CODE = /^[A-Z][A-Z0-9_-]{1,39}$/u;

function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function str(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return typeof v === "string" && v.length > 0 && v.length <= 200 ? v : null;
}
function int(r: Record<string, unknown>, key: string): number | null {
  const v = r[key];
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}
function codes(r: Record<string, unknown>, key: string): readonly string[] | null {
  const v = r[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !CODE.test(x))) return null;
  return v as string[];
}

/** `null` when the section is absent or not the closed shape. */
export function parseLaundryCatalogSection(value: unknown): LaundryCatalogSection | null {
  const r = rec(value);
  if (r === null || r["schema"] !== LAUNDRY_CATALOG_SCHEMA) return null;
  const currencyCode = str(r, "currency_code");
  const contentHash = str(r, "content_hash");
  if (currencyCode === null || !/^[A-Z]{3}$/u.test(currencyCode)) return null;
  if (contentHash === null || !HEX64.test(contentHash)) return null;
  const families: DeliveredFamily[] = [];
  for (const raw of Array.isArray(r["families"]) ? (r["families"] as unknown[]) : []) {
    const f = rec(raw);
    const code = f === null ? null : str(f, "code");
    const name = f === null ? null : str(f, "name");
    const lane = f?.["lane"];
    if (f === null || code === null || !CODE.test(code) || name === null) return null;
    if (lane !== "per_weight" && lane !== "per_piece") return null;
    families.push({
      code,
      lane,
      name,
      nameKm: str(f, "name_km"),
      sortOrder: int(f, "sort_order") ?? 0,
    });
  }
  const categories: DeliveredCategory[] = [];
  for (const raw of Array.isArray(r["categories"]) ? (r["categories"] as unknown[]) : []) {
    const c = rec(raw);
    const code = c === null ? null : str(c, "code");
    const name = c === null ? null : str(c, "name");
    const familyCodes = c === null ? null : codes(c, "family_codes");
    if (c === null || code === null || !CODE.test(code) || name === null || familyCodes === null)
      return null;
    categories.push({
      code,
      name,
      nameKm: str(c, "name_km"),
      sortOrder: int(c, "sort_order") ?? 0,
      familyCodes,
    });
  }
  const services: DeliveredService[] = [];
  for (const raw of Array.isArray(r["services"]) ? (r["services"] as unknown[]) : []) {
    const s = rec(raw);
    if (s === null) return null;
    const serviceId = str(s, "service_id");
    const serviceCode = str(s, "service_code");
    const name = str(s, "name");
    const pricingMode = s["pricing_mode"];
    const unitPriceMinor = int(s, "unit_price_minor");
    const currency = str(s, "currency_code");
    if (
      serviceId === null ||
      !UUID.test(serviceId) ||
      serviceCode === null ||
      !CODE.test(serviceCode)
    )
      return null;
    if (name === null || (pricingMode !== "PER_PIECE" && pricingMode !== "PER_WEIGHT")) return null;
    if (unitPriceMinor === null || unitPriceMinor < 0 || currency === null) return null;
    const familyCode = str(s, "family_code");
    if (familyCode !== null && !CODE.test(familyCode)) return null;
    services.push({
      serviceId: serviceId.toLowerCase(),
      serviceCode,
      familyCode,
      name,
      displayName: str(s, "display_name") ?? name,
      nameKm: str(s, "name_km"),
      garmentCode: str(s, "garment_code"),
      categoryCode: str(s, "category_code"),
      iconKey: str(s, "icon_key"),
      sortOrder: int(s, "sort_order") ?? 0,
      pricingMode,
      currencyCode: currency,
      unitPriceMinor,
      minChargeMinor: int(s, "min_charge_minor"),
      locationPrice: s["location_price"] === true,
      serviceVersion: Math.max(1, int(s, "service_version") ?? 1),
    });
  }
  const garmentTypes: DeliveredGarmentType[] = [];
  for (const raw of Array.isArray(r["garment_types"]) ? (r["garment_types"] as unknown[]) : []) {
    const g = rec(raw);
    const code = g === null ? null : str(g, "code");
    const name = g === null ? null : str(g, "name");
    const familyCodes = g === null ? null : codes(g, "family_codes");
    if (g === null || code === null || !CODE.test(code) || name === null || familyCodes === null)
      return null;
    garmentTypes.push({
      code,
      name,
      nameKm: str(g, "name_km"),
      categoryCode: str(g, "category_code"),
      sortOrder: int(g, "sort_order") ?? 0,
      familyCodes,
    });
  }
  return {
    schema: LAUNDRY_CATALOG_SCHEMA,
    currencyCode,
    contentHash,
    families,
    categories,
    services,
    garmentTypes,
  };
}

/** `null` when absent or malformed. A money contract with no currency is no contract. */
export function parseLaundryMoneySection(value: unknown): LaundryMoneySection | null {
  const r = rec(value);
  if (r === null || r["schema"] !== LAUNDRY_MONEY_SCHEMA) return null;
  const currencyCode = str(r, "currency_code");
  const currencyExponent = int(r, "currency_exponent");
  if (currencyCode === null || !/^[A-Z]{3}$/u.test(currencyCode)) return null;
  if (currencyExponent === null || currencyExponent < 0 || currencyExponent > 4) return null;
  let weightRule: WeightRule | null = null;
  const w = rec(r["weight_rule"]);
  if (w !== null) {
    const increment = w["increment"];
    const minimum = w["minimum"];
    const rounding = w["rounding"];
    if (
      w["unit"] !== "kg" ||
      typeof increment !== "number" ||
      !(increment > 0) ||
      typeof minimum !== "number" ||
      !(minimum >= 0) ||
      (rounding !== "up" && rounding !== "nearest")
    ) {
      return null;
    }
    weightRule = { unit: "kg", increment, rounding, minimum };
  }
  let khrPerUsd: number | null = null;
  const usd = rec(rec(r["fx"])?.["USD"]);
  if (usd !== null) {
    const rate = int(usd, "khr_per_usd");
    if (rate === null || rate < 1) return null;
    khrPerUsd = rate;
  }
  const express = r["express_surcharge_bps"];
  const expressSurchargeBps =
    express === undefined || express === null
      ? null
      : typeof express === "number" && Number.isInteger(express) && express >= 0
        ? express
        : NaN;
  if (Number.isNaN(expressSurchargeBps)) return null;
  return {
    schema: LAUNDRY_MONEY_SCHEMA,
    currencyCode,
    currencyExponent,
    moneyRounding: str(r, "money_rounding") ?? "round_half_up_minor_unit",
    weightRule,
    locationCode: str(r, "location_code"),
    khrPerUsd,
    expressSurchargeBps,
  };
}

/**
 * Billable kilograms under the Store's rule (owner ruling 2026-09-19 as data:
 * whole kg, rounded up, minimum 1). Pure; the Hub applies the same rule.
 */
export function billableKilograms(weighedKg: number, rule: WeightRule): number {
  if (!(weighedKg > 0)) return 0;
  const steps = weighedKg / rule.increment;
  const rounded = rule.rounding === "up" ? Math.ceil(steps - 1e-9) : Math.round(steps);
  return Math.max(rule.minimum, rounded * rule.increment);
}
