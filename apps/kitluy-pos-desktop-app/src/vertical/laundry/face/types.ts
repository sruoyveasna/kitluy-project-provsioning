/**
 * Laundry T1 face — presentation types.
 *
 * PROVENANCE: ported from the donor `kitluy-laundry-pos-desk-app@8b2f107`
 * (`src/types/index.ts`, `src/services/catalog.service.ts`) under the POS
 * feature disposition register row "T1 POS intake/cashier" (T1-FACE-PORT-001).
 * The donor's Order / Service Item vocabulary is mapped per
 * KLD-2026-08-07-BOOKING-SEMANTICS-001: catalog SERVICE → LAUNDRY BOOKING.
 * Everything that reached Supabase directly, every loyalty/subscription/
 * Telegram fixture and every payment type stayed behind (register: REJECTED /
 * GATED).
 *
 * The face never holds a credential, a price it invented, or a customer fact
 * the Store Hub did not answer.
 */

/** The views the top bar can name. Only `new_order` is a built experience. */
export type T1View = "dashboard" | "new_order" | "orders" | "handoff" | "shift_close" | "settings";

/**
 * Presentation lanes of the catalog, derived from the canonical pricing mode
 * (WS-05 `kitluy_laundry.services.pricing_modes`): `wf` = per weight,
 * `pp` = per piece. A lane is a way of ENTERING a service — the donor's
 * "Wash & Fold / Dry Clean / Wash & Press" trio was its own product taxonomy
 * and does not exist in the canonical catalog.
 */
export type ServiceType = "wf" | "pp";

/**
 * A service FAMILY as the catalog delivers it (group 0233
 * `kitluy_laundry.service_families`): the donor's three product cards — Wash &
 * Fold, Dry Clean, Wash & Press — now data, each with its lane. The face
 * renders one card per family that has at least one priced service.
 */
export interface CatalogFamily {
  code: string;
  lane: ServiceType;
  name: string;
  nameKm: string | null;
  sortOrder: number;
}

/** A cart entry: one catalog service (per piece) or the weighed load (per kg). */
export interface CartItem {
  id: string;
  name: string;
  icon: string;
  /** Unit price in KHR (integer; KHR has no minor unit) — the delivered
   * effective price. Display until the Hub prices the Booking (slice 2). */
  price: number;
  /** Pieces for a per-piece line; whole kilograms for the per-kg line. */
  qty: number;
  svc: ServiceType;
  stain?: boolean;
  serviceCode?: string;
  familyCode?: string;
  familyName?: string;
}

/** One per-piece catalog service projected for the grid. */
export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  icon: string;
  iconPath?: string | null;
  priceKhr: number;
  category?: string | null;
  categorySortOrder?: number | null;
  familyCode?: string | null;
  familyName?: string | null;
}

/** A garment type for the per-kg checklist (T003 Garment intake vocabulary). */
export interface WFItem {
  id: string;
  name: string;
  icon: string;
  category: string;
  categorySortOrder?: number;
}

export interface LaundryItemCategory {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  iconPath?: string | null;
}

/** The per-kg service the weight panel prices against. */
export interface WfKgOffering {
  serviceCode: string;
  name: string;
  /** Rate per kilogram in KHR. */
  rateKhr: number;
  familyCode?: string | null;
  familyName?: string | null;
}

/**
 * The Store's money contract as delivered (kitluy.config.money.v1) — what the
 * face may show about how the Hub will price: the billable-weight rule and,
 * when the owner configured one, the KHR per USD rate. Never a price.
 */
export interface DeliveredMoney {
  currencyCode: string;
  currencyExponent: number;
  weightRule: {
    increment: number;
    rounding: "up" | "nearest";
    minimum: number;
  } | null;
  khrPerUsd: number | null;
  expressSurchargeBps: number | null;
  locationCode: string | null;
}

/**
 * The customer as the STORE HUB answered it (WS-12-T002 `IntakeCustomer`).
 * No tier, no visit count, no spend: the Hub does not hold them yet and the
 * face must not manufacture them.
 */
export interface Customer {
  id: string;
  name: string;
  /** Masked by the Hub; the face never sees the full number of an existing customer. */
  phoneMasked: string | null;
  phoneVerified: boolean;
  preferredLanguage: "km-KH" | "en-US";
  origin: string;
  syncState: string;
}

export type PreferredLanguage = Customer["preferredLanguage"];
