/**
 * T3/T4 custody event names (Store Hub spec v1.0.0 §10.3–10.4, verbatim).
 * Custody history is append-only (RB v4 §5.6); corrections are compensating
 * events, never edits.
 */

/** T3 Clean & Ready Scan-In events (Hub §10.3). */
export const T3_READY_EVENTS = [
  "laundry_ready_scan_started",
  "laundry_item_ready_scanned",
  "laundry_ready_count_verified",
  "laundry_storage_position_assigned",
  "laundry_booking_marked_ready",
  "customer_ready_notification_requested",
] as const;

/** T4 Customer Pickup Scan-Out events (Hub §10.4). */
export const T4_PICKUP_EVENTS = [
  "laundry_pickup_started",
  "laundry_customer_verified",
  "laundry_storage_retrieval_started",
  "laundry_item_scanned_out",
  "laundry_pickup_count_verified",
  "laundry_balance_collected",
  "laundry_handover_confirmed",
  "laundry_booking_picked_up",
  "laundry_storage_position_cleared",
] as const;

export type T3ReadyEvent = (typeof T3_READY_EVENTS)[number];
export type T4PickupEvent = (typeof T4_PICKUP_EVENTS)[number];
export type CustodyEventType = T3ReadyEvent | T4PickupEvent;

import type { LaundryTerminalProfile } from "./terminal-profiles.js";

/**
 * Which terminal profile may emit which custody event. T3 and T4 event sets
 * are disjoint; sharing hardware never merges permissions (POS spec §0.5).
 */
export function emittingProfile(event: CustodyEventType): LaundryTerminalProfile {
  return (T3_READY_EVENTS as readonly string[]).includes(event)
    ? "t3_ready_scan_in"
    : "t4_pickup_scan_out";
}

export function assertProfileMayEmit(
  profile: LaundryTerminalProfile,
  event: CustodyEventType,
): void {
  const required = emittingProfile(event);
  if (profile !== required) {
    throw new Error(
      `Terminal profile ${profile} may not emit ${event}; only ${required} may (Hub spec §10.3-10.4).`,
    );
  }
}
