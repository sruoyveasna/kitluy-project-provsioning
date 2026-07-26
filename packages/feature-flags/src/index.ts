/**
 * @kitluy/feature-flags — vertical phase gates and feature flags.
 *
 * Source authority: rebuild bible v4.0.0 §2 (locked eight-phase roadmap;
 * KLV4-DEC-001) and §2.3 (later verticals get reserved boundaries, no active
 * production behavior).
 *
 * STATUS: BUILT + TESTED (test/phase-gates.test.ts).
 */
import type { VerticalKey } from "@kitluy/shared-types";
import { VERTICAL_PHASES } from "@kitluy/shared-types";

export type PhaseGateState = "ACTIVE" | "REGISTERED_INACTIVE";

/**
 * Phase gates. Only Phase 1 (Laundry) is active. Activating a later phase
 * requires the vertical completion evidence of RB v4 §2.2 and a versioned
 * owner decision — never a code-only change here without that record.
 */
export const PHASE_GATES: Readonly<Record<VerticalKey, PhaseGateState>> = {
  laundry: "ACTIVE",
  cafe_restaurant: "REGISTERED_INACTIVE",
  ecommerce: "REGISTERED_INACTIVE",
  convenience: "REGISTERED_INACTIVE",
  pharmacy: "REGISTERED_INACTIVE",
  department_store: "REGISTERED_INACTIVE",
  grocery: "REGISTERED_INACTIVE",
  supermarket: "REGISTERED_INACTIVE",
};

export function isVerticalActive(key: VerticalKey): boolean {
  return PHASE_GATES[key] === "ACTIVE";
}

export function activeVerticals(): VerticalKey[] {
  return VERTICAL_PHASES.map((v) => v.key).filter(isVerticalActive);
}

/** Generic feature flag contract (evaluation backend is a later decision). */
export interface FeatureFlag {
  readonly key: string;
  readonly description: string;
  /** Flags default OFF; enabling is an explicit, audited configuration act. */
  readonly defaultValue: false;
}

/** Future registered clients — present, inactive (RB v4 §4.1). */
export const FUTURE_CLIENT_FLAGS: readonly FeatureFlag[] = [
  {
    key: "client.restaurant_kds",
    description: "Restaurant KDS Client (Phase 2). Not Laundry T2.",
    defaultValue: false,
  },
  {
    key: "client.restaurant_guest_display_order_pay",
    description: "Restaurant Guest Display / Order-and-Pay (Phase 2). Not Laundry T2.",
    defaultValue: false,
  },
  {
    key: "client.kiosk_self_checkout",
    description: "Optional Kiosk / Self-Checkout Client (later phase).",
    defaultValue: false,
  },
];
