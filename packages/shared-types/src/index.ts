/**
 * @kitluy/shared-types — Branded identifiers and shared primitives.
 *
 * Source authority: kitluy-suite-rebuild-bible-v4.0.0.md §3 (canonical hierarchy
 * and terminology) — Tenant, Partner Account, Digital Store, Store Location,
 * Store Hub, Channel, Transaction. Neutral Core: no vertical terminology here.
 *
 * STATUS: BUILT (types + guards), exercised by consuming package tests.
 */

/** Brand helper — prevents accidental cross-assignment of scope identifiers. */
declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Backend organization and data-isolation boundary (RB v4 §3.2). */
export type TenantId = Branded<string, "TenantId">;
/** Business-facing account operated by a merchant/business (RB v4 §3.2). */
export type PartnerAccountId = Branded<string, "PartnerAccountId">;
/** Authoritative store control plane with one primary vertical (RB v4 §3.2). */
export type DigitalStoreId = Branded<string, "DigitalStoreId">;
/** Physical operating site attached to one Digital Store (RB v4 §3.2). */
export type StoreLocationId = Branded<string, "StoreLocationId">;
/** Chain governance relationship across Digital Stores/Locations (RB v4 §3.3). */
export type ChainId = Branded<string, "ChainId">;
export type UserId = Branded<string, "UserId">;
/** HET-managed edge device identity (RB v4 §6). */
export type DeviceId = Branded<string, "DeviceId">;
export type HubId = Branded<string, "HubId">;
/** Neutral Core aggregate covering vertical-specific commercial documents. */
export type TransactionId = Branded<string, "TransactionId">;
export type CorrelationId = Branded<string, "CorrelationId">;
export type IdempotencyKey = Branded<string, "IdempotencyKey">;

/**
 * Explicit, greppable cast points for branded IDs. Format validation is a
 * schema concern ([REQUIRED: canonical ID format from Supabase schema pack]).
 */
export const asId = {
  tenantId: (v: string) => v as TenantId,
  partnerAccountId: (v: string) => v as PartnerAccountId,
  digitalStoreId: (v: string) => v as DigitalStoreId,
  storeLocationId: (v: string) => v as StoreLocationId,
  chainId: (v: string) => v as ChainId,
  userId: (v: string) => v as UserId,
  deviceId: (v: string) => v as DeviceId,
  hubId: (v: string) => v as HubId,
  transactionId: (v: string) => v as TransactionId,
  correlationId: (v: string) => v as CorrelationId,
  idempotencyKey: (v: string) => v as IdempotencyKey,
} as const;

/**
 * KitLuy environments (infrastructure spec v1.0.0 §4.1). Grants are issued per
 * environment independently — no implicit inheritance.
 */
export const KITLUY_ENVIRONMENTS = [
  "local",
  "development",
  "staging",
  "pilot",
  "production",
  "disaster_recovery",
] as const;
export type KitluyEnvironment = (typeof KITLUY_ENVIRONMENTS)[number];

/**
 * The eight locked vertical phases in order (RB v4 §2.1; change requires a
 * versioned owner decision — KLV4-DEC-001).
 */
export const VERTICAL_PHASES = [
  { phase: 1, key: "laundry", name: "Laundry Stores and Shops" },
  { phase: 2, key: "cafe_restaurant", name: "Café and Restaurant Stores" },
  { phase: 3, key: "ecommerce", name: "Online Retailers and eCommerce Businesses" },
  { phase: 4, key: "convenience", name: "Convenience Stores" },
  { phase: 5, key: "pharmacy", name: "Drugstores and Pharmacies" },
  { phase: 6, key: "department_store", name: "Department Stores" },
  { phase: 7, key: "grocery", name: "Grocery Stores" },
  { phase: 8, key: "supermarket", name: "Supermarkets" },
] as const;
export type VerticalKey = (typeof VERTICAL_PHASES)[number]["key"];

/** Simple discriminated result type used across contracts. */
export type Result<T, E = KitluyErrorLike> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export interface KitluyErrorLike {
  readonly code: string;
  readonly message: string;
}

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends KitluyErrorLike>(error: E): Result<never, E> => ({
  ok: false,
  error,
});
