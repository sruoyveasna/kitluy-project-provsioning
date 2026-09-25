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

/**
 * ===========================================================================
 * THE ONE CANONICAL CLOUD-VERTICAL MAPPING
 * ===========================================================================
 * PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001 requirement 2.
 *
 * Two governed vocabularies name the same business vertical, and neither is
 * wrong:
 *
 *   - the CLOUD control plane stores the reference-registry value
 *     `kitluy_core.digital_stores.primary_vertical_code`, governed by
 *     `kitluy_core.reference_values` (`registry_key = 'vertical_code'`,
 *     Phase 1 active value `LAUNDRY`) -- group 0020, KLD-VERTICAL-001;
 *   - the EDGE/runtime registry keys the vertical by `VerticalKey` above
 *     (RB v4 §2.1), and hub migration 0044 constrains
 *     `edge_identity.hub_assignment.primary_vertical_code` to that shape
 *     (`^[a-z][a-z0-9_]*$`).
 *
 * This table is the ONLY sanctioned conversion between them. It is written out
 * explicitly, value by value, rather than computed with `toLowerCase()`: a
 * case transform is a free-form string conversion that silently accepts
 * `LAUNDRY_V2`, `Laundry` or any future cloud code whose registry key is NOT
 * simply its lower case, and quietly invents a vertical the registry never
 * locked. `VERTICAL_CLOUD_CODE_COVERS_REGISTRY` below fails the build's test
 * suite if a ninth vertical is ever added to `VERTICAL_PHASES` without a
 * decision about the cloud code it answers to.
 *
 * FAIL CLOSED. An unknown, blank or mis-cased value maps to `null`, and every
 * caller refuses rather than guessing. Nothing here defaults to Laundry.
 */
export const VERTICAL_CLOUD_CODES = {
  laundry: "LAUNDRY",
  cafe_restaurant: "CAFE_RESTAURANT",
  ecommerce: "ECOMMERCE",
  convenience: "CONVENIENCE",
  pharmacy: "PHARMACY",
  department_store: "DEPARTMENT_STORE",
  grocery: "GROCERY",
  supermarket: "SUPERMARKET",
} as const satisfies Record<VerticalKey, string>;

/** The cloud reference-registry value for a registry key (e.g. `laundry` -> `LAUNDRY`). */
export type CloudVerticalCode = (typeof VERTICAL_CLOUD_CODES)[VerticalKey];

/**
 * True when the explicit table names every locked vertical exactly once.
 * Asserted by test, so the table cannot drift from `VERTICAL_PHASES`.
 */
export const VERTICAL_CLOUD_CODE_COVERS_REGISTRY: boolean =
  VERTICAL_PHASES.every((phase) => phase.key in VERTICAL_CLOUD_CODES) &&
  Object.keys(VERTICAL_CLOUD_CODES).length === VERTICAL_PHASES.length;

const VERTICAL_KEY_BY_CLOUD_CODE: ReadonlyMap<string, VerticalKey> = new Map(
  (Object.entries(VERTICAL_CLOUD_CODES) as readonly (readonly [VerticalKey, string])[]).map(
    ([key, code]) => [code, key] as const,
  ),
);

/**
 * The cloud's authoritative Digital Store vertical code -> the edge registry key.
 *
 * `null` for anything the table does not name -- including a lower-case value,
 * a padded value or a case variant. The caller REFUSES on `null`; it never
 * substitutes a default. This is the only conversion the feeder performs, and
 * it happens once, at the Hub, against the registry.
 */
export function verticalKeyFromCloudCode(value: string): VerticalKey | null {
  return VERTICAL_KEY_BY_CLOUD_CODE.get(value) ?? null;
}

/** The cloud reference-registry code a registry key answers to. Total by construction. */
export function cloudCodeForVerticalKey(key: VerticalKey): CloudVerticalCode {
  return VERTICAL_CLOUD_CODES[key];
}

const VERTICAL_KEY_SET: ReadonlySet<string> = new Set(VERTICAL_PHASES.map((v) => v.key));

/**
 * Narrow an untrusted string to a locked registry `VerticalKey`.
 *
 * The registry lives here, so the check does too. `@kitluy/digital-store-context`
 * and `@kitluy/terminal-seat-contracts` each derive the same set from the same
 * `VERTICAL_PHASES` for their own refusal vocabularies -- one registry, not a
 * second vocabulary.
 */
export function isVerticalKey(value: string): value is VerticalKey {
  return VERTICAL_KEY_SET.has(value);
}

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
